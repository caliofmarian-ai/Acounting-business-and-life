const styleId='ph-geography-cascade-style';
if(!document.getElementById(styleId)){
  const style=document.createElement('style');
  style.id=styleId;
  style.textContent=`
.phGeoCascade{display:grid;gap:9px;border:1px solid #dce6e2;border-radius:14px;padding:11px;background:#f8fbfa}
.phGeoCascade legend{padding:0 5px;font-size:10px;font-weight:900;color:#334355}
.phGeoCascadeGrid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.phGeoCascade label{display:grid;gap:5px;font-size:10px;font-weight:850;color:#536071}
.phGeoCascade select{width:100%;box-sizing:border-box;border:1px solid #d7e1de;border-radius:12px;padding:11px 34px 11px 11px;background:#fff;color:#17233c;font:inherit}
.phGeoCascade select:focus{outline:3px solid rgba(10,124,102,.12);border-color:#6db1a4}
.phGeoCascade select:disabled{background:#eef3f1;color:#7b8797}
.phGeoCascadeStatus{font-size:9.5px;line-height:1.45;color:#687386;background:#eef3f1;border-radius:10px;padding:9px}
.phGeoCascadeStatus.ok{color:#075f50;background:#e8f6f1}
.phGeoCascadeStatus.warn{color:#845f11;background:#fff7df}
@media(max-width:520px){.phGeoCascadeGrid{grid-template-columns:1fr}}
`;
  document.head.appendChild(style);
}

const LOCALITY_LEVELS=new Set(['city','municipality','submunicipality','special_geographic_unit']);
const cleanCode=value=>String(value||'').replace(/\D/g,'').slice(0,10);

export function phGeographyCascadeMarkup(prefix,{legend='Official home area',statusText='Choose Region, Province, City / Municipality, then Barangay.'}={}){
  const p=String(prefix||'phGeo').replace(/[^A-Za-z0-9_-]/g,'')||'phGeo';
  return `<fieldset class="phGeoCascade" data-ph-geo-cascade="${p}">
    <legend>${legend}</legend>
    <div class="phGeoCascadeGrid">
      <label>Region<select id="${p}Region" required><option value="">Loading regions…</option></select></label>
      <label>Province<select id="${p}Province" required disabled><option value="">Choose region first</option></select></label>
      <label>City / Municipality<select id="${p}Locality" required disabled><option value="">Choose province first</option></select></label>
      <label>Barangay<select id="${p}Barangay" required disabled><option value="">Choose city / municipality first</option></select></label>
    </div>
    <input id="${p}HomePsgcCode" type="hidden" value="">
    <div id="${p}GeoStatus" class="phGeoCascadeStatus" role="status" aria-live="polite">${statusText}</div>
  </fieldset>`;
}

