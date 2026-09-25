let marketMe=null,marketWorkspace=null,marketMode='food',currentStore=null,basket=new Map(),merchantStore=null,merchantInventory=[];
const mtok=()=>localStorage.getItem('abl_token')||'';
const mh=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const mphp=v=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(v)||0);
const mnice=v=>String(v||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
async function mapi(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(mtok())headers.Authorization=`Bearer ${mtok()}`;const r=await fetch(path,{...options,headers});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||`Request failed (${r.status})`);return b}
function mtoast(msg){const t=document.getElementById('roleToast');if(t){t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800)}else alert(msg)}
function ensureMarket(){const shell=document.getElementById('shell');if(!shell)return false;if(!document.getElementById('marketWorkspace')){marketWorkspace=document.createElement('section');marketWorkspace.id='marketWorkspace';marketWorkspace.className='marketWorkspace hidden';shell.querySelector('.topbar')?.insertAdjacentElement('afterend',marketWorkspace)}else marketWorkspace=document.getElementById('marketWorkspace');if(!document.getElementById('basketBar')){const b=document.createElement('div');b.id='basketBar';b.className='basketBar hidden';b.innerHTML='<div class="basketSummary"><small id="basketStore">Basket</small><strong id="basketText">0 items</strong></div><button id="basketClear" class="basketClear" type="button">Clear</button><button id="basketCheckout" class="basketCheckout" type="button">Checkout</button>';document.body.appendChild(b);b.querySelector('#basketClear').onclick=clearBasket;b.querySelector('#basketCheckout').onclick=openCheckout}if(!document.getElementById('checkoutBackdrop')){const c=document.createElement('div');c.id='checkoutBackdrop';c.className='checkoutBackdrop hidden';c.innerHTML='<section id="checkoutPanel" class="checkoutPanel"></section>';document.body.appendChild(c);c.onclick=e=>{if(e.target===c)closeCheckout()}}return true}
function hideBase(){document.querySelectorAll('#shell > .view').forEach(v=>v.classList.add('hidden'));document.querySelector('.bottomNav')?.classList.add('hidden');document.getElementById('roleHub')?.classList.add('hidden');document.getElementById('ordersWorkspace')?.classList.add('hidden')}
function closeMarket(){document.getElementById('basketBar')?.classList.add('hidden');document.getElementById('checkoutBackdrop')?.classList.add('hidden');marketWorkspace?.classList.add('hidden');window.BusinessLifeShell?.showActiveWorkspace?.()}
function marketHeader(title,sub){return `<div class="marketHeader"><button class="marketBack" type="button" data-market-back>‹</button><div class="marketHeaderCopy"><h1>${mh(title)}</h1><p>${mh(sub)}</p></div></div>`}
function bindBack(){const b=marketWorkspace.querySelector('[data-market-back]');if(b)b.onclick=closeMarket}
function logo(store,size=''){if(store.logo_data_url)return `<span class="storeLogo ${size}"><img src="${store.logo_data_url}" alt=""></span>`;return `<span class="storeLogo ${size}">${mh((store.store_name||'S').trim()[0]?.toUpperCase()||'S')}</span>`}
let storeEditorMap=null,storeEditorMarker=null,publicStoreMap=null;
function storeImagePreview(url,fallback){
  return url?'<img src="'+url+'" alt="">':'<span>'+fallback+'</span>';
}
function addStoreHelp(id,help,example,visibility,required){
  const input=document.getElementById(id),label=input?.closest('label');if(!input||!label||label.querySelector('.storeFieldHelp'))return;
  label.classList.add('guidedStoreField');
  const meta=document.createElement('span');meta.className='storeFieldMeta';meta.textContent=(required?'Required':'Optional')+' · '+visibility;
  const text=document.createElement('span');text.className='storeFieldHelp';text.textContent=help+(example?' Example: '+example:'');
  label.append(meta,text);
}
function storeMediaEditorMarkup(store){
  const gallery=Array.isArray(store.gallery_images)?store.gallery_images:[];
  const cover=store.cover_image||null;
  const galleryHtml=gallery.length?gallery.map(function(item,index){
    return '<figure class="storeGalleryEditItem"><img src="'+item.data_url+'" alt="'+mh(item.alt_text||('Store photo '+(index+1)))+'"><button type="button" data-delete-store-media="'+Number(item.id)+'" aria-label="Remove gallery photo">×</button></figure>';
  }).join(''):'<div class="storeGalleryEmpty">No presentation photos yet.</div>';
  return '<section id="storefrontV2Media" class="storefrontV2Section">'+
    '<div class="storefrontV2Head"><div><small>PUBLIC MEDIA</small><h3>Make the storefront recognisable</h3><p>Use real, clear images of the business. These images are public when the storefront is published.</p></div><span>Logo + cover + up to 8 photos</span></div>'+
    '<div class="storeMediaEditorGrid">'+
      '<article class="storeMediaEditorCard"><strong>Logo</strong><div id="storeLogoPreview" class="storeLogoPreview">'+storeImagePreview(store.logo_data_url,'Logo')+'</div><label class="storeUploadButton">Choose logo<input id="storeLogoInput" type="file" accept="image/png,image/jpeg,image/webp"></label><small>Square image works best. Prepared locally before upload.</small></article>'+
      '<article class="storeMediaEditorCard storeCoverEditor"><strong>Cover image</strong><div class="storeCoverPreview">'+storeImagePreview(store.cover_image_url,'Wide cover photo')+'</div><label class="storeUploadButton">Choose cover<input id="storeCoverInput" type="file" accept="image/png,image/jpeg,image/webp"></label>'+(cover?'<button class="storeMediaRemove" type="button" data-delete-store-media="'+Number(cover.id)+'">Remove cover</button>':'')+'<small>Use a wide photo of the shop, team, products or brand.</small></article>'+
    '</div>'+
    '<div class="storeGalleryEditor"><div><strong>Presentation gallery</strong><small>Public · Optional · maximum 8 photos</small></div><div class="storeGalleryEditGrid">'+galleryHtml+'</div><label class="storeUploadButton">Add gallery photos<input id="storeGalleryInput" type="file" accept="image/png,image/jpeg,image/webp" multiple></label></div>'+
    '<input id="storeLogoData" type="hidden" value="">'+
  '</section>';
}
function upgradeStorefrontFormV2(store){
  const form=document.getElementById('merchantStoreForm');if(!form||document.getElementById('storefrontV2Media'))return;
  form.insertAdjacentHTML('afterbegin',storeMediaEditorMarkup(store));
  const logoData=document.getElementById('storeLogoData');if(logoData)logoData.value=store.logo_data_url||'';

  const address=document.getElementById('storeAddress'),addressLabel=address?.closest('label');
  if(addressLabel){
    const location=document.createElement('section');location.id='storeLocationPanel';location.className='storefrontV2Section storeLocationPanel';
    location.innerHTML=
      '<div class="storefrontV2Head"><div><small>LOCATION</small><h3>Where customers can find you</h3><p>GPS and the map pin can be used internally. Your exact location is shown publicly only when you explicitly enable it.</p></div><span>Private by default</span></div>'+
      '<label class="guidedStoreField">Business presence<select id="storePresence"><option value="online">Online only</option><option value="physical">Physical store</option><option value="both">Online + physical store</option></select><span class="storeFieldMeta">Required · Public</span><span class="storeFieldHelp">Choose how customers can access this business.</span></label>'+
      '<div id="storePhysicalLocationFields">'+
        '<label>Location label<input id="storeLocationLabel" maxlength="160" placeholder="Main shop entrance"><span class="storeFieldMeta">Optional · Public when location sharing is ON</span><span class="storeFieldHelp">A short name customers can recognise.</span></label>'+
        '<div id="storeAddressSlot"></div>'+
        '<div class="storeMapActions"><button id="storeUseGps" type="button">Use current GPS</button><button id="storeSearchAddress" type="button">Search this address</button></div>'+
        '<div id="storeGeoResults" class="storeGeoResults" aria-live="polite"></div>'+
        '<div id="storeLocationMap" class="storeLocationMap"><div class="storeMapFallback">Tap the map to place the storefront entrance pin.</div></div>'+
        '<input id="storeLat" type="hidden"><input id="storeLng" type="hidden">'+
        '<label class="storePublicLocationToggle"><input id="storePublicLocation" type="checkbox"><span><strong>Show this location to customers</strong><small>Public · Optional. Turn this on only when customers may visit this exact place.</small></span></label>'+
        '<label>Opening hours<textarea id="storeOpeningHours" rows="3" maxlength="500" placeholder="Mon–Sat 9:00–18:00"></textarea><span class="storeFieldMeta">Optional · Public</span><span class="storeFieldHelp">Describe customer-facing opening hours. Operational schedules remain separate.</span></label>'+
        '<label>How to find us<textarea id="storeFinding" rows="2" maxlength="500" placeholder="Entrance beside the pharmacy; parking behind the building."></textarea><span class="storeFieldMeta">Optional · Public when location sharing is ON</span><span class="storeFieldHelp">Add landmarks or entrance instructions; do not add private personal details.</span></label>'+
      '</div>';
    addressLabel.parentNode.insertBefore(location,addressLabel);
    location.querySelector('#storeAddressSlot').appendChild(addressLabel);
    const presence=document.getElementById('storePresence');presence.value=store.presence_type||'online';
    document.getElementById('storeLocationLabel').value=store.location_label||'';
    document.getElementById('storeOpeningHours').value=store.opening_hours_text||'';
    document.getElementById('storeFinding').value=store.finding_instructions||'';
    document.getElementById('storeLat').value=store.pickup_lat==null?'':String(store.pickup_lat);
    document.getElementById('storeLng').value=store.pickup_lng==null?'':String(store.pickup_lng);
    document.getElementById('storePublicLocation').checked=Boolean(store.public_location_enabled);
  }

  addStoreHelp('storeName','This is the public name customers see.','Bacoor Home Market','Public',true);
  addStoreHelp('storeDescription','Explain what you sell in one or two clear sentences.','Fresh food and household essentials delivered locally.','Public',false);
  addStoreHelp('storeDomain','Controls which marketplace catalog areas the business appears in.','','Public',true);
  addStoreHelp('storeStatus','Draft keeps the storefront private; Published makes approved storefront information visible.','','Public state',true);
  addStoreHelp('storeAddress','Enter the customer-facing address or a useful address to search on the map.','Bacoor, Cavite','Public only when location sharing is ON',false);
  addStoreHelp('storeOpening','Shows customers whether the store is currently open, busy or closed.','','Public',true);
  addStoreHelp('storeEta','Typical preparation time before pickup or delivery handoff.','15','Public',true);
  syncStorePresence();
}
function syncStorePresence(){
  const select=document.getElementById('storePresence'),fields=document.getElementById('storePhysicalLocationFields'),share=document.getElementById('storePublicLocation');
  if(!select||!fields)return;
  const physical=select.value==='physical'||select.value==='both';
  fields.classList.toggle('hidden',!physical);
  if(!physical&&share)share.checked=false;
  if(physical)setTimeout(function(){initStoreLocationEditor().catch(function(){})},0);
}
function setStorePin(lat,lng,zoom){
  const latInput=document.getElementById('storeLat'),lngInput=document.getElementById('storeLng');
  if(latInput)latInput.value=Number(lat).toFixed(6);if(lngInput)lngInput.value=Number(lng).toFixed(6);
  if(!storeEditorMap||!window.L)return;
  if(!storeEditorMarker){
    storeEditorMarker=window.L.marker([lat,lng],{draggable:true}).addTo(storeEditorMap);
    storeEditorMarker.on('dragend',function(){const p=storeEditorMarker.getLatLng();setStorePin(p.lat,p.lng,false)});
  }else storeEditorMarker.setLatLng([lat,lng]);
  if(zoom!==false)storeEditorMap.setView([lat,lng],Number(zoom)||16);
}
async function loadMarketplaceLeaflet(){
  if(window.L)return window.L;
  if(!document.getElementById('leafletCss')){const link=document.createElement('link');link.id='leafletCss';link.rel='stylesheet';link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(link)}
  return new Promise(function(resolve,reject){
    const existing=document.getElementById('leafletJs');
    if(existing){existing.addEventListener('load',function(){window.L?resolve(window.L):reject(new Error('Map library unavailable'))},{once:true});existing.addEventListener('error',function(){reject(new Error('Map library unavailable'))},{once:true});return}
    const script=document.createElement('script');script.id='leafletJs';script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.onload=function(){resolve(window.L)};script.onerror=function(){reject(new Error('Map library unavailable'))};document.head.appendChild(script);
  });
}
async function initStoreLocationEditor(){
  const el=document.getElementById('storeLocationMap');if(!el||el.closest('.hidden'))return;
  const L=await loadMarketplaceLeaflet();
  if(storeEditorMap){storeEditorMap.remove();storeEditorMap=null;storeEditorMarker=null}
  const lat=Number(document.getElementById('storeLat')?.value),lng=Number(document.getElementById('storeLng')?.value),has=Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
  storeEditorMap=L.map(el,{zoomControl:true,attributionControl:true}).setView(has?[lat,lng]:[12.8797,121.7740],has?16:5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(storeEditorMap);
  if(has)setStorePin(lat,lng,false);
  storeEditorMap.on('click',function(event){setStorePin(event.latlng.lat,event.latlng.lng,16)});
  setTimeout(function(){storeEditorMap?.invalidateSize()},80);
}
function currentStorePosition(){
  return new Promise(function(resolve,reject){
    if(!navigator.geolocation)return reject(new Error('Location is not available on this device.'));
    navigator.geolocation.getCurrentPosition(function(p){resolve({lat:p.coords.latitude,lng:p.coords.longitude})},function(error){reject(new Error(error.message||'Location permission was not granted.'))},{enableHighAccuracy:true,timeout:12000,maximumAge:15000});
  });
}
async function searchStoreAddress(){
  const address=document.getElementById('storeAddress'),results=document.getElementById('storeGeoResults'),button=document.getElementById('storeSearchAddress');
  if(!address||!results)return;
  const query=address.value.trim();if(query.length<3){results.textContent='Enter at least 3 characters first.';return}
  if(button)button.disabled=true;results.textContent='Searching…';
  try{
    const businessId=Number(document.getElementById('storeBusinessId')?.value);
    const data=await mapi('/api/merchant/storefront/geocode?business_id='+encodeURIComponent(businessId)+'&q='+encodeURIComponent(query));
    results.innerHTML='';
    if(!data.results?.length){results.textContent='No matching address found. You can still place the pin manually.';return}
    data.results.forEach(function(item){
      const option=document.createElement('button');option.type='button';option.className='storeGeoResult';option.textContent=item.label;
      option.onclick=function(){address.value=item.label;setStorePin(item.lat,item.lng,16);results.innerHTML='';};
      results.appendChild(option);
    });
  }catch(error){results.textContent=error.message}finally{if(button)button.disabled=false}
}
async function prepareStoreImage(file,maxWidth,maxHeight,targetLength){
  if(!file)throw new Error('Choose an image first.');
  if(file.size>8*1024*1024)throw new Error('Image is too large. Choose a file under 8 MB.');
  const source=await new Promise(function(resolve,reject){const reader=new FileReader();reader.onerror=function(){reject(new Error('Could not read the image.'))};reader.onload=function(){resolve(String(reader.result||''))};reader.readAsDataURL(file)});
  const image=await new Promise(function(resolve,reject){const img=new Image();img.onload=function(){resolve(img)};img.onerror=function(){reject(new Error('Could not decode the image.'))};img.src=source});
  const scale=Math.min(1,maxWidth/image.naturalWidth,maxHeight/image.naturalHeight),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,canvas.width,canvas.height);
  let quality=.86,data=canvas.toDataURL('image/webp',quality);
  while(data.length>targetLength&&quality>.46){quality-=.08;data=canvas.toDataURL('image/webp',quality)}
  if(data.length>targetLength)throw new Error('This image remains too large after optimisation. Choose a smaller photo.');
  return data;
}
async function uploadStorefrontMedia(kind,file){
  const dataUrl=await prepareStoreImage(file,kind==='cover'?1600:1200,kind==='cover'?900:1200,390000);
  return mapi('/api/merchant/storefront/media',{method:'POST',body:JSON.stringify({business_id:Number(document.getElementById('storeBusinessId').value),media_kind:kind,data_url:dataUrl,alt_text:kind==='cover'?'Storefront cover':'Store presentation photo'})});
}
function refreshStoreMediaEditor(store){
  const host=document.getElementById('storefrontV2Media');if(!host)return;
  const pendingLogo=document.getElementById('storeLogoData')?.value||store.logo_data_url||'';
  host.outerHTML=storeMediaEditorMarkup(store);
  const logoData=document.getElementById('storeLogoData');if(logoData)logoData.value=pendingLogo;
  if(pendingLogo){const preview=document.getElementById('storeLogoPreview');if(preview)preview.innerHTML='<img src="'+pendingLogo+'" alt="">'}
  bindStoreMediaControls(store);
}
function bindStoreMediaControls(store){
  const logoInput=document.getElementById('storeLogoInput');if(logoInput)logoInput.onchange=async function(){try{const data=await prepareStoreImage(logoInput.files?.[0],720,720,285000);document.getElementById('storeLogoData').value=data;document.getElementById('storeLogoPreview').innerHTML='<img src="'+data+'" alt="">';mtoast('Logo prepared. Save the storefront to keep it.')}catch(error){mtoast(error.message)}};
  const coverInput=document.getElementById('storeCoverInput');if(coverInput)coverInput.onchange=async function(){try{coverInput.disabled=true;const item=await uploadStorefrontMedia('cover',coverInput.files?.[0]);store.cover_image=item;store.cover_image_url=item.data_url;mtoast('Cover image saved.');refreshStoreMediaEditor(store)}catch(error){mtoast(error.message);coverInput.disabled=false}};
  const galleryInput=document.getElementById('storeGalleryInput');if(galleryInput)galleryInput.onchange=async function(){
    const files=Array.from(galleryInput.files||[]),existing=Array.isArray(store.gallery_images)?store.gallery_images.length:0;
    if(!files.length)return;if(existing+files.length>8){mtoast('Gallery supports up to 8 photos.');galleryInput.value='';return}
    try{
      galleryInput.disabled=true;const added=[];
      for(const file of files)added.push(await uploadStorefrontMedia('gallery',file));
      store.gallery_images=[...(Array.isArray(store.gallery_images)?store.gallery_images:[]),...added];
      mtoast(files.length+' gallery photo'+(files.length===1?'':'s')+' saved.');refreshStoreMediaEditor(store);
    }catch(error){mtoast(error.message);galleryInput.disabled=false}
  };
  document.querySelectorAll('#storefrontV2Media [data-delete-store-media]').forEach(function(button){button.onclick=async function(){
    const id=Number(button.dataset.deleteStoreMedia);
    try{
      button.disabled=true;await mapi('/api/merchant/storefront/media/'+id+'?business_id='+encodeURIComponent(Number(store.business_id)),{method:'DELETE'});
      if(Number(store.cover_image?.id)===id){store.cover_image=null;store.cover_image_url=''}
      store.gallery_images=(Array.isArray(store.gallery_images)?store.gallery_images:[]).filter(function(item){return Number(item.id)!==id});
      mtoast('Storefront image removed.');refreshStoreMediaEditor(store);
    }catch(error){mtoast(error.message);button.disabled=false}
  }});
}
function bindStorefrontV2Controls(store){
  document.getElementById('storePresence')?.addEventListener('change',syncStorePresence);
  const gps=document.getElementById('storeUseGps');if(gps)gps.onclick=async function(){const msg=document.getElementById('storeGeoResults');try{gps.disabled=true;if(msg)msg.textContent='Reading device location…';const p=await currentStorePosition();setStorePin(p.lat,p.lng,16);if(msg)msg.textContent='GPS position set. Drag the pin to the exact storefront entrance if needed.'}catch(error){if(msg)msg.textContent=error.message}finally{gps.disabled=false}};
  const search=document.getElementById('storeSearchAddress');if(search)search.onclick=searchStoreAddress;
  bindStoreMediaControls(store);
  syncStorePresence();
}
async function renderPublicStoreMap(store,id){
  const el=document.getElementById(id||'publicStoreMap');if(!el||!store?.public_location_enabled)return;
  const lat=Number(store.pickup_lat),lng=Number(store.pickup_lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
  try{
    const L=await loadMarketplaceLeaflet();
    if(id==='publicStoreMap'&&publicStoreMap){publicStoreMap.remove();publicStoreMap=null}
    const map=L.map(el,{zoomControl:true,attributionControl:true,scrollWheelZoom:false}).setView([lat,lng],16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
    L.marker([lat,lng]).addTo(map).bindPopup(store.location_label||store.store_name||'Store').openPopup();
    if(id==='publicStoreMap')publicStoreMap=map;
    setTimeout(function(){map.invalidateSize()},80);
  }catch(error){el.textContent='Map unavailable. Use the directions links below.'}
}
function enhancePublicStorefrontV2(store){
  const hero=marketWorkspace.querySelector('.storefrontHero'),products=marketWorkspace.querySelector('.productGridMarket');if(!hero||!products)return;
  if(store.cover_image_url){const cover=document.createElement('div');cover.className='storefrontCoverPublic';cover.innerHTML='<img src="'+store.cover_image_url+'" alt="'+mh(store.store_name||'Store')+' cover">';hero.insertAdjacentElement('beforebegin',cover)}
  const gallery=Array.isArray(store.gallery_images)?store.gallery_images:[];
  if(gallery.length){const section=document.createElement('section');section.className='storefrontPublicGallery';section.innerHTML='<div class="storefrontPublicSectionHead"><strong>Store gallery</strong><span>'+gallery.length+' photo'+(gallery.length===1?'':'s')+'</span></div><div class="storefrontPublicGalleryGrid">'+gallery.map(function(item,index){return '<img src="'+item.data_url+'" alt="'+mh(item.alt_text||((store.store_name||'Store')+' photo '+(index+1)))+'">'}).join('')+'</div>';products.insertAdjacentElement('beforebegin',section)}
  const lat=Number(store.pickup_lat),lng=Number(store.pickup_lng);
  if(store.public_location_enabled&&Number.isFinite(lat)&&Number.isFinite(lng)){
    const location=document.createElement('section');location.className='storefrontPublicLocation';
    const maps='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(lat+','+lng);
    const waze='https://www.waze.com/ul?ll='+encodeURIComponent(lat+','+lng)+'&navigate=yes';
    location.innerHTML='<div class="storefrontPublicSectionHead"><div><strong>'+mh(store.location_label||'Visit this store')+'</strong><span>'+mh(store.pickup_address||'Pinned storefront location')+'</span></div><span>Public location</span></div><div id="publicStoreMap" class="publicStoreMap"></div>'+(store.opening_hours_text?'<p><b>Opening hours:</b> '+mh(store.opening_hours_text)+'</p>':'')+(store.finding_instructions?'<p><b>How to find us:</b> '+mh(store.finding_instructions)+'</p>':'')+'<div class="storeDirections"><a href="'+maps+'" target="_blank" rel="noopener">Open in Google Maps</a><a href="'+waze+'" target="_blank" rel="noopener">Open in Waze</a></div>';
    products.insertAdjacentElement('beforebegin',location);renderPublicStoreMap(store,'publicStoreMap');
  }
}


async function openMarketplace(domain='food'){ensureMarket();marketMode=domain;basket.clear();currentStore=null;if(!window.BusinessLifeShell?.openFeatureWorkspace?.('marketWorkspace')){hideBase();marketWorkspace.classList.remove('hidden')}updateBasket();await renderStoreList()}
async function renderStoreList(){marketWorkspace.innerHTML=marketHeader(marketMode==='food'?'Food Marketplace':'Non-food Marketplace','Local merchants in the Philippines Edition')+`<section class="marketHero"><span>Business & Life • Local marketplace</span><h2>${marketMode==='food'?'Good food, closer to home.':'Useful products from local sellers.'}</h2><p>Browse participating merchants, compare their published offers and place orders directly inside the ecosystem.</p></section><div class="marketFilters"><button class="marketFilter ${marketMode==='food'?'active':''}" data-domain="food">🍲 Food</button><button class="marketFilter ${marketMode==='non_food'?'active':''}" data-domain="non_food">🧺 Non-food</button></div><div id="storeGrid" class="storeGrid"><div class="marketEmpty">Loading merchants…</div></div>`;bindBack();marketWorkspace.querySelectorAll('[data-domain]').forEach(b=>b.onclick=()=>{marketMode=b.dataset.domain;renderStoreList()});try{const stores=await mapi(`/api/marketplace/storefronts?domain=${encodeURIComponent(marketMode)}`);const host=document.getElementById('storeGrid');host.innerHTML=stores.length?stores.map(s=>`<button class="storeCard" type="button" data-store="${s.business_id}">${logo(s)}<span class="storeCardCopy"><strong>${mh(s.store_name)}</strong><p>${mh(s.description||'Local merchant')}</p><span class="storeMeta"><span class="${s.opening_status}">${mh(mnice(s.opening_status))}</span><span>~${Number(s.preparation_eta_minutes)||15} min</span><span>${s.product_count} products</span>${s.min_price!=null?`<span>from ${mphp(s.min_price)}</span>`:''}</span></span><span class="storeOpen">›</span></button>`).join(''):'<div class="marketEmpty">No participating merchants have published a store in this category yet.</div>';host.querySelectorAll('[data-store]').forEach(b=>b.onclick=()=>openStore(Number(b.dataset.store)))}catch(e){document.getElementById('storeGrid').innerHTML=`<div class="marketEmpty">${mh(e.message)}</div>`}}
async function openStore(businessId){try{currentStore=await mapi(`/api/marketplace/storefronts/${businessId}`);basket.clear();updateBasket();renderStore()}catch(e){mtoast(e.message)}}
function renderStore(){const s=currentStore;marketWorkspace.innerHTML=marketHeader(s.store_name,`${mnice(s.merchant_domain)} • ${mnice(s.opening_status)}`)+`<section class="storefrontHero">${logo(s)}<div class="storefrontHeroCopy"><h2>${mh(s.store_name)}</h2><p>${mh(s.description||'Local merchant')}</p><span class="storeMeta"><span class="${s.opening_status}">${mh(mnice(s.opening_status))}</span><span>Prep ~${Number(s.preparation_eta_minutes)||15} min</span>${s.pickup_enabled?'<span>Pickup</span>':''}${s.delivery_enabled?'<span>Delivery</span>':''}</span></div></section><div class="productGridMarket">${s.products.length?s.products.map(p=>productCard(p)).join(''):'<div class="marketEmpty">This merchant has not published products yet.</div>'}</div>`;bindBack();marketWorkspace.querySelector('[data-market-back]').onclick=renderStoreList;marketWorkspace.querySelectorAll('[data-add-product]').forEach(b=>b.onclick=()=>addBasket(Number(b.dataset.addProduct)));enhancePublicStorefrontV2(s)}
function productCard(p){const icon=p.product_domain==='food'?'🍽️':'📦';const ai=p.image_source_type==='ai_generated';return `<article class="marketProduct"><div class="marketProductImage">${p.image_data_url?`<img src="${p.image_data_url}" alt="${mh(p.name)}">`:icon}</div>${ai?'<span class="aiReferenceLabel">AI-generated reference image</span>':''}<small>${mh(p.category)} • ${mh(p.unit_code)}</small><strong>${mh(p.name)}</strong><p>${mh(p.description||'')}</p><div class="productBottom"><span class="productPrice">${mphp(p.selling_price)}</span><button class="addBasket" type="button" data-add-product="${p.id}" aria-label="Add ${mh(p.name)}">+</button></div></article>`}
function addBasket(id){const p=currentStore?.products?.find(x=>Number(x.id)===id);if(!p)return;basket.set(id,(basket.get(id)||0)+1);updateBasket();mtoast(`${p.name} added`)}
function clearBasket(){basket.clear();updateBasket()}
function basketTotals(){let count=0,total=0;if(!currentStore)return{count,total};for(const[id,q]of basket){const p=currentStore.products.find(x=>Number(x.id)===id);if(p){count+=q;total+=Number(p.selling_price)*q}}return{count,total}}
function updateBasket(){const bar=document.getElementById('basketBar');const t=basketTotals();if(!bar)return;if(!t.count){bar.classList.add('hidden');return}bar.classList.remove('hidden');document.getElementById('basketStore').textContent=currentStore?.store_name||'Basket';document.getElementById('basketText').textContent=`${t.count} item${t.count===1?'':'s'} • ${mphp(t.total)}`}
function closeCheckout(){document.getElementById('checkoutBackdrop')?.classList.add('hidden')}
function openCheckout(){if(!currentStore||!basket.size)return;const c=document.getElementById('checkoutBackdrop'),p=document.getElementById('checkoutPanel');const t=basketTotals();const items=[...basket].map(([id,q])=>({p:currentStore.products.find(x=>Number(x.id)===id),q})).filter(x=>x.p);const fulfil=[];if(currentStore.pickup_enabled)fulfil.push('<option value="pickup">Pickup at merchant</option>');if(currentStore.delivery_enabled)fulfil.push('<option value="delivery">Delivery</option>');const pays=[];if(currentStore.cash_enabled)pays.push('<option value="cash">Cash</option>');if(currentStore.online_enabled)pays.push('<option value="online">Online / digital</option>');p.innerHTML=`<h2>Checkout</h2><p>${mh(currentStore.store_name)} • prices in PHP</p><div data-bl-pricing="customer_checkout"></div><div class="checkoutItems">${items.map(x=>`<div class="checkoutLine"><span>${x.q} × ${mh(x.p.name)}</span><strong>${mphp(Number(x.p.selling_price)*x.q)}</strong></div>`).join('')}<div class="checkoutLine checkoutTotal"><span>Total products</span><strong>${mphp(t.total)}</strong></div></div><form id="marketCheckoutForm" class="checkoutForm"><label>Fulfilment<select id="checkoutFulfil">${fulfil.join('')}</select></label><label>Payment<select id="checkoutPayment">${pays.join('')}</select></label><label id="checkoutAddressLabel" style="display:none">Delivery address<textarea id="checkoutAddress" rows="2">${mh(marketMe?.account?.address||'')}</textarea></label><label>Order note<textarea id="checkoutNote" rows="2" placeholder="Optional preparation note"></textarea></label><div id="checkoutMessage" class="checkoutMessage"></div><div class="checkoutActions"><button class="closeCheckout" type="button">Back</button><button class="placeOrder">Place order</button></div></form>`;c.classList.remove('hidden');const f=p.querySelector('#marketCheckoutForm'),ful=p.querySelector('#checkoutFulfil');const sync=()=>{p.querySelector('#checkoutAddressLabel').style.display=ful.value==='delivery'?'block':'none';if(ful.value==='delivery'&&p.querySelector('#checkoutPayment').value==='cash'){const online=[...p.querySelector('#checkoutPayment').options].find(o=>o.value==='online');if(online)p.querySelector('#checkoutPayment').value='online'}};ful.onchange=sync;sync();p.querySelector('.closeCheckout').onclick=closeCheckout;f.onsubmit=submitCheckout;document.dispatchEvent(new CustomEvent('abl:marketplace-checkout-rendered',{detail:{businessId:Number(currentStore.business_id)}}))}
async function submitCheckout(e){e.preventDefault();const msg=document.getElementById('checkoutMessage');msg.textContent='';try{const items=[...basket].map(([product_id,quantity])=>({product_id,quantity}));const o=await mapi('/api/marketplace/checkout',{method:'POST',body:JSON.stringify({business_id:currentStore.business_id,items,fulfilment_method:document.getElementById('checkoutFulfil').value,payment_method:document.getElementById('checkoutPayment').value,delivery_address:document.getElementById('checkoutAddress')?.value||'',note:document.getElementById('checkoutNote').value})});basket.clear();updateBasket();closeCheckout();mtoast(`Order ${o.order_number} placed.`);setTimeout(()=>closeMarket(),1100)}catch(err){msg.textContent=err.message}}

async function openMerchantStore(){ensureMarket();if(!window.BusinessLifeShell?.openFeatureWorkspace?.('marketWorkspace')){hideBase();marketWorkspace.classList.remove('hidden')}document.getElementById('basketBar').classList.add('hidden');await renderMerchantStore()}
async function renderMerchantStore(){marketWorkspace.innerHTML=marketHeader('My Storefront','Publish your business into the local Marketplace')+'<div class="marketEmpty">Loading storefront…</div>';bindBack();try{[merchantStore,merchantInventory]=await Promise.all([mapi('/api/merchant/storefront'),mapi('/api/inventory')]);marketWorkspace.innerHTML=marketHeader('My Storefront','What customers see in Food / Non-food Marketplace')+storeForm(merchantStore)+directProductForm(merchantInventory)+catalogSection(merchantStore.products||[]);bindBack();upgradeStorefrontFormV2(merchantStore);bindStoreForm();bindStorefrontV2Controls(merchantStore);bindDirectProductForm();bindCatalog()}catch(e){marketWorkspace.innerHTML=marketHeader('My Storefront','Marketplace settings')+`<div class="marketEmpty">${mh(e.message)}</div>`;bindBack()}}
function storeForm(s){return `<section class="merchantStoreCard"><h2>Public storefront</h2><p>Accounting, supplier relationships and internal margins are never published here.</p><div data-bl-pricing="merchant"></div><form id="merchantStoreForm" class="merchantStoreForm"><input id="storeBusinessId" type="hidden" value="${s.business_id}"><label>Store name<input id="storeName" value="${mh(s.store_name)}" required></label><label>Description<textarea id="storeDescription" rows="3">${mh(s.description||'')}</textarea></label><div class="merchantStoreForm two"><label>Store type<select id="storeDomain"><option value="food" ${s.merchant_domain==='food'?'selected':''}>Food</option><option value="non_food" ${s.merchant_domain==='non_food'?'selected':''}>Non-food</option><option value="mixed" ${s.merchant_domain==='mixed'?'selected':''}>Mixed</option></select></label><label>Publication<select id="storeStatus"><option value="draft" ${s.publication_status==='draft'?'selected':''}>Draft / private</option><option value="published" ${s.publication_status==='published'?'selected':''}>Published</option><option value="paused" ${s.publication_status==='paused'?'selected':''}>Paused</option></select></label></div><label>Pickup address<input id="storeAddress" value="${mh(s.pickup_address||'')}" placeholder="Public pickup location"></label><div class="merchantStoreForm two"><label>Opening status<select id="storeOpening"><option value="open" ${s.opening_status==='open'?'selected':''}>Open</option><option value="busy" ${s.opening_status==='busy'?'selected':''}>Busy</option><option value="closed" ${s.opening_status==='closed'?'selected':''}>Closed</option></select></label><label>Preparation ETA (minutes)<input id="storeEta" type="number" min="1" max="240" value="${Number(s.preparation_eta_minutes)||15}"></label></div><div class="toggleGrid"><label class="toggleBox"><input id="storePickup" type="checkbox" ${s.pickup_enabled?'checked':''}> Pickup</label><label class="toggleBox"><input id="storeDelivery" type="checkbox" ${s.delivery_enabled?'checked':''}> Delivery</label><label class="toggleBox"><input id="storeCash" type="checkbox" ${s.cash_enabled?'checked':''}> Cash</label><label class="toggleBox"><input id="storeOnline" type="checkbox" ${s.online_enabled?'checked':''}> Online/digital</label></div><div class="privacyToggle"><strong>Public Merchant rating</strong><p>When enabled, verified completed orders can contribute to your public rating and Top Merchants. You can turn it off and leave the Marketplace.</p><label class="toggleBox"><input id="storeReputation" type="checkbox" ${s.public_reputation_enabled?'checked':''}> Participate in public Merchant reputation</label></div><div class="privacyToggle"><strong>Price comparison — explicit opt-in</strong><p>Default is OFF. If OFF, your products remain visible and purchasable but are excluded from Lowest listed price / Lowest unit price and price-based rankings.</p><label class="toggleBox"><input id="storeCompare" type="checkbox" ${s.price_comparison_enabled?'checked':''}> Allow my eligible products in price comparison</label></div><div class="storeFormActions"><button class="importProducts" id="importLegacy" type="button">Import current Menu</button><button class="saveStore">Save storefront</button></div><div id="storeMessage" class="avatarHint"></div></form></section>`}
function directProductForm(inventory){
  const options=(inventory||[]).map(i=>`<option value="${i.id}" data-unit="${mh(i.unit)}">${mh(i.item)} — ${Number(i.quantity).toLocaleString('en-PH',{maximumFractionDigits:4})} ${mh(i.unit)}</option>`).join('');
  return `<section class="merchantStoreCard directProductCard"><div class="sectionHead"><div><h2>Add a direct-sale product</h2><p>Fresh food, packaged food and non-food resale use existing stock directly — no recipe required.</p></div></div><form id="directProductForm" class="merchantStoreForm"><label>Product type<select id="directKind"><option value="fresh_direct">Fresh / direct food</option><option value="packaged_resale">Packaged food resale</option><option value="non_food_resale">Non-food resale</option></select></label><label>Product name<input id="directName" required placeholder="Carrots"></label><label>Stock source<select id="directInventory" required>${options||'<option value="">Add stock first</option>'}</select></label><div class="merchantStoreForm two"><label>Stock used per sold unit<input id="directStockQty" type="number" min="0.0001" step="0.0001" value="1" required></label><label>Stored unit<input id="directStockUnit" value="${mh(inventory?.[0]?.unit||'unit')}" readonly></label></div><div class="merchantStoreForm two"><label>Category<input id="directCategory" value="General"></label><label>Selling price ₱<input id="directPrice" type="number" min="0" step="0.01" required></label></div><label>Customer description<textarea id="directDescription" rows="2"></textarea></label><div id="directProductPreview" class="avatarHint"></div><button class="saveStore">Create private product</button><div id="directProductMessage" class="avatarHint"></div></form></section>`;
}
function bindDirectProductForm(){
  const form=document.getElementById('directProductForm'),inventory=document.getElementById('directInventory');
  if(!form||!inventory)return;
  const sync=()=>{const option=inventory.selectedOptions?.[0],unit=option?.dataset?.unit||'unit';document.getElementById('directStockUnit').value=unit;const qty=Number(document.getElementById('directStockQty').value||0);document.getElementById('directProductPreview').textContent=qty>0?`Each sale consumes ${qty} ${unit} from ${option?.textContent?.split(' — ')[0]||'stock'}.`:'Enter how much stock one sold unit consumes.'};
  inventory.onchange=sync;document.getElementById('directStockQty').oninput=sync;sync();
  form.onsubmit=async e=>{e.preventDefault();const msg=document.getElementById('directProductMessage');msg.textContent='Saving…';try{const option=inventory.selectedOptions?.[0],unit=option?.dataset?.unit||'unit';await mapi('/api/merchant/storefront/products',{method:'POST',body:JSON.stringify({business_id:Number(merchantStore.business_id),product_kind:document.getElementById('directKind').value,name:document.getElementById('directName').value,inventory_id:Number(inventory.value),quantity_per_unit:Number(document.getElementById('directStockQty').value),unit_code:`${document.getElementById('directStockQty').value} ${unit}`,category:document.getElementById('directCategory').value,selling_price:Number(document.getElementById('directPrice').value),description:document.getElementById('directDescription').value,published:false})});mtoast('Direct-sale product created as Private.');await renderMerchantStore()}catch(err){msg.textContent=err.message}};
}
function catalogSection(products){return `<section class="merchantStoreCard"><h2>Marketplace catalog</h2><p>Prepared recipes come from Products & recipes. Fresh, packaged and non-food items consume their linked stock directly. Use one clean product image; AI never publishes automatically.</p><div class="merchantCatalogList">${products.length?products.map(p=>{const images=Array.isArray(p.images)?p.images:[];const primary=images.find(x=>x.is_primary&&x.approval_status==='approved'&&x.public_visible);const draft=images.find(x=>x.source_type==='ai_generated'&&x.approval_status==='draft');const visual=primary?.data_url||draft?.data_url||p.image_data_url||'';const aiPrimary=primary?.source_type==='ai_generated';const canGenerate=p.product_domain==='food'&&p.product_kind==='prepared_food'&&Boolean(p.legacy_product_id);return `<div class="merchantProductRow merchantProductMediaRow"><div class="merchantProductVisual">${visual?`<img src="${visual}" alt="${mh(p.name)}">`:'<span>＋ photo</span>'}</div><div class="merchantProductCopy"><strong>${mh(p.name)}</strong><small>${mh(p.category)} • ${mphp(p.selling_price)} • ${p.legacy_product_id?'Prepared recipe':p.inventory_id?`${mnice(p.product_kind)} · ${Number(p.quantity_per_unit).toLocaleString('en-PH',{maximumFractionDigits:4})} ${mh(p.inventory_unit||'stock')}/sale`:'Marketplace product'}</small>${aiPrimary?'<span class="aiReferenceLabel">AI-generated reference image</span>':''}${draft?'<span class="aiDraftLabel">AI image draft · review before use</span>':''}<div class="merchantImageActions">${canGenerate?`<button class="imageAction" type="button" data-generate-image="${p.id}">${draft?'Generate another':'Generate AI image'}</button>`:''}${draft?`<button class="imageAction primary" type="button" data-approve-image="${p.id}" data-media-id="${draft.id}">Use as primary</button><button class="imageAction danger" type="button" data-archive-image="${p.id}" data-media-id="${draft.id}">Discard</button>`:''}</div></div><button class="publishButton ${p.published?'on':''}" type="button" data-toggle-product="${p.id}" data-published="${p.published?'1':'0'}">${p.published?'Published':'Private'}</button></div>`}).join(''):'<div class="marketEmpty">No Marketplace products yet. Import your current Menu or add products in a later catalog update.</div>'}</div></section>`}
function bindStoreForm(){const f=document.getElementById('merchantStoreForm');if(!f)return;f.onsubmit=async e=>{e.preventDefault();const msg=document.getElementById('storeMessage');msg.textContent='';try{await mapi('/api/merchant/storefront',{method:'PUT',body:JSON.stringify({business_id:Number(document.getElementById('storeBusinessId').value),store_name:document.getElementById('storeName').value,description:document.getElementById('storeDescription').value,merchant_domain:document.getElementById('storeDomain').value,publication_status:document.getElementById('storeStatus').value,pickup_address:document.getElementById('storeAddress').value,presence_type:document.getElementById('storePresence')?.value||'online',public_location_enabled:Boolean(document.getElementById('storePublicLocation')?.checked),location_label:document.getElementById('storeLocationLabel')?.value||'',finding_instructions:document.getElementById('storeFinding')?.value||'',opening_hours_text:document.getElementById('storeOpeningHours')?.value||'',pickup_lat:document.getElementById('storeLat')?.value||null,pickup_lng:document.getElementById('storeLng')?.value||null,opening_status:document.getElementById('storeOpening').value,preparation_eta_minutes:Number(document.getElementById('storeEta').value),pickup_enabled:document.getElementById('storePickup').checked,delivery_enabled:document.getElementById('storeDelivery').checked,cash_enabled:document.getElementById('storeCash').checked,online_enabled:document.getElementById('storeOnline').checked,public_reputation_enabled:document.getElementById('storeReputation').checked,price_comparison_enabled:document.getElementById('storeCompare').checked,logo_data_url:document.getElementById('storeLogoData')?.value||merchantStore?.logo_data_url||''})});mtoast('Storefront saved.');await renderMerchantStore()}catch(err){msg.textContent=err.message}};document.getElementById('importLegacy').onclick=async()=>{try{const r=await mapi('/api/merchant/storefront/import-legacy',{method:'POST',body:JSON.stringify({business_id:Number(document.getElementById('storeBusinessId').value)})});mtoast(`${r.imported_or_updated} Menu products imported/updated.`);await renderMerchantStore()}catch(e){mtoast(e.message)}}}
function bindCatalog(){
  marketWorkspace.querySelectorAll('[data-toggle-product]').forEach(b=>b.onclick=async()=>{try{const id=Number(b.dataset.toggleProduct),published=b.dataset.published!=='1';await mapi(`/api/merchant/storefront/products/${id}`,{method:'PATCH',body:JSON.stringify({published})});mtoast(published?'Product published.':'Product hidden from Marketplace.');await renderMerchantStore()}catch(e){mtoast(e.message)}});
  marketWorkspace.querySelectorAll('[data-generate-image]').forEach(b=>b.onclick=async()=>{if(b.disabled)return;b.disabled=true;const label=b.textContent;b.textContent='Generating…';try{await mapi(`/api/merchant/storefront/products/${Number(b.dataset.generateImage)}/images/generate`,{method:'POST',body:'{}'});mtoast('AI image draft created. Review it before use.');await renderMerchantStore()}catch(e){mtoast(e.message);b.disabled=false;b.textContent=label}});
  marketWorkspace.querySelectorAll('[data-approve-image]').forEach(b=>b.onclick=async()=>{try{await mapi(`/api/merchant/storefront/products/${Number(b.dataset.approveImage)}/images/${Number(b.dataset.mediaId)}/approve`,{method:'POST',body:JSON.stringify({primary:true})});mtoast('Image approved as primary.');await renderMerchantStore()}catch(e){mtoast(e.message)}});
  marketWorkspace.querySelectorAll('[data-archive-image]').forEach(b=>b.onclick=async()=>{try{await mapi(`/api/merchant/storefront/products/${Number(b.dataset.archiveImage)}/images/${Number(b.dataset.mediaId)}/archive`,{method:'POST',body:'{}'});mtoast('Image draft discarded.');await renderMerchantStore()}catch(e){mtoast(e.message)}});
}
function showPlatformStore(){ensureMarket();hideBase();marketWorkspace.classList.remove('hidden');document.getElementById('basketBar').classList.add('hidden');marketWorkspace.innerHTML=marketHeader('Platform Store','Business & Life — Philippines')+`<section class="platformStoreNotice"><h2>Philippines Platform Store</h2><p>This destination is reserved for the separate Philippines Shopify store owned by the platform. It will not reuse products, collections or pricing from Ireland. The catalog stays empty until verified Philippines-local products and the dedicated Shopify store are configured.</p></section>`;bindBack()}

function applyMarketState(detail){const state=detail?.snapshot?detail:window.BusinessLifeProfileState;if(state?.snapshot)marketMe=state.snapshot}
async function decorateMarket(detail){if(!ensureMarket()||!mtok())return;const state=detail?.snapshot?detail:window.BusinessLifeProfileState;applyMarketState(state);if(!marketMe)return;const role=state?.surface==='profile'?state.activeRole:null;const q=document.getElementById('marketQuickButton');if(role==='merchant'){const top=document.querySelector('.shellProfileControls');if(top&&!q){const b=document.createElement('button');b.id='marketQuickButton';b.className='merchantWorkspaceButton';b.type='button';b.textContent='Storefront';b.onclick=openMerchantStore;top.insertAdjacentElement('beforebegin',b)}}else q?.remove();const hub=document.getElementById('roleHub');if(hub&&role==='customer'){const tiles=[...hub.querySelectorAll('[data-hub-feature="Marketplace"]')];if(tiles[0])tiles[0].onclick=()=>openMarketplace('food');if(tiles[1])tiles[1].onclick=()=>openMarketplace('non_food');const platform=hub.querySelector('[data-hub-feature="Platform Store"]');if(platform)platform.onclick=showPlatformStore}}
function observeMarket(){document.addEventListener('abl:profile-state',e=>decorateMarket(e.detail).catch(()=>{}),{passive:true})}
async function boot(){ensureMarket();observeMarket();await decorateMarket(window.BusinessLifeProfileState)}
window.BusinessLifeMarketplace=Object.freeze({openMerchantStore,openMarketplace,showPlatformStore,renderPublicStoreMap});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