export async function bindPhGeographyCascade({prefix,fetchJson,selectedCode='',onSelected}={}){
  if(typeof fetchJson!=='function')throw new Error('fetchJson is required');
  const p=String(prefix||'phGeo').replace(/[^A-Za-z0-9_-]/g,'')||'phGeo';
  const region=document.getElementById(p+'Region');
  const province=document.getElementById(p+'Province');
  const locality=document.getElementById(p+'Locality');
  const barangay=document.getElementById(p+'Barangay');
  const hidden=document.getElementById(p+'HomePsgcCode');
  const status=document.getElementById(p+'GeoStatus');
  if(!region||!province||!locality||!barangay||!hidden||!status)return null;

  const setStatus=(message,kind='')=>{
    status.textContent=message||'';
    status.className='phGeoCascadeStatus'+(kind?' '+kind:'');
  };
  const setOptions=(select,items,placeholder)=>{
    const rows=Array.isArray(items)?items:[];
    select.innerHTML='<option value="">'+placeholder+'</option>'+rows.map(item=>'<option value="'+String(item.psgc_code||'').replace(/"/g,'&quot;')+'">'+String(item.name||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'</option>').join('');
    select.disabled=false;
  };
  const resetSelect=(select,message,{disabled=true,required=true}={})=>{
    select.innerHTML='<option value="">'+message+'</option>';
    select.value='';
    select.disabled=disabled;
    select.required=required;
  };
  const clearSelection=(message='Choose Region, Province, City / Municipality, then Barangay.')=>{
    hidden.value='';
    if(typeof onSelected==='function')onSelected(null);
    setStatus(message);
  };
  const options=async parent=>{
    const query=parent?'?parent_psgc_code='+encodeURIComponent(parent):'';
    const data=await fetchJson('/api/auth/geography/options'+query);
    return Array.isArray(data?.items)?data.items:[];
  };
  const confirmBarangay=async code=>{
    const normalized=cleanCode(code);
    hidden.value=normalized;
    if(!normalized){clearSelection('Choose your barangay.');return null}
    try{
      const availability=await fetchJson('/api/auth/geography/status?psgc_code='+encodeURIComponent(normalized));
      setStatus(availability.message||'Official barangay selected.',availability.operational_onboarding_available?'ok':'warn');
      if(typeof onSelected==='function')onSelected(availability);
      return availability;
    }catch(error){
      hidden.value='';
      setStatus(error?.message||'Could not verify this barangay.','warn');
      if(typeof onSelected==='function')onSelected(null);
      return null;
    }
  };
  const loadBarangays=async(localityCode,targetBarangay='')=>{
    resetSelect(barangay,'Loading barangays…',{disabled:true});
    clearSelection('Choose your barangay.');
    if(!localityCode){resetSelect(barangay,'Choose city / municipality first');return}
    const children=await options(localityCode);
    const rows=children.filter(item=>item.geographic_level==='barangay');
    setOptions(barangay,rows,rows.length?'Choose barangay':'No barangays found');
    if(targetBarangay&&rows.some(x=>x.psgc_code===targetBarangay)){
      barangay.value=targetBarangay;
      await confirmBarangay(targetBarangay);
    }
  };
  const loadLocalitiesFromRows=async(rows,targetLocality='',targetBarangay='')=>{
    const localities=(rows||[]).filter(item=>LOCALITY_LEVELS.has(item.geographic_level));
    setOptions(locality,localities,localities.length?'Choose city / municipality':'No city / municipality found');
    resetSelect(barangay,'Choose city / municipality first');
    clearSelection('Choose your city / municipality.');
    if(targetLocality&&localities.some(x=>x.psgc_code===targetLocality)){
      locality.value=targetLocality;
      await loadBarangays(targetLocality,targetBarangay);
    }
  };
  const loadLocalities=async(parentCode,targetLocality='',targetBarangay='')=>{
    resetSelect(locality,'Loading cities / municipalities…',{disabled:true});
    resetSelect(barangay,'Choose city / municipality first');
    clearSelection('Choose your city / municipality.');
    if(!parentCode){resetSelect(locality,'Choose province first');return}
    const children=await options(parentCode);
    await loadLocalitiesFromRows(children,targetLocality,targetBarangay);
  };
  const loadAfterRegion=async(regionCode,{provinceCode='',localityCode='',barangayCode=''}={})=>{
    resetSelect(province,'Loading provinces…',{disabled:true});
    resetSelect(locality,'Choose province first');
    resetSelect(barangay,'Choose city / municipality first');
    clearSelection('Choose your province.');
    if(!regionCode){resetSelect(province,'Choose region first');return}
    const children=await options(regionCode);
    const provinces=children.filter(item=>item.geographic_level==='province');
    if(provinces.length){
      setOptions(province,provinces,'Choose province');
      province.required=true;
      if(provinceCode&&provinces.some(x=>x.psgc_code===provinceCode)){
        province.value=provinceCode;
        await loadLocalities(provinceCode,localityCode,barangayCode);
      }
      return;
    }
    resetSelect(province,'Not applicable in this region',{disabled:true,required:false});
    await loadLocalitiesFromRows(children,localityCode,barangayCode);
  };

  region.addEventListener('change',async()=>{
    try{await loadAfterRegion(region.value)}catch(error){setStatus(error?.message||'Could not load provinces.','warn')}
  });
  province.addEventListener('change',async()=>{
    try{await loadLocalities(province.value)}catch(error){setStatus(error?.message||'Could not load cities / municipalities.','warn')}
  });
  locality.addEventListener('change',async()=>{
    try{await loadBarangays(locality.value)}catch(error){setStatus(error?.message||'Could not load barangays.','warn')}
  });
  barangay.addEventListener('change',()=>confirmBarangay(barangay.value));

  try{
    const roots=await options('');
    const regions=roots.filter(item=>item.geographic_level==='region');
    setOptions(region,regions,'Choose region');
    if(selectedCode){
      const availability=await fetchJson('/api/auth/geography/status?psgc_code='+encodeURIComponent(cleanCode(selectedCode)));
      const hierarchy=Array.isArray(availability?.hierarchy)?availability.hierarchy:[];
      const regionItem=hierarchy.find(x=>x.geographic_level==='region');
      const provinceItem=hierarchy.find(x=>x.geographic_level==='province');
      const localityItem=hierarchy.find(x=>LOCALITY_LEVELS.has(x.geographic_level));
      const barangayItem=hierarchy.find(x=>x.geographic_level==='barangay');
      if(regionItem&&regions.some(x=>x.psgc_code===regionItem.psgc_code)){
        region.value=regionItem.psgc_code;
        await loadAfterRegion(regionItem.psgc_code,{
          provinceCode:provinceItem?.psgc_code||'',
          localityCode:localityItem?.psgc_code||'',
          barangayCode:barangayItem?.psgc_code||cleanCode(selectedCode)
        });
      }
    }
  }catch(error){
    resetSelect(region,'Could not load regions',{disabled:false});
    setStatus(error?.message||'Could not load official Philippine geography.','warn');
  }
  return{region,province,locality,barangay,hidden,status};
}
