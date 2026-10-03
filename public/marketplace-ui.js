let marketMe=null,marketWorkspace=null,marketMode='food',currentStore=null,basket=new Map(),merchantStore=null;
let merchantCatalogSchema=null;
let currentStoreCollection='';
let currentStoreDomain='all';
let currentFoodSection='';
let currentRetailSearch='';
let currentRetailCategory='';
let currentRetailFacetValues={};
let retailCatalogState={q:'',category:'',status:'all',stock:'all',media:'all',collection_id:'',offset:0,limit:50};
let retailCatalogSelection=new Set();
let retailCatalogScannerStream=null;
let retailCatalogScanFrame=0;
let activeDeliveryQuote=null,activeDeliveryDestination=null,deliveryQuoteSeq=0;
const mtok=()=>window.ABLSession?.authenticated()?'cookie-session':'';
const mh=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const mphp=v=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(v)||0);
const mnice=v=>String(v||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
async function mapi(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};const r=await fetch(path,{...options,headers});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||`Request failed (${r.status})`);return b}
function mtoast(msg){const t=document.getElementById('roleToast');if(t){t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800)}else alert(msg)}
function ensureMarket(){
  const shell=document.getElementById('shell');if(!shell)return false;
  if(!document.getElementById('marketWorkspace')){
    marketWorkspace=document.createElement('section');marketWorkspace.id='marketWorkspace';marketWorkspace.className='marketWorkspace hidden';
    shell.querySelector('.topbar')?.insertAdjacentElement('afterend',marketWorkspace);
  }else marketWorkspace=document.getElementById('marketWorkspace');
  if(!document.getElementById('basketBar')){
    const b=document.createElement('div');b.id='basketBar';b.className='basketBar hidden';
    b.innerHTML='<div class="basketSummary"><small id="basketStore">Basket</small><strong id="basketText">0 items</strong></div><button id="basketClear" class="basketClear" type="button">Clear</button><button id="basketCheckout" class="basketCheckout" type="button">Checkout</button>';
    document.body.appendChild(b);b.querySelector('#basketClear').onclick=clearBasket;b.querySelector('#basketCheckout').onclick=openCheckout;
  }
  if(!document.getElementById('checkoutBackdrop')){
    const checkout=document.createElement('div');checkout.id='checkoutBackdrop';checkout.className='checkoutBackdrop hidden';checkout.innerHTML='<section id="checkoutPanel" class="checkoutPanel"></section>';
    document.body.appendChild(checkout);checkout.onclick=e=>{if(e.target===checkout)closeCheckout()};
  }
  if(!document.getElementById('productDetailBackdrop')){
    const detail=document.createElement('div');detail.id='productDetailBackdrop';detail.className='productDetailBackdrop hidden';detail.innerHTML='<section id="productDetailPanel" class="productDetailPanel"></section>';
    document.body.appendChild(detail);detail.onclick=e=>{if(e.target===detail)closeProductDetail()};
  }
  if(!document.getElementById('catalogEditorBackdrop')){
    const editor=document.createElement('div');editor.id='catalogEditorBackdrop';editor.className='catalogEditorBackdrop hidden';editor.innerHTML='<section id="catalogEditorPanel" class="catalogEditorPanel"></section>';
    document.body.appendChild(editor);editor.onclick=e=>{if(e.target===editor)closeCatalogEditor()};
  }
  return true;
}
function hideBase(){document.querySelectorAll('#shell > .view').forEach(v=>v.classList.add('hidden'));document.querySelector('.bottomNav')?.classList.add('hidden');document.getElementById('roleHub')?.classList.add('hidden');document.getElementById('ordersWorkspace')?.classList.add('hidden')}
function closeMarket(){document.getElementById('basketBar')?.classList.add('hidden');closeCheckout();closeProductDetail();closeCatalogEditor();marketWorkspace?.classList.add('hidden');window.BusinessLifeShell?.showActiveWorkspace?.()}
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
async function openStore(businessId){try{
  currentStore=await mapi(`/api/marketplace/storefronts/${businessId}`);
  currentStoreCollection='';currentFoodSection='';currentRetailSearch='';currentRetailCategory='';currentRetailFacetValues={};
  currentStoreDomain=storefrontMode(currentStore)==='mixed'?'all':storefrontMode(currentStore);
  basket.clear();updateBasket();renderStore()
}catch(e){mtoast(e.message)}}
async function openMarketplaceReport(context){const loader=window.BusinessLifeFeatureLoader;if(!loader?.openSafetyReport)return mtoast('Safety reporting is not available yet.');try{await loader.openSafetyReport(context)}catch{}}
function storefrontMode(store=currentStore){
  const mode=String(store?.presentation_mode||store?.merchant_domain||'food');
  return ['food','non_food','mixed'].includes(mode)?mode:'food';
}
function storefrontDomainTabs(store){
  if(storefrontMode(store)!=='mixed')return '';
  const tabs=[['all','All'],['food','Food'],['non_food','Shop']];
  return '<div class="adaptiveStoreTabs" role="tablist">'+tabs.map(([value,label])=>
    '<button type="button" role="tab" data-store-domain="'+value+'" class="'+(currentStoreDomain===value?'active':'')+'">'+label+'</button>'
  ).join('')+'</div>';
}
function storefrontCollections(store){
  const rows=(Array.isArray(store?.collections)?store.collections:[]).filter(collection=>Array.isArray(collection.product_ids)&&collection.product_ids.length);
  if(!rows.length)return '';
  return '<div class="storeCollectionBar" aria-label="Store collections">'+
    '<button type="button" data-store-collection="" class="'+(!currentStoreCollection?'active':'')+'">All</button>'+
    rows.map(collection=>'<button type="button" data-store-collection="'+mh(collection.code||String(collection.id))+'" class="'+(String(currentStoreCollection)===String(collection.code||collection.id)?'active':'')+'">'+mh(collection.name)+'</button>').join('')+
  '</div>';
}
function foodSectionEntries(store){
  const out=[];
  for(const menu of Array.isArray(store?.menus)?store.menus:[]){
    for(const section of Array.isArray(menu.sections)?menu.sections:[]){
      const ids=(section.items||[]).map(item=>Number(item.product_id)).filter(Number.isInteger);
      if(!ids.length)continue;
      out.push({
        key:String(menu.id)+':'+String(section.id||section.code),
        label:section.name||section.code||'Menu',
        product_ids:ids
      });
    }
  }
  return out;
}
function storefrontFoodMenuBar(store){
  const sections=foodSectionEntries(store);
  if(!sections.length)return '';
  return '<div class="foodMenuBar" aria-label="Menu categories">'+
    '<button type="button" data-food-section="" class="'+(!currentFoodSection?'active':'')+'">All</button>'+
    sections.map(section=>'<button type="button" data-food-section="'+mh(section.key)+'" class="'+(currentFoodSection===section.key?'active':'')+'">'+mh(section.label)+'</button>').join('')+
  '</div>';
}
function storefrontRetailDiscovery(store){
  const facets=store?.retail_facets||{},categories=Array.isArray(facets.categories)?facets.categories:[],attributes=(Array.isArray(facets.attributes)?facets.attributes:[]).slice(0,3);
  return '<section class="retailDiscovery">'+
    '<label class="retailStoreSearch"><span>Search products</span><input id="storeRetailSearch" value="'+mh(currentRetailSearch)+'" placeholder="Search this store"></label>'+
    '<label><span>Category</span><select id="storeRetailCategory"><option value="">All categories</option>'+
      categories.map(item=>'<option value="'+mh(item.value)+'" '+(currentRetailCategory===item.value?'selected':'')+'>'+mh(item.value)+' ('+Number(item.count||0)+')</option>').join('')+
    '</select></label>'+
    attributes.map(attribute=>'<label><span>'+mh(attribute.label)+'</span><select data-store-facet="'+mh(attribute.code)+'"><option value="">All</option>'+
      (attribute.values||[]).map(value=>'<option value="'+mh(value)+'" '+(String(currentRetailFacetValues[attribute.code]||'')===String(value)?'selected':'')+'>'+mh(value)+'</option>').join('')+
    '</select></label>').join('')+
    '<button id="clearRetailStoreFilters" type="button">Clear</button>'+
  '</section>';
}
function productFacetValues(product,code){
  const out=new Set(),entry=product?.catalog_attributes?.[code];
  if(entry&&entry.value!==undefined&&entry.value!==null&&entry.value!=='')out.add(String(entry.value));
  for(const variant of Array.isArray(product?.variants)?product.variants:[]){
    for(const option of Array.isArray(variant.option_values)?variant.option_values:[]){
      if(String(option.option_code)===String(code)&&option.value_label)out.add(String(option.value_label));
    }
  }
  return [...out];
}
function storeVisibleProducts(store){
  let all=Array.isArray(store?.products)?store.products:[];
  const mode=storefrontMode(store);
  if(mode==='mixed'&&currentStoreDomain!=='all')all=all.filter(product=>product.product_domain===currentStoreDomain);
  else if(mode==='food')all=all.filter(product=>product.product_domain==='food');
  else if(mode==='non_food')all=all.filter(product=>product.product_domain==='non_food');

  if(currentStoreDomain==='food'||mode==='food'){
    if(currentFoodSection){
      const section=foodSectionEntries(store).find(row=>row.key===currentFoodSection);
      if(section){const ids=new Set(section.product_ids);all=all.filter(product=>product.product_domain!=='food'||ids.has(Number(product.id)))}
    }
  }

  const retailActive=currentStoreDomain==='non_food'||mode==='non_food';
  if(retailActive){
    if(currentStoreCollection){
      const collection=(store.collections||[]).find(row=>String(row.code||row.id)===String(currentStoreCollection));
      if(collection){
        const ids=new Set((collection.product_ids||[]).map(Number));
        all=all.filter(product=>product.product_domain!=='non_food'||ids.has(Number(product.id)));
      }
    }
    const q=String(currentRetailSearch||'').trim().toLowerCase();
    if(q)all=all.filter(product=>product.product_domain!=='non_food'||[
      product.name,product.description,product.brand,product.model,product.category
    ].some(value=>String(value||'').toLowerCase().includes(q)));
    if(currentRetailCategory)all=all.filter(product=>product.product_domain!=='non_food'||String(product.category||'')===String(currentRetailCategory));
    for(const [code,value] of Object.entries(currentRetailFacetValues||{})){
      if(!value)continue;
      all=all.filter(product=>product.product_domain!=='non_food'||productFacetValues(product,code).some(candidate=>String(candidate)===String(value)));
    }
  }
  return all;
}
function productOrderable(product){
  if(product?.orderability&&product.orderability.orderable===false)return false;
  if(product?.product_domain==='food'&&product?.availability&&product.availability.orderable===false)return false;
  return true;
}
function productAvailabilityCopy(product){
  const orderable=productOrderable(product);
  if(orderable)return product.product_domain==='food'?'Available now':'In stock';
  const reason=String(product?.orderability?.reason||product?.orderability?.state||product?.availability?.state||'unavailable');
  if(reason==='outside_menu_schedule')return'Not available at this time';
  if(reason==='sold_out_today')return'Sold out today';
  if(reason==='unavailable_until')return'Temporarily unavailable';
  if(reason==='out_of_stock')return'Out of stock';
  return'Unavailable';
}
function productNeedsConfiguration(product){
  return Boolean(product?.variant_mode&&(product.variants||[]).length)||Boolean((product?.modifier_groups||[]).length);
}
function productStartingPrice(product){
  const values=[Number(product?.selling_price)||0];
  for(const variant of Array.isArray(product?.variants)?product.variants:[])if(variant.price_override!=null)values.push(Number(variant.price_override));
  return Math.min(...values.filter(Number.isFinite));
}
function marketplaceAllergenInfo(p){
  if(p?.product_domain!=='food'||p?.product_kind!=='prepared_food')return '';
  if(!p?.allergen_review_current)return '<div class="marketAllergenPending"><strong>Ingredient disclosure pending review</strong><span>Contact the Merchant for current ingredient information before ordering.</span></div>';
  const info=p?.allergen_information;if(!info)return '';
  const names=rows=>(Array.isArray(rows)?rows:[]).map(x=>mh(x.label||x.code||'')).filter(Boolean);
  const contains=names(info.contains),may=names(info.may_contain),cross=names(info.cross_contact);
  return '<div class="marketAllergenInfo"><strong>Ingredient disclosure</strong>'+
    '<span><b>Contains:</b> '+(contains.length?contains.join(', '):'None declared')+'</span>'+
    '<span><b>May contain:</b> '+(may.length?may.join(', '):'None declared')+'</span>'+
    '<span><b>Cross-contact risk:</b> '+(cross.length?cross.join(', '):'None declared')+'</span>'+
    '<small>'+mh(info.notice||'Contact the Merchant if you need more ingredient information before ordering.')+'</small></div>';
}
function productCard(p){
  const food=p.product_domain==='food',icon=food?'🍽️':'📦',ai=p.image_source_type==='ai_generated',orderable=productOrderable(p),config=productNeedsConfiguration(p);
  const price=productStartingPrice(p),pricePrefix=(p.variants||[]).some(v=>v.price_override!=null)?'From ':'';
  const meta=food
    ?mh(p.category)+' · '+mh(p.unit_code)
    :[p.brand,p.model,p.category].filter(Boolean).map(mh).join(' · ');
  return '<article class="marketProduct '+(food?'foodProductCard':'retailProductCard')+'" data-open-product="'+Number(p.id)+'">'+
    '<div class="marketProductImage">'+(p.image_data_url?'<img src="'+p.image_data_url+'" alt="'+mh(p.name)+'">':icon)+'</div>'+
    (ai?'<span class="aiReferenceLabel">AI-generated reference image</span>':'')+
    '<small>'+meta+'</small><strong>'+mh(p.name)+'</strong><p>'+mh(p.description||'')+'</p>'+
    (food?marketplaceAllergenInfo(p):'')+
    '<span class="productAvailability '+(orderable?'available':'unavailable')+'">'+mh(productAvailabilityCopy(p))+'</span>'+
    '<button class="marketProductReport" type="button" data-report-product="'+Number(p.id)+'">Report product</button>'+
    '<div class="productBottom"><span class="productPrice">'+pricePrefix+mphp(price)+'</span>'+
      '<button class="addBasket" type="button" data-add-product="'+Number(p.id)+'" '+(orderable?'':'disabled')+' aria-label="'+(config?'Choose options for ':'Add ')+mh(p.name)+'">'+(config?'Choose':'+')+'</button></div>'+
  '</article>';
}
function renderStoreProductGroups(store,visible){
  if(storefrontMode(store)==='mixed'&&currentStoreDomain==='all'){
    const food=visible.filter(product=>product.product_domain==='food'),retail=visible.filter(product=>product.product_domain==='non_food');
    return '<section class="adaptiveDomainGroup"><div class="adaptiveGroupHead"><h3>Food</h3><span>'+food.length+' items</span></div><div class="productGridMarket foodGrid">'+
      (food.length?food.map(productCard).join(''):'<div class="marketEmpty">No Food items available right now.</div>')+
      '</div></section><section class="adaptiveDomainGroup"><div class="adaptiveGroupHead"><h3>Shop products</h3><span>'+retail.length+' items</span></div><div class="productGridMarket retailGrid">'+
      (retail.length?retail.map(productCard).join(''):'<div class="marketEmpty">No Retail products available right now.</div>')+
      '</div></section>';
  }
  return '<div class="productGridMarket '+((currentStoreDomain==='food'||storefrontMode(store)==='food')?'foodGrid':'retailGrid')+'">'+
    (visible.length?visible.map(productCard).join(''):'<div class="marketEmpty">No products match this view right now.</div>')+
  '</div>';
}
function renderStore(){
  const s=currentStore,mode=storefrontMode(s);
  if(mode!=='mixed')currentStoreDomain=mode;
  const retailView=currentStoreDomain==='non_food'||mode==='non_food';
  const foodView=currentStoreDomain==='food'||mode==='food';
  const visible=storeVisibleProducts(s);
  marketWorkspace.innerHTML=
    marketHeader(s.store_name,`${mnice(s.merchant_domain)} • ${mnice(s.opening_status)}`)+
    `<section class="storefrontHero">${logo(s)}<div class="storefrontHeroCopy"><h2>${mh(s.store_name)}</h2><p>${mh(s.description||'Local merchant')}</p><span class="storeMeta"><span class="${s.opening_status}">${mh(mnice(s.opening_status))}</span><span>Prep ~${Number(s.preparation_eta_minutes)||15} min</span>${s.pickup_enabled?'<span>Pickup</span>':''}${s.delivery_enabled?'<span>Delivery</span>':''}</span></div></section>`+
    storefrontDomainTabs(s)+
    (foodView?storefrontFoodMenuBar(s):'')+
    (retailView?storefrontCollections(s)+storefrontRetailDiscovery(s):'')+
    '<div class="marketSafetyBar"><button class="marketSafetyAction" id="reportMerchant" type="button">Report merchant</button><span>Private report · not a public review</span></div>'+
    renderStoreProductGroups(s,visible);
  bindBack();
  marketWorkspace.querySelector('[data-market-back]').onclick=renderStoreList;
  document.getElementById('reportMerchant').onclick=()=>openMarketplaceReport({related_type:'merchant',related_id:Number(s.business_id),display_label:`Merchant: ${s.store_name}`,suggested_category:'Scam / fraud / suspicious activity'});
  marketWorkspace.querySelectorAll('[data-store-domain]').forEach(button=>button.onclick=()=>{
    currentStoreDomain=button.dataset.storeDomain||'all';currentStoreCollection='';currentFoodSection='';currentRetailSearch='';currentRetailCategory='';currentRetailFacetValues={};renderStore();
  });
  marketWorkspace.querySelectorAll('[data-food-section]').forEach(button=>button.onclick=()=>{currentFoodSection=button.dataset.foodSection||'';renderStore()});
  marketWorkspace.querySelectorAll('[data-store-collection]').forEach(button=>button.onclick=()=>{currentStoreCollection=button.dataset.storeCollection||'';renderStore()});
  const retailSearch=document.getElementById('storeRetailSearch');if(retailSearch){
    retailSearch.onchange=()=>{currentRetailSearch=retailSearch.value;renderStore()};
    retailSearch.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();currentRetailSearch=retailSearch.value;renderStore()}};
  }
  const retailCategory=document.getElementById('storeRetailCategory');if(retailCategory)retailCategory.onchange=()=>{currentRetailCategory=retailCategory.value;renderStore()};
  marketWorkspace.querySelectorAll('[data-store-facet]').forEach(select=>select.onchange=()=>{
    const code=select.dataset.storeFacet;if(select.value)currentRetailFacetValues[code]=select.value;else delete currentRetailFacetValues[code];renderStore();
  });
  document.getElementById('clearRetailStoreFilters')?.addEventListener('click',()=>{currentRetailSearch='';currentRetailCategory='';currentRetailFacetValues={};currentStoreCollection='';renderStore()});
  marketWorkspace.querySelectorAll('[data-open-product]').forEach(card=>card.onclick=event=>{
    if(event.target.closest('[data-report-product]')||event.target.closest('[data-add-product]'))return;
    openProductDetail(Number(card.dataset.openProduct));
  });
  marketWorkspace.querySelectorAll('[data-report-product]').forEach(button=>button.onclick=event=>{
    event.stopPropagation();const product=s.products.find(x=>Number(x.id)===Number(button.dataset.reportProduct));
    if(product)openMarketplaceReport({related_type:'marketplace_product',related_id:Number(product.id),display_label:`Product: ${product.name} — ${s.store_name}`,suggested_category:'Illegal / restricted item or service'});
  });
  marketWorkspace.querySelectorAll('[data-add-product]').forEach(button=>button.onclick=event=>{event.stopPropagation();addBasket(Number(button.dataset.addProduct))});
  enhancePublicStorefrontV2(s);
}
function productVariantAxes(product){
  const map=new Map();
  for(const variant of Array.isArray(product?.variants)?product.variants:[]){
    for(const option of Array.isArray(variant.option_values)?variant.option_values:[]){
      const code=String(option.option_code||''),label=String(option.option_label||code),valueCode=String(option.value_code||''),valueLabel=String(option.value_label||valueCode);
      if(!code||!valueCode)continue;
      const axis=map.get(code)||{code,label,values:new Map()};
      axis.values.set(valueCode,valueLabel);map.set(code,axis);
    }
  }
  return [...map.values()].map(axis=>({...axis,values:[...axis.values.entries()].map(([code,label])=>({code,label}))}));
}
function defaultVariant(product){
  const variants=Array.isArray(product?.variants)?product.variants:[];
  return variants.find(variant=>variant.active!==false&&variant.in_stock!==false)||variants.find(variant=>variant.active!==false)||variants[0]||null;
}
function variantSelectionMap(variant){
  return Object.fromEntries((variant?.option_values||[]).map(option=>[String(option.option_code),String(option.value_code)]));
}
function selectedDetailVariant(product,panel=document.getElementById('productDetailPanel')){
  const axes=productVariantAxes(product);if(!axes.length)return null;
  const controls=[...(panel?.querySelectorAll('[data-variant-axis]')||[])];
  const selected=Object.fromEntries(axes.map(axis=>{
    const control=controls.find(item=>String(item.dataset.variantAxis||'')===String(axis.code));
    return[axis.code,String(control?.value||'')];
  }));
  return (product.variants||[]).find(variant=>(variant.option_values||[]).every(option=>selected[String(option.option_code)]===String(option.value_code)))||null;
}
function modifierOptionLookup(product){
  const map=new Map();
  for(const group of Array.isArray(product?.modifier_groups)?product.modifier_groups:[])for(const option of Array.isArray(group.options)?group.options:[])map.set(Number(option.id),{group,option});
  return map;
}
function selectedDetailModifierIds(product,panel=document.getElementById('productDetailPanel')){
  const ids=[];
  panel?.querySelectorAll('[data-modifier-option]:checked').forEach(input=>ids.push(Number(input.value)));
  panel?.querySelectorAll('select[data-modifier-select]').forEach(select=>{if(select.value)ids.push(Number(select.value))});
  return ids.filter(Number.isInteger).sort((a,b)=>a-b);
}
function validateModifierSelection(product,ids){
  const selected=new Set(ids.map(Number));
  for(const group of Array.isArray(product?.modifier_groups)?product.modifier_groups:[]){
    const count=(group.options||[]).filter(option=>selected.has(Number(option.id))).length;
    if(count<Number(group.min_select||0)||count>Number(group.max_select||1)){
      const exact=Number(group.min_select)===Number(group.max_select);
      throw new Error(exact?`Choose ${Number(group.min_select)} option${Number(group.min_select)===1?'':'s'} for ${group.name}.`:`Choose ${group.min_select}–${group.max_select} options for ${group.name}.`);
    }
  }
}
function productConfiguredUnitPrice(product,variant,modifierIds=[]){
  let price=variant?.price_override==null?Number(product.selling_price||0):Number(variant.price_override);
  const lookup=modifierOptionLookup(product);
  for(const id of modifierIds)price+=Number(lookup.get(Number(id))?.option?.price_delta||0);
  return Math.round((price+Number.EPSILON)*100)/100;
}
function productSelectionLabel(product,variant,modifierIds=[]){
  const parts=[];
  if(variant)parts.push((variant.option_values||[]).map(option=>option.value_label).filter(Boolean).join(' / '));
  const lookup=modifierOptionLookup(product);
  for(const id of modifierIds){const item=lookup.get(Number(id));if(item?.option?.name)parts.push(item.option.name)}
  return parts.filter(Boolean).join(' · ');
}
function productDetailGallery(product){
  const images=Array.isArray(product?.images)?product.images.filter(image=>image.approval_status==='approved'&&image.public_visible!==false):[];
  const urls=[product?.image_data_url,...images.map(image=>image.data_url)].filter(Boolean);
  const unique=[...new Set(urls)];
  if(!unique.length)return '<div class="productDetailHero productDetailFallback">'+(product?.product_domain==='food'?'🍽️':'📦')+'</div>';
  return '<div class="productDetailGallery"><div class="productDetailHero"><img id="productDetailHeroImage" src="'+unique[0]+'" alt="'+mh(product.name)+'"></div>'+
    (unique.length>1?'<div class="productDetailThumbs">'+unique.map((url,index)=>'<button type="button" data-detail-image="'+index+'" class="'+(index===0?'active':'')+'"><img src="'+url+'" alt=""></button>').join('')+'</div>':'')+
  '</div>';
}
function productAttributeMarkup(product){
  const entries=Object.values(product?.catalog_attributes||{});
  if(!entries.length)return '';
  return '<dl class="productDetailSpecs">'+entries.map(entry=>{
    const value=entry.value===true?'Yes':entry.value===false?'No':String(entry.value??'');
    return '<div><dt>'+mh(entry.label||'Detail')+'</dt><dd>'+mh(value)+(entry.unit_family?' '+mh(entry.unit_family):'')+'</dd></div>';
  }).join('')+'</dl>';
}
function productVariantMarkup(product){
  const axes=productVariantAxes(product);if(!axes.length)return '';
  const initial=variantSelectionMap(defaultVariant(product));
  return '<section class="productConfigSection"><h3>Choose variant</h3>'+axes.map(axis=>
    '<label>'+mh(axis.label)+'<select data-variant-axis="'+mh(axis.code)+'">'+axis.values.map(value=>'<option value="'+mh(value.code)+'" '+(initial[axis.code]===value.code?'selected':'')+'>'+mh(value.label)+'</option>').join('')+'</select></label>'
  ).join('')+'<div id="productVariantStatus" class="productVariantStatus"></div></section>';
}
function productModifierMarkup(product){
  const groups=Array.isArray(product?.modifier_groups)?product.modifier_groups:[];
  if(!groups.length)return '';
  return groups.map(group=>{
    const min=Number(group.min_select||0),max=Number(group.max_select||1),required=min>0;
    const helper=required?(min===max?`Choose ${min}`:`Choose ${min}–${max}`):max>1?`Optional · up to ${max}`:'Optional';
    if(max===1){
      return '<section class="productConfigSection"><div class="productConfigHead"><h3>'+mh(group.name)+'</h3><span>'+mh(helper)+'</span></div><select data-modifier-select="'+Number(group.id)+'">'+
        (!required?'<option value="">No selection</option>':'<option value="">Choose one</option>')+
        (group.options||[]).filter(option=>option.active!==false).map(option=>'<option value="'+Number(option.id)+'">'+mh(option.name)+(Number(option.price_delta||0)>0?' +'+mphp(option.price_delta):'')+'</option>').join('')+
      '</select></section>';
    }
    return '<section class="productConfigSection"><div class="productConfigHead"><h3>'+mh(group.name)+'</h3><span>'+mh(helper)+'</span></div><div class="modifierChoices">'+
      (group.options||[]).filter(option=>option.active!==false).map(option=>'<label><input type="checkbox" data-modifier-option="'+Number(group.id)+'" value="'+Number(option.id)+'"><span><strong>'+mh(option.name)+'</strong>'+(Number(option.price_delta||0)>0?'<small>+'+mphp(option.price_delta)+'</small>':'')+'</span></label>').join('')+
    '</div></section>';
  }).join('');
}
function closeProductDetail(){
  const backdrop=document.getElementById('productDetailBackdrop');backdrop?.classList.add('hidden');
  if(document.getElementById('checkoutBackdrop')?.classList.contains('hidden')!==false)document.body.style.overflow='';
}
function refreshProductDetailPrice(product){
  const panel=document.getElementById('productDetailPanel');if(!panel)return;
  const variant=selectedDetailVariant(product,panel),modifierIds=selectedDetailModifierIds(product,panel);
  const price=productConfiguredUnitPrice(product,variant,modifierIds),button=panel.querySelector('[data-detail-add]'),priceNode=panel.querySelector('#productDetailPrice'),status=panel.querySelector('#productVariantStatus');
  if(priceNode)priceNode.textContent=mphp(price);
  let orderable=productOrderable(product);
  if(productVariantAxes(product).length){
    orderable=orderable&&Boolean(variant)&&variant.in_stock!==false;
    if(status)status.textContent=!variant?'Choose a valid combination.':variant.in_stock===false?'This variant is out of stock.':'Variant in stock.';
  }
  if(button){button.disabled=!orderable;button.textContent=orderable?'Add to basket · '+mphp(price):productAvailabilityCopy(product)}
}
function openProductDetail(id){
  const product=currentStore?.products?.find(row=>Number(row.id)===Number(id));if(!product)return;
  const backdrop=document.getElementById('productDetailBackdrop'),panel=document.getElementById('productDetailPanel');if(!backdrop||!panel)return;
  const brandLine=product.product_domain==='non_food'?[product.brand,product.model,product.condition_code?mnice(product.condition_code):''].filter(Boolean).map(mh).join(' · '):mh(product.category||'');
  panel.innerHTML='<div class="productDetailTop"><button type="button" class="productDetailClose" aria-label="Close">×</button></div>'+
    productDetailGallery(product)+
    '<div class="productDetailBody"><small>'+brandLine+'</small><h2>'+mh(product.name)+'</h2><p>'+mh(product.description||'')+'</p>'+
    '<div class="productDetailPriceRow"><strong id="productDetailPrice">'+mphp(productStartingPrice(product))+'</strong><span class="productAvailability '+(productOrderable(product)?'available':'unavailable')+'">'+mh(productAvailabilityCopy(product))+'</span></div>'+
    productAttributeMarkup(product)+
    productVariantMarkup(product)+
    productModifierMarkup(product)+
    (product.product_domain==='food'?marketplaceAllergenInfo(product):'')+
    '<label class="productQuantity">Quantity<input id="productDetailQuantity" type="number" min="1" max="99" step="1" value="1" inputmode="numeric"></label>'+
    '<button type="button" class="productDetailAdd" data-detail-add="'+Number(product.id)+'"></button>'+
    '<button type="button" class="marketProductReport productDetailReport" data-report-product="'+Number(product.id)+'">Report product</button>'+
    '</div>';
  backdrop.classList.remove('hidden');document.body.style.overflow='hidden';
  panel.querySelector('.productDetailClose').onclick=closeProductDetail;
  panel.querySelectorAll('[data-detail-image]').forEach(button=>button.onclick=()=>{
    const image=button.querySelector('img'),hero=panel.querySelector('#productDetailHeroImage');if(hero&&image)hero.src=image.src;
    panel.querySelectorAll('[data-detail-image]').forEach(x=>x.classList.toggle('active',x===button));
  });
  panel.querySelectorAll('[data-variant-axis],select[data-modifier-select],[data-modifier-option]').forEach(control=>control.onchange=()=>{
    if(control.matches('[data-modifier-option]')){
      const groupId=Number(control.dataset.modifierOption),group=(product.modifier_groups||[]).find(row=>Number(row.id)===groupId);
      if(group&&Number(group.max_select)>1){
        const checked=[...panel.querySelectorAll('[data-modifier-option="'+groupId+'"]:checked')];
        if(checked.length>Number(group.max_select)){control.checked=false;mtoast('Choose up to '+group.max_select+' options for '+group.name+'.')}
      }
    }
    refreshProductDetailPrice(product);
  });
  panel.querySelector('[data-detail-add]').onclick=()=>{
    try{
      const variant=selectedDetailVariant(product,panel),modifierIds=selectedDetailModifierIds(product,panel),quantity=Math.max(1,Math.min(99,Number(panel.querySelector('#productDetailQuantity')?.value)||1));
      if(productVariantAxes(product).length&&(!variant||variant.in_stock===false))throw new Error('Choose an in-stock variant.');
      validateModifierSelection(product,modifierIds);
      addBasketLine(product,{variant,modifierIds,quantity});
      closeProductDetail();
    }catch(error){mtoast(error.message)}
  };
  panel.querySelector('[data-report-product]').onclick=()=>openMarketplaceReport({related_type:'marketplace_product',related_id:Number(product.id),display_label:`Product: ${product.name} — ${currentStore?.store_name||''}`,suggested_category:'Illegal / restricted item or service'});
  refreshProductDetailPrice(product);
}
function basketSelectionKey(productId,variantId=null,modifierIds=[]){
  return [Number(productId),Number(variantId)||0,[...modifierIds].map(Number).filter(Number.isInteger).sort((a,b)=>a-b).join(',')].join(':');
}
function addBasketLine(product,{variant=null,modifierIds=[],quantity=1}={}){
  if(!productOrderable(product))return mtoast(productAvailabilityCopy(product));
  const qty=Math.max(1,Math.min(99,Number(quantity)||1)),variantId=variant?.id?Number(variant.id):null,mods=[...modifierIds].map(Number).filter(Number.isInteger).sort((a,b)=>a-b);
  const key=basketSelectionKey(product.id,variantId,mods),existing=basket.get(key),unitPrice=productConfiguredUnitPrice(product,variant,mods),selectionLabel=productSelectionLabel(product,variant,mods);
  if(existing)existing.quantity+=qty;
  else basket.set(key,{
    key,product_id:Number(product.id),variant_id:variantId,modifier_option_ids:mods,quantity:qty,
    unit_price:unitPrice,display_name:product.name,selection_label:selectionLabel
  });
  updateBasket();mtoast(product.name+' added');
}
function addBasket(id){
  const product=currentStore?.products?.find(row=>Number(row.id)===Number(id));if(!product)return;
  if(!productOrderable(product))return mtoast(productAvailabilityCopy(product));
  if(productNeedsConfiguration(product))return openProductDetail(id);
  addBasketLine(product,{quantity:1});
}
function clearBasket(){basket.clear();updateBasket()}
function basketTotals(){
  let count=0,total=0;
  for(const line of basket.values()){count+=Number(line.quantity||0);total+=Number(line.unit_price||0)*Number(line.quantity||0)}
  return{count,total:Math.round((total+Number.EPSILON)*100)/100};
}
function updateBasket(){
  const bar=document.getElementById('basketBar'),total=basketTotals();if(!bar)return;
  if(!total.count){bar.classList.add('hidden');return}
  bar.classList.remove('hidden');document.getElementById('basketStore').textContent=currentStore?.store_name||'Basket';
  document.getElementById('basketText').textContent=`${total.count} item${total.count===1?'':'s'} • ${mphp(total.total)}`;
}
function closeCheckout(){document.getElementById('checkoutBackdrop')?.classList.add('hidden');if(document.getElementById('productDetailBackdrop')?.classList.contains('hidden')!==false)document.body.style.overflow=''}
function checkoutItemsPayload(){return [...basket.values()].map(line=>({
  product_id:Number(line.product_id),
  variant_id:line.variant_id==null?null:Number(line.variant_id),
  modifier_option_ids:[...(line.modifier_option_ids||[])],
  quantity:Number(line.quantity)
}))}

function checkoutDeliverySelected(){return document.getElementById('checkoutFulfil')?.value==='delivery'}
function checkoutDeliveryFee(quote=activeDeliveryQuote){return Number(quote?.customer_delivery_total??quote?.fee??0)||0}
function checkoutQuoteExpired(quote=activeDeliveryQuote){const expiry=Date.parse(quote?.expires_at||'');return !Number.isFinite(expiry)||expiry<=Date.now()}
function checkoutQuoteExpiryLabel(quote=activeDeliveryQuote){const expiry=new Date(quote?.expires_at||'');return Number.isFinite(expiry.getTime())?expiry.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}):''}
function invalidateCheckoutDeliveryQuote(message=''){
  activeDeliveryQuote=null;activeDeliveryDestination=null;deliveryQuoteSeq++;
  const results=document.getElementById('checkoutAddressResults');if(results)results.innerHTML='';
  const quote=document.getElementById('checkoutDeliveryQuote');if(quote)quote.innerHTML='<span>Delivery price will appear here before you place the order.</span>';
  const msg=document.getElementById('checkoutMessage');if(msg&&message)msg.textContent=message;
  updateCheckoutTotals();
}
function updateCheckoutTotals(){
  const t=basketTotals(),delivery=checkoutDeliverySelected(),feeRow=document.getElementById('checkoutDeliveryLine'),fee=document.getElementById('checkoutDeliveryAmount'),final=document.getElementById('checkoutFinalAmount'),place=document.querySelector('#marketCheckoutForm .placeOrder');
  if(!final||!place)return;
  if(!delivery){
    feeRow?.classList.add('hidden');final.textContent=mphp(t.total);place.disabled=false;return;
  }
  feeRow?.classList.remove('hidden');
  if(activeDeliveryQuote&&!checkoutQuoteExpired(activeDeliveryQuote)){
    const deliveryFee=checkoutDeliveryFee(activeDeliveryQuote);if(fee)fee.textContent=mphp(deliveryFee);final.textContent=mphp(t.total+deliveryFee);place.disabled=false;
  }else{
    if(activeDeliveryQuote&&checkoutQuoteExpired(activeDeliveryQuote)){activeDeliveryQuote=null;activeDeliveryDestination=null}
    if(fee)fee.textContent='Calculate delivery';final.textContent='—';place.disabled=true;
  }
}
function renderCheckoutAddressResults(results=[]){
  const host=document.getElementById('checkoutAddressResults');if(!host)return;
  if(!results.length){host.innerHTML='';return}
  host.innerHTML=results.map((item,index)=>'<button type="button" class="checkoutAddressResult" data-delivery-address="'+index+'"><strong>'+mh(item.label||'')+'</strong><small>Select this delivery address</small></button>').join('');
  host.querySelectorAll('[data-delivery-address]').forEach(button=>button.onclick=async()=>{
    const item=results[Number(button.dataset.deliveryAddress)];if(!item)return;
    const address=document.getElementById('checkoutAddress');if(address)address.value=item.label||'';
    host.innerHTML='';await requestCheckoutDeliveryQuote(item);
  });
}
async function requestCheckoutDeliveryQuote(destination){
  const msg=document.getElementById('checkoutMessage'),quoteBox=document.getElementById('checkoutDeliveryQuote');
  const lat=Number(destination?.lat),lng=Number(destination?.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)){if(msg)msg.textContent='Choose a valid delivery address first.';return}
  const seq=++deliveryQuoteSeq;activeDeliveryQuote=null;activeDeliveryDestination=null;updateCheckoutTotals();
  if(msg)msg.textContent='Calculating delivery price…';
  if(quoteBox)quoteBox.innerHTML='<span>Calculating the current Delivery price…</span>';
  try{
    const quote=await mapi('/api/delivery/quote',{method:'POST',body:JSON.stringify({
      business_id:Number(currentStore.business_id),items:checkoutItemsPayload(),dropoff_lat:lat,dropoff_lng:lng
    })});
    if(seq!==deliveryQuoteSeq)return;
    activeDeliveryQuote=quote;activeDeliveryDestination={label:String(destination.label||document.getElementById('checkoutAddress')?.value||''),lat,lng};
    const distance=Number(quote.route_distance_km),expiry=checkoutQuoteExpiryLabel(quote);
    if(quoteBox)quoteBox.innerHTML='<div><span>Delivery</span><strong>'+mphp(checkoutDeliveryFee(quote))+'</strong></div><small>'+(Number.isFinite(distance)?distance.toFixed(1)+' km · ':'')+(expiry?'Price valid until '+mh(expiry):'Current quote')+'</small>';
    if(msg)msg.textContent='Final price calculated. Review the total before placing the order.';
    updateCheckoutTotals();
  }catch(error){
    if(seq!==deliveryQuoteSeq)return;
    activeDeliveryQuote=null;activeDeliveryDestination=null;
    if(quoteBox)quoteBox.innerHTML='<span>Delivery price could not be calculated yet.</span>';
    if(msg)msg.textContent=error.message;updateCheckoutTotals();
  }
}
async function searchCheckoutDeliveryAddress(){
  const address=document.getElementById('checkoutAddress'),button=document.getElementById('checkoutAddressSearch'),msg=document.getElementById('checkoutMessage');
  const query=String(address?.value||'').trim();
  if(query.length<3){if(msg)msg.textContent='Enter at least 3 characters for the delivery address.';return}
  invalidateCheckoutDeliveryQuote();
  if(button)button.disabled=true;if(msg)msg.textContent='Searching for the delivery address…';
  try{
    const data=await mapi('/api/delivery/address-search?q='+encodeURIComponent(query));
    const results=Array.isArray(data?.results)?data.results:[];
    if(!results.length){if(msg)msg.textContent='No matching delivery address was found. Add more street, city or province detail and try again.';return}
    renderCheckoutAddressResults(results);if(msg)msg.textContent='Choose the matching address to calculate the delivery price.';
  }catch(error){if(msg)msg.textContent=error.message}finally{if(button)button.disabled=false}
}
function useCheckoutDeliveryGps(){
  const button=document.getElementById('checkoutUseGps'),msg=document.getElementById('checkoutMessage');
  if(!window.isSecureContext||!navigator.geolocation){if(msg)msg.textContent='Current location is not available. Search the delivery address instead.';return}
  invalidateCheckoutDeliveryQuote();if(button)button.disabled=true;if(msg)msg.textContent='Waiting for location permission…';
  navigator.geolocation.getCurrentPosition(async position=>{
    try{
      const lat=position.coords.latitude,lng=position.coords.longitude;
      const data=await mapi('/api/me/address/reverse',{method:'POST',body:JSON.stringify({latitude:lat,longitude:lng})});
      const label=String(data?.address||'Current location');const address=document.getElementById('checkoutAddress');if(address)address.value=label;
      await requestCheckoutDeliveryQuote({label,lat,lng});
    }catch(error){if(msg)msg.textContent=error.message}finally{if(button)button.disabled=false}
  },error=>{
    if(button)button.disabled=false;
    if(msg)msg.textContent=error?.code===1?'Location permission was not granted. Search the delivery address instead.':'Current location could not be read. Search the delivery address instead.';
  },{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
}
function openCheckout(){
  if(!currentStore||!basket.size)return;
  activeDeliveryQuote=null;activeDeliveryDestination=null;deliveryQuoteSeq++;
  const c=document.getElementById('checkoutBackdrop'),p=document.getElementById('checkoutPanel'),t=basketTotals();
  const items=[...basket.values()].map(line=>({
    line,
    product:currentStore.products.find(product=>Number(product.id)===Number(line.product_id))
  })).filter(item=>item.product);
  const fulfil=[];if(currentStore.pickup_enabled)fulfil.push('<option value="pickup">Pickup at merchant</option>');if(currentStore.delivery_enabled)fulfil.push('<option value="delivery">Delivery</option>');
  const pays=[];if(currentStore.cash_enabled)pays.push('<option value="cash">Cash</option>');if(currentStore.online_enabled)pays.push('<option value="online">Online / digital</option>');
  p.innerHTML='<h2>Checkout</h2><p>'+mh(currentStore.store_name)+' • prices in PHP</p><div data-bl-pricing="customer_checkout"></div><div class="checkoutItems">'+items.map(item=>'<div class="checkoutLine"><span>'+Number(item.line.quantity)+' × '+mh(item.product.name)+(item.line.selection_label?'<small>'+mh(item.line.selection_label)+'</small>':'')+'</span><strong>'+mphp(Number(item.line.unit_price)*Number(item.line.quantity))+'</strong></div>').join('')+'<div class="checkoutLine checkoutTotal"><span>Total products</span><strong>'+mphp(t.total)+'</strong></div><div id="checkoutDeliveryLine" class="checkoutLine hidden"><span>Delivery</span><strong id="checkoutDeliveryAmount">Calculate delivery</strong></div><div id="checkoutFinalLine" class="checkoutLine checkoutGrandTotal"><span>Final total</span><strong id="checkoutFinalAmount">'+mphp(t.total)+'</strong></div></div><form id="marketCheckoutForm" class="checkoutForm"><label>Fulfilment<select id="checkoutFulfil">'+fulfil.join('')+'</select></label><label>Payment<select id="checkoutPayment">'+pays.join('')+'</select></label><section id="checkoutDeliveryBox" class="checkoutDeliveryBox hidden"><label>Delivery address<textarea id="checkoutAddress" rows="2">'+mh(marketMe?.account?.address||'')+'</textarea></label><div class="checkoutDeliveryActions"><button id="checkoutAddressSearch" type="button">Confirm address & calculate price</button><button id="checkoutUseGps" type="button">Use current location</button></div><div id="checkoutAddressResults" class="checkoutAddressResults" aria-live="polite"></div><div id="checkoutDeliveryQuote" class="checkoutDeliveryQuote"><span>Delivery price will appear here before you place the order.</span></div></section><label>Order note<textarea id="checkoutNote" rows="2" placeholder="Optional preparation note"></textarea></label><div id="checkoutMessage" class="checkoutMessage"></div><div class="checkoutActions"><button class="closeCheckout" type="button">Back</button><button class="placeOrder" type="submit">Place order</button></div></form>';
  c.classList.remove('hidden');document.body.style.overflow='hidden';
  const form=p.querySelector('#marketCheckoutForm'),ful=p.querySelector('#checkoutFulfil'),payment=p.querySelector('#checkoutPayment'),deliveryBox=p.querySelector('#checkoutDeliveryBox'),address=p.querySelector('#checkoutAddress');
  const sync=()=>{
    const delivery=ful.value==='delivery';deliveryBox.classList.toggle('hidden',!delivery);
    [...payment.options].forEach(option=>{if(option.value==='cash')option.disabled=delivery});
    if(delivery&&payment.value==='cash'){const online=[...payment.options].find(o=>o.value==='online');if(online)payment.value='online'}
    if(!delivery){activeDeliveryQuote=null;activeDeliveryDestination=null;deliveryQuoteSeq++;document.getElementById('checkoutMessage').textContent=''}
    updateCheckoutTotals();
  };
  ful.onchange=()=>{invalidateCheckoutDeliveryQuote();sync()};sync();
  if(address)address.oninput=()=>invalidateCheckoutDeliveryQuote('Address changed. Confirm it again to calculate Delivery.');
  p.querySelector('#checkoutAddressSearch').onclick=()=>searchCheckoutDeliveryAddress();
  p.querySelector('#checkoutUseGps').onclick=()=>useCheckoutDeliveryGps();
  p.querySelector('.closeCheckout').onclick=closeCheckout;
  form.onsubmit=submitCheckout;
  updateCheckoutTotals();
  document.dispatchEvent(new CustomEvent('abl:marketplace-checkout-rendered',{detail:{businessId:Number(currentStore.business_id)}}));
}
async function submitCheckout(e){
  e.preventDefault();
  const msg=document.getElementById('checkoutMessage');msg.textContent='';
  try{
    const delivery=checkoutDeliverySelected();
    if(delivery&&(!activeDeliveryQuote||checkoutQuoteExpired(activeDeliveryQuote))){
      invalidateCheckoutDeliveryQuote('Delivery price is missing or expired. Confirm the delivery address to calculate a current final total.');
      return;
    }
    const body={
      business_id:currentStore.business_id,
      items:checkoutItemsPayload(),
      fulfilment_method:document.getElementById('checkoutFulfil').value,
      payment_method:document.getElementById('checkoutPayment').value,
      delivery_address:document.getElementById('checkoutAddress')?.value||'',
      note:document.getElementById('checkoutNote').value
    };
    if(delivery)body.delivery_quote_id=Number(activeDeliveryQuote.id);
    const o=await mapi('/api/marketplace/checkout',{method:'POST',body:JSON.stringify(body)});
    basket.clear();activeDeliveryQuote=null;activeDeliveryDestination=null;deliveryQuoteSeq++;updateBasket();closeCheckout();mtoast('Order '+o.order_number+' placed.');setTimeout(()=>closeMarket(),1100);
  }catch(err){
    if(/quote.*expired|quote.*missing/i.test(String(err.message||'')))invalidateCheckoutDeliveryQuote(err.message);
    else msg.textContent=err.message;
  }
}

function announceMerchantMarketSurface(surface){document.dispatchEvent(new CustomEvent('abl:marketplace-merchant-surface',{detail:{surface}}))}
async function openMerchantStore(){ensureMarket();if(!window.BusinessLifeShell?.openFeatureWorkspace?.('marketWorkspace')){hideBase();marketWorkspace.classList.remove('hidden')}document.getElementById('basketBar').classList.add('hidden');announceMerchantMarketSurface('storefront');await renderMerchantStore()}
async function openMerchantCatalog(){ensureMarket();if(!window.BusinessLifeShell?.openFeatureWorkspace?.('marketWorkspace')){hideBase();marketWorkspace.classList.remove('hidden')}document.getElementById('basketBar').classList.add('hidden');announceMerchantMarketSurface('catalog');await renderMerchantCatalog()}
async function renderMerchantStore(){marketWorkspace.innerHTML=marketHeader('Storefront','Public shop settings only')+'<div class="marketEmpty">Loading storefront settings…</div>';bindBack();try{merchantStore=await mapi('/api/merchant/storefront?include_products=false');marketWorkspace.innerHTML=marketHeader('Storefront','How your shop appears and operates for customers')+merchantReadinessForm(merchantStore)+storeForm(merchantStore)+`<section class="merchantStoreCard catalogBoundaryNote"><strong>Products are managed in Catalog</strong><p>Add, import, publish, hide and manage product images from Catalog. Storefront contains only store-level settings.</p><button type="button" class="importProducts" id="openCatalogFromStorefront">Open Catalog</button></section>`;bindBack();bindMerchantReadiness(merchantStore);upgradeStorefrontFormV2(merchantStore);bindStoreForm();bindStorefrontV2Controls(merchantStore);document.getElementById('openCatalogFromStorefront')?.addEventListener('click',openMerchantCatalog)}catch(e){marketWorkspace.innerHTML=marketHeader('Storefront','Marketplace settings')+`<div class="marketEmpty">${mh(e.message)}</div>`;bindBack()}}
function retailCatalogQuery(){
  const p=new URLSearchParams();
  p.set('business_id',String(Number(merchantStore?.business_id||0)));
  for(const key of ['q','category','status','stock','media','collection_id']){
    const value=retailCatalogState[key];
    if(value&&value!=='all')p.set(key,String(value));
  }
  p.set('offset',String(Math.max(0,Number(retailCatalogState.offset)||0)));
  p.set('limit',String(Math.max(1,Number(retailCatalogState.limit)||50)));
  return p.toString();
}
async function renderMerchantCatalog(){
  stopRetailCatalogScanner();
  marketWorkspace.innerHTML=marketHeader('Catalog','Create and manage what customers can buy')+'<div class="marketEmpty">Loading Catalog…</div>';
  bindBack();
  try{
    const [store,inventory]=await Promise.all([mapi('/api/merchant/storefront?product_domain=food'),mapi('/api/inventory')]);
    merchantStore=store;
    const [retailPage,collections,schema]=await Promise.all([
      mapi('/api/merchant/catalog-v3/items?'+retailCatalogQuery()),
      mapi('/api/merchant/catalog-v3/collections?business_id='+encodeURIComponent(Number(store.business_id))),
      mapi('/api/merchant/catalog-v3/schema?business_id='+encodeURIComponent(Number(store.business_id)))
    ]);
    merchantCatalogSchema=schema;
    marketWorkspace.innerHTML=
      marketHeader('Catalog','Food menus and Retail products share one Catalog engine')+
      catalogCreateSection(inventory||[],schema)+
      retailMerchandisingSection(retailPage,collections||[])+
      ((store.merchant_domain==='food'||store.merchant_domain==='mixed')?preparedImportSection():'')+
      catalogSection(store.products||[]);
    bindBack();
    bindCatalogCreate(inventory||[],schema);
    bindRetailMerchandising(retailPage,collections||[],inventory||[]);
    bindCatalog();
  }catch(e){
    marketWorkspace.innerHTML=marketHeader('Catalog','Product management')+`<div class="marketEmpty">${mh(e.message)}</div>`;
    bindBack();
  }
}
function readinessLabel(value){const map={starting:'Starting',building_records:'Building records',getting_ready:'Getting ready',applying:'Applying',verified:'Verified',growing:'Growing'};return map[value]||'Starting'}
function readinessNextLabel(value){const map={choose_activity_track:'Choose Food or Non-food',add_operating_context:'Tell us where you operate',start_building_records:'Start building basic records',review_readiness_steps:'Review your next readiness step',prepare_applications:'Prepare the applicable official steps',track_application_progress:'Track your application progress',review_commerce_capabilities:'Review available commerce capabilities',grow_business:'Keep growing the business'};return map[value]||'Review your next step'}
function merchantReadinessForm(s){
  const r=s?.readiness||{},enforced=Boolean(r.enforcement_enabled),eligible=['eligible_limited','eligible_full'].includes(r.commerce_state);
  const status=eligible?'Platform commerce eligible':'Readiness only';
  const statusClass=eligible?'ready':'pending';
  return `<section class="merchantStoreCard"><div class="storefrontV2Head"><div><small>BUSINESS READINESS</small><h2>${mh(readinessLabel(r.readiness_stage))}</h2><p>You can build the business privately while public commerce remains a separate capability. Business & Life platform eligibility is not a government permit, tax registration or professional licence.</p></div><span class="${statusClass}">${mh(status)}</span></div>
    <div class="privacyToggle"><strong>Next step</strong><p>${mh(readinessNextLabel(r.next_action_code))}</p>${enforced&&!eligible?'<small>Public marketplace publication and new orders stay locked until the governed commerce review is complete.</small>':'<small>Readiness enforcement is not currently blocking this storefront.</small>'}</div>
    <form id="merchantReadinessForm" class="merchantStoreForm">
      <input id="merchantReadinessBusinessId" type="hidden" value="${Number(s.business_id)}">
      <div class="merchantStoreForm two">
        <label>Business track<select id="merchantReadinessTrack"><option value="">Choose track</option><option value="food" ${r.activity_track==='food'?'selected':''}>Food</option><option value="non_food" ${r.activity_track==='non_food'?'selected':''}>Non-food</option></select></label>
        <label>Where you operate<select id="merchantOperatingContext"><option value="">Choose context</option><option value="private_property" ${r.operating_context==='private_property'?'selected':''}>Private property</option><option value="commercial_space" ${r.operating_context==='commercial_space'?'selected':''}>Shop / commercial space</option><option value="authorized_sidewalk" ${r.operating_context==='authorized_sidewalk'?'selected':''}>Authorized sidewalk vending space</option><option value="home_based" ${r.operating_context==='home_based'?'selected':''}>Home-based</option><option value="customer_locations" ${r.operating_context==='customer_locations'?'selected':''}>At customer locations</option><option value="unknown_or_other" ${r.operating_context==='unknown_or_other'?'selected':''}>Other / not sure</option></select></label>
      </div>
      <label>Readiness progress<select id="merchantReadinessStage"><option value="starting" ${r.readiness_stage==='starting'?'selected':''}>Starting</option><option value="building_records" ${r.readiness_stage==='building_records'?'selected':''}>Building records</option><option value="getting_ready" ${r.readiness_stage==='getting_ready'?'selected':''}>Getting ready</option><option value="applying" ${r.readiness_stage==='applying'?'selected':''}>Applying / preparing documents</option></select><span class="storeFieldHelp">Verified and Growing are governed stages and cannot be self-declared.</span></label>
      <div class="storeFormActions"><button class="saveStore" type="submit">Save readiness</button></div>
      <div id="merchantReadinessMessage" class="avatarHint"></div>
    </form></section>`
}
function bindMerchantReadiness(store){
  const form=document.getElementById('merchantReadinessForm');if(!form)return;
  form.onsubmit=async function(event){
    event.preventDefault();
    const message=document.getElementById('merchantReadinessMessage'),button=form.querySelector('button[type="submit"]');
    if(message)message.textContent='Saving readiness…';if(button)button.disabled=true;
    try{
      const readiness=await mapi('/api/onboarding/readiness',{method:'PUT',body:JSON.stringify({
        profile_role:'merchant',
        business_id:Number(document.getElementById('merchantReadinessBusinessId').value),
        activity_track:document.getElementById('merchantReadinessTrack').value,
        operating_context:document.getElementById('merchantOperatingContext').value,
        readiness_stage:document.getElementById('merchantReadinessStage').value
      })});
      store.readiness=readiness;
      mtoast('Business readiness saved.');
      await renderMerchantStore();
    }catch(error){if(message)message.textContent=error.message;if(button)button.disabled=false}
  };
}
function storeForm(s){return `<section class="merchantStoreCard"><h2>Public storefront</h2><p>Accounting, supplier relationships and internal margins are never published here.</p><div data-bl-pricing="merchant"></div><form id="merchantStoreForm" class="merchantStoreForm"><input id="storeBusinessId" type="hidden" value="${s.business_id}"><label>Store name<input id="storeName" value="${mh(s.store_name)}" required></label><label>Description<textarea id="storeDescription" rows="3">${mh(s.description||'')}</textarea></label><div class="merchantStoreForm two"><label>Store type<select id="storeDomain"><option value="food" ${s.merchant_domain==='food'?'selected':''}>Food</option><option value="non_food" ${s.merchant_domain==='non_food'?'selected':''}>Non-food</option><option value="mixed" ${s.merchant_domain==='mixed'?'selected':''}>Mixed</option></select></label><label>Publication<select id="storeStatus"><option value="draft" ${s.publication_status==='draft'?'selected':''}>Draft / private</option><option value="published" ${s.publication_status==='published'?'selected':''} ${s.readiness?.enforcement_enabled&&!['eligible_limited','eligible_full'].includes(s.readiness?.commerce_state)?'disabled':''}>Published</option><option value="paused" ${s.publication_status==='paused'?'selected':''}>Paused</option></select></label></div><label>Pickup address<input id="storeAddress" value="${mh(s.pickup_address||'')}" placeholder="Public pickup location"></label><div class="merchantStoreForm two"><label>Opening status<select id="storeOpening"><option value="open" ${s.opening_status==='open'?'selected':''}>Open</option><option value="busy" ${s.opening_status==='busy'?'selected':''}>Busy</option><option value="closed" ${s.opening_status==='closed'?'selected':''}>Closed</option></select></label><label>Preparation ETA (minutes)<input id="storeEta" type="number" min="1" max="240" value="${Number(s.preparation_eta_minutes)||15}"></label></div><div class="toggleGrid"><label class="toggleBox"><input id="storePickup" type="checkbox" ${s.pickup_enabled?'checked':''}> Pickup</label><label class="toggleBox"><input id="storeDelivery" type="checkbox" ${s.delivery_enabled?'checked':''}> Delivery</label><label class="toggleBox"><input id="storeCash" type="checkbox" ${s.cash_enabled?'checked':''}> Cash</label><label class="toggleBox"><input id="storeOnline" type="checkbox" ${s.online_enabled?'checked':''}> Online/digital</label></div><div class="privacyToggle"><strong>Public Merchant rating</strong><p>When enabled, verified completed orders can contribute to your public rating and Top Merchants. You can turn it off and leave the Marketplace.</p><label class="toggleBox"><input id="storeReputation" type="checkbox" ${s.public_reputation_enabled?'checked':''}> Participate in public Merchant reputation</label></div><div class="privacyToggle"><strong>Price comparison — explicit opt-in</strong><p>Default is OFF. If OFF, your products remain visible and purchasable but are excluded from Lowest listed price / Lowest unit price and price-based rankings.</p><label class="toggleBox"><input id="storeCompare" type="checkbox" ${s.price_comparison_enabled?'checked':''}> Allow my eligible products in price comparison</label></div><div class="storeFormActions"><button class="saveStore">Save storefront</button></div><div id="storeMessage" class="avatarHint"></div></form></section>`}
function retailCollectionOptions(collections=[],selected=''){
  return '<option value="">All collections</option>'+collections.filter(x=>x.active!==false).map(collection=>`<option value="${Number(collection.id)}" ${String(selected)===String(collection.id)?'selected':''}>${mh(collection.name)} (${Number(collection.item_count||0)})</option>`).join('');
}
function retailBulkCollectionOptions(collections=[]){
  return '<option value="">Choose collection</option>'+collections.filter(x=>x.active!==false).map(collection=>`<option value="${Number(collection.id)}">${mh(collection.name)}</option>`).join('');
}
function retailCatalogStatus(item){
  if(item.active===false)return 'Archived';
  return item.published?'Published':'Private';
}
function retailCatalogRow(item,collections=[]){
  const images=Array.isArray(item.images)?item.images:[];
  const primary=images.find(x=>x.is_primary&&x.approval_status==='approved'&&x.public_visible);
  const visual=primary?.data_url||item.image_data_url||'';
  const collectionNames=(item.collection_ids||[]).map(id=>collections.find(c=>Number(c.id)===Number(id))?.name).filter(Boolean);
  const ids=[item.internal_sku?`SKU ${mh(item.internal_sku)}`:'',item.barcode?`GTIN ${mh(item.barcode)}`:''].filter(Boolean);
  const variantCopy=Number(item.variant_count||0)>0
    ?`${Number(item.active_variant_count||0)} active variant${Number(item.active_variant_count||0)===1?'':'s'} · available ${Number(item.variant_available||0).toLocaleString('en-PH',{maximumFractionDigits:4})} · on hand ${Number(item.variant_on_hand||0).toLocaleString('en-PH',{maximumFractionDigits:4})}`
    :(item.inventory_id?`Available ${Number(item.direct_available_quantity||0).toLocaleString('en-PH',{maximumFractionDigits:4})} · on hand ${Number(item.direct_inventory_quantity||0).toLocaleString('en-PH',{maximumFractionDigits:4})} ${mh(item.inventory_unit||'')}`:'No linked direct stock');
  const status=retailCatalogStatus(item);
  return `<article class="retailCatalogRow" data-retail-product-row="${Number(item.id)}">
    <label class="retailCatalogSelect"><input type="checkbox" data-retail-select="${Number(item.id)}" aria-label="Select ${mh(item.name)}"></label>
    <div class="retailCatalogThumb">${visual?`<img src="${visual}" alt="${mh(item.name)}">`:'📦'}</div>
    <div class="retailCatalogCopy">
      <div class="retailCatalogTitle"><strong>${mh(item.name)}</strong><span class="${item.published&&item.active!==false?'live':item.active===false?'archived':'private'}">${status}</span></div>
      <small>${mh(item.category||'General')} · ${mphp(item.selling_price)}${item.brand?' · '+mh(item.brand):''}${item.model?' · '+mh(item.model):''}</small>
      <small>${variantCopy} · ${item.in_stock?'In stock':'Out of stock'}${item.has_public_media?'':' · Photo missing'}</small>
      ${item.catalog_review_required?'<span class="catalogReviewBadge">Product details need review</span>':''}
      ${ids.length?`<small>${ids.join(' · ')}</small>`:''}
      ${collectionNames.length?`<div class="retailCollectionChips">${collectionNames.map(name=>`<span>${mh(name)}</span>`).join('')}</div>`:''}
    </div>
    <div class="retailCatalogRowActions">
      <button class="imageAction" type="button" data-edit-catalog-product="${Number(item.id)}">Edit</button>
      ${item.active===false
        ?`<button class="publishButton" type="button" data-restore-product="${Number(item.id)}">Restore</button>`
        :`<button class="publishButton ${item.published?'on':''}" type="button" data-toggle-product="${Number(item.id)}" data-published="${item.published?'1':'0'}">${item.published?'Published':'Private'}</button><button class="imageAction danger" type="button" data-archive-product="${Number(item.id)}">Archive</button>`}
    </div>
  </article>`;
}
function retailMerchandisingSection(page={},collections=[]){
  const items=Array.isArray(page.items)?page.items:[];
  const total=Number(page.total||0),offset=Number(page.offset||0),limit=Number(page.limit||50);
  const from=total?offset+1:0,to=Math.min(total,offset+items.length);
  const prev=offset>0,next=offset+items.length<total;
  const collectionList=collections.length?collections.map(collection=>`
    <div class="retailCollectionRow">
      <div><strong>${mh(collection.name)}</strong><small>${Number(collection.item_count||0)} product${Number(collection.item_count||0)===1?'':'s'}${collection.description?' · '+mh(collection.description):''}</small></div>
      <div><button type="button" class="imageAction" data-edit-collection="${Number(collection.id)}">Edit</button><button type="button" class="imageAction danger" data-archive-collection="${Number(collection.id)}">Archive</button></div>
    </div>`).join(''):'<div class="marketEmpty">No Retail collections yet.</div>';
  return `<section class="merchantStoreCard retailMerchandising">
    <div class="retailCatalogHead"><div><small>RETAIL MERCHANDISING</small><h2>Products & collections</h2><p>Search, scan, organise and publish Retail products without duplicating Inventory.</p></div><span>${total} product${total===1?'':'s'}</span></div>

    <form id="retailCatalogFilterForm" class="retailCatalogFilters">
      <label class="retailSearch">Search<input id="retailCatalogSearch" value="${mh(retailCatalogState.q)}" placeholder="Name, brand, SKU or barcode"></label>
      <label>Status<select id="retailCatalogStatus"><option value="all">All states</option><option value="published" ${retailCatalogState.status==='published'?'selected':''}>Published</option><option value="private" ${retailCatalogState.status==='private'?'selected':''}>Private</option><option value="archived" ${retailCatalogState.status==='archived'?'selected':''}>Archived</option></select></label>
      <label>Stock<select id="retailCatalogStock"><option value="all">All stock</option><option value="in_stock" ${retailCatalogState.stock==='in_stock'?'selected':''}>In stock</option><option value="out_of_stock" ${retailCatalogState.stock==='out_of_stock'?'selected':''}>Out of stock</option></select></label>
      <label>Media<select id="retailCatalogMedia"><option value="all">All media</option><option value="missing" ${retailCatalogState.media==='missing'?'selected':''}>Photo missing</option><option value="has_media" ${retailCatalogState.media==='has_media'?'selected':''}>Has photo</option></select></label>
      <label>Collection<select id="retailCatalogCollectionFilter">${retailCollectionOptions(collections,retailCatalogState.collection_id)}</select></label>
      <label>Category<input id="retailCatalogCategoryFilter" value="${mh(retailCatalogState.category)}" placeholder="Exact category"></label>
      <div class="retailFilterActions"><button type="submit" class="saveStore">Apply</button><button id="retailCatalogClearFilters" type="button" class="importProducts">Clear</button></div>
    </form>

    <div class="retailScanPanel">
      <div><strong>Scan-first intake</strong><small>Exact barcode match opens the existing Catalog item. Unknown barcodes start a draft but never invent product details.</small></div>
      <form id="retailBarcodeForm"><input id="retailBarcodeInput" inputmode="text" autocomplete="off" placeholder="Scan or enter barcode / GTIN"><button type="submit">Look up</button><button id="retailBarcodeCamera" type="button">Scan camera</button></form>
      <div id="retailBarcodeScanner" class="retailBarcodeScanner hidden"><video id="retailBarcodeVideo" playsinline muted></video><button id="retailBarcodeStop" type="button">Stop camera</button></div>
      <div id="retailBarcodeMessage" class="avatarHint" aria-live="polite"></div>
    </div>

    <div class="retailBulkBar">
      <label><input id="retailSelectAll" type="checkbox"> Select page</label>
      <strong id="retailSelectedCount">0 selected</strong>
      <select id="retailBulkAction">
        <option value="">Bulk action</option>
        <option value="publish">Publish</option>
        <option value="unpublish">Make private</option>
        <option value="availability_off">Make unavailable</option>
        <option value="availability_on">Make available</option>
        <option value="category">Change category</option>
        <option value="collection_add">Add to collection</option>
        <option value="collection_remove">Remove from collection</option>
        <option value="archive">Archive</option>
        <option value="restore">Restore as private</option>
      </select>
      <select id="retailBulkCollection">${retailBulkCollectionOptions(collections)}</select>
      <button id="retailBulkApply" type="button">Apply</button>
    </div>

    <div class="retailCatalogResults">
      ${items.length?items.map(item=>retailCatalogRow(item,collections)).join(''):'<div class="marketEmpty">No Retail products match these filters.</div>'}
    </div>
    <div class="retailCatalogPager"><span>Showing ${from}–${to} of ${total}</span><div><button id="retailPrevPage" type="button" ${prev?'':'disabled'}>Previous</button><button id="retailNextPage" type="button" ${next?'':'disabled'}>Next</button></div></div>

    <details class="retailCollectionsPanel">
      <summary>Collections</summary>
      <p>Collections are merchandising groups such as New arrivals, Sale or Back to school. Products are referenced, never duplicated.</p>
      <form id="retailCollectionCreateForm" class="retailCollectionForm"><input id="retailCollectionName" maxlength="100" placeholder="Collection name" required><input id="retailCollectionDescription" maxlength="500" placeholder="Optional description"><button type="submit">Create collection</button></form>
      <div class="retailCollectionList">${collectionList}</div>
      <div id="retailCollectionMessage" class="avatarHint"></div>
    </details>
  </section>`;
}

async function retailScanLookup(barcode){
  const message=document.getElementById('retailBarcodeMessage');
  const value=String(barcode||'').replace(/\s+/g,'').trim();
  if(!value){if(message)message.textContent='Scan or enter a barcode first.';return}
  if(message)message.textContent='Looking up barcode…';
  try{
    const result=await mapi('/api/merchant/catalog-v3/scan?business_id='+encodeURIComponent(Number(merchantStore?.business_id))+'&barcode='+encodeURIComponent(value));
    if(result.status==='catalog_product'||result.status==='catalog_variant'){
      retailCatalogState.q=value;retailCatalogState.offset=0;
      mtoast(result.status==='catalog_variant'?'Existing Retail variant found.':'Existing Retail product found.');
      await renderMerchantCatalog();return;
    }
    if(result.status==='inventory_non_retail'){
      if(message)message.textContent='This barcode belongs to Food or Operations Inventory, not Retail stock. Open the matching Inventory item instead of creating a Non-food product from it.';
      return;
    }
    if(result.status==='inventory_only'){
      const select=document.getElementById('merchantCatalogInventory'),kind=document.getElementById('merchantCatalogKind'),name=document.getElementById('merchantCatalogName');
      if(select){select.value=String(result.inventory?.id||'');select.dispatchEvent(new Event('change'))}
      if(kind)kind.value='non_food_resale';
      if(name&&!name.value)name.value=result.draft?.name||result.inventory?.item||'';
      if(message)message.textContent='Barcode matches Inventory but no Catalog product yet. A private Retail draft is ready below.';
      document.getElementById('merchantCatalogCreateForm')?.scrollIntoView({behavior:'smooth',block:'start'});
      return;
    }
    if(message)message.innerHTML='<strong>New barcode draft:</strong> '+mh(result.barcode||value)+'<br><span class="muted">No Inventory item owns this barcode yet. Add or identify the physical stock in Inventory first; Business & Life will not guess brand, price, specifications or stock.</span>';
  }catch(error){if(message)message.textContent=error.message}
}
function stopRetailCatalogScanner(){
  if(retailCatalogScanFrame){cancelAnimationFrame(retailCatalogScanFrame);retailCatalogScanFrame=0}
  if(retailCatalogScannerStream){for(const track of retailCatalogScannerStream.getTracks())track.stop();retailCatalogScannerStream=null}
  const pane=document.getElementById('retailBarcodeScanner');if(pane)pane.classList.add('hidden');
  const video=document.getElementById('retailBarcodeVideo');if(video)video.srcObject=null;
}
async function startRetailCatalogScanner(){
  const message=document.getElementById('retailBarcodeMessage'),pane=document.getElementById('retailBarcodeScanner'),video=document.getElementById('retailBarcodeVideo');
  if(!navigator.mediaDevices?.getUserMedia||!window.BarcodeDetector){
    if(message)message.textContent='Camera barcode scanning is not supported here. Enter the barcode manually.';
    return;
  }
  try{
    const detector=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf','qr_code']});
    retailCatalogScannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    if(video){video.srcObject=retailCatalogScannerStream;await video.play()}
    pane?.classList.remove('hidden');if(message)message.textContent='Point the camera at one barcode.';
    let busy=false;
    const tick=async()=>{
      if(!retailCatalogScannerStream||!video)return;
      if(!busy&&video.readyState>=2){
        busy=true;
        try{
          const codes=await detector.detect(video);
          const raw=String(codes?.[0]?.rawValue||'').trim();
          if(raw){
            const input=document.getElementById('retailBarcodeInput');if(input)input.value=raw;
            stopRetailCatalogScanner();await retailScanLookup(raw);return;
          }
        }catch{}finally{busy=false}
      }
      retailCatalogScanFrame=requestAnimationFrame(tick);
    };
    retailCatalogScanFrame=requestAnimationFrame(tick);
  }catch(error){stopRetailCatalogScanner();if(message)message.textContent=error?.name==='NotAllowedError'?'Camera permission was not granted. Enter the barcode manually.':'Camera scanning could not start. Enter the barcode manually.'}
}
async function applyRetailBulkActionUi(collections=[]){
  const ids=[...retailCatalogSelection],actionEl=document.getElementById('retailBulkAction');
  const raw=actionEl?.value||'';
  if(!ids.length)return mtoast('Select at least one Retail product.');
  if(!raw)return mtoast('Choose a bulk action.');
  let action=raw,value=null;
  if(raw==='availability_off'){action='availability';value=false}
  if(raw==='availability_on'){action='availability';value=true}
  if(raw==='category'){
    value=prompt('Enter the category for the selected products:','');
    if(value==null)return;
    value=String(value).trim();if(!value)return mtoast('Category was not changed.');
  }
  if(raw==='collection_add'||raw==='collection_remove'){
    value=Number(document.getElementById('retailBulkCollection')?.value);
    if(!Number.isInteger(value)||value<1)return mtoast('Choose a collection first.');
  }
  const label=action==='publish'?'publish':action==='archive'?'archive':action==='unpublish'?'make private':raw.replaceAll('_',' ');
  if(!confirm(`Apply “${label}” to ${ids.length} selected product${ids.length===1?'':'s'}?`))return;
  try{
    await mapi('/api/merchant/catalog-v3/bulk',{method:'POST',body:JSON.stringify({
      business_id:Number(merchantStore?.business_id),product_ids:ids,action,value,confirm:true
    })});
    retailCatalogSelection.clear();mtoast('Bulk Catalog action applied.');await renderMerchantCatalog();
  }catch(error){mtoast(error.message)}
}
function bindRetailMerchandising(page={},collections=[],inventory=[]){
  const form=document.getElementById('retailCatalogFilterForm');
  if(form)form.onsubmit=event=>{
    event.preventDefault();
    retailCatalogState={
      ...retailCatalogState,
      q:document.getElementById('retailCatalogSearch')?.value.trim()||'',
      category:document.getElementById('retailCatalogCategoryFilter')?.value.trim()||'',
      status:document.getElementById('retailCatalogStatus')?.value||'all',
      stock:document.getElementById('retailCatalogStock')?.value||'all',
      media:document.getElementById('retailCatalogMedia')?.value||'all',
      collection_id:document.getElementById('retailCatalogCollectionFilter')?.value||'',
      offset:0
    };
    renderMerchantCatalog();
  };
  document.getElementById('retailCatalogClearFilters')?.addEventListener('click',()=>{
    retailCatalogState={q:'',category:'',status:'all',stock:'all',media:'all',collection_id:'',offset:0,limit:50};
    retailCatalogSelection.clear();renderMerchantCatalog();
  });
  const syncSelection=()=>{
    const count=document.getElementById('retailSelectedCount');if(count)count.textContent=retailCatalogSelection.size+' selected';
    const visible=[...document.querySelectorAll('[data-retail-select]')].map(input=>Number(input.dataset.retailSelect));
    const all=document.getElementById('retailSelectAll');if(all)all.checked=visible.length>0&&visible.every(id=>retailCatalogSelection.has(id));
  };
  marketWorkspace.querySelectorAll('[data-retail-select]').forEach(input=>{
    const id=Number(input.dataset.retailSelect);input.checked=retailCatalogSelection.has(id);
    input.onchange=()=>{if(input.checked)retailCatalogSelection.add(id);else retailCatalogSelection.delete(id);syncSelection()};
  });
  document.getElementById('retailSelectAll')?.addEventListener('change',event=>{
    marketWorkspace.querySelectorAll('[data-retail-select]').forEach(input=>{
      const id=Number(input.dataset.retailSelect);input.checked=event.target.checked;
      if(event.target.checked)retailCatalogSelection.add(id);else retailCatalogSelection.delete(id);
    });syncSelection();
  });
  syncSelection();
  document.getElementById('retailBulkApply')?.addEventListener('click',()=>applyRetailBulkActionUi(collections));
  document.getElementById('retailPrevPage')?.addEventListener('click',()=>{retailCatalogState.offset=Math.max(0,Number(retailCatalogState.offset)-Number(page.limit||50));renderMerchantCatalog()});
  document.getElementById('retailNextPage')?.addEventListener('click',()=>{retailCatalogState.offset=Number(retailCatalogState.offset)+Number(page.limit||50);renderMerchantCatalog()});
  const barcodeForm=document.getElementById('retailBarcodeForm');
  if(barcodeForm)barcodeForm.onsubmit=event=>{event.preventDefault();retailScanLookup(document.getElementById('retailBarcodeInput')?.value)};
  document.getElementById('retailBarcodeCamera')?.addEventListener('click',startRetailCatalogScanner);
  document.getElementById('retailBarcodeStop')?.addEventListener('click',stopRetailCatalogScanner);

  const create=document.getElementById('retailCollectionCreateForm');
  if(create)create.onsubmit=async event=>{
    event.preventDefault();const message=document.getElementById('retailCollectionMessage');if(message)message.textContent='Creating collection…';
    try{
      await mapi('/api/merchant/catalog-v3/collections',{method:'POST',body:JSON.stringify({
        business_id:Number(merchantStore?.business_id),
        name:document.getElementById('retailCollectionName')?.value||'',
        description:document.getElementById('retailCollectionDescription')?.value||''
      })});
      mtoast('Collection created.');await renderMerchantCatalog();
    }catch(error){if(message)message.textContent=error.message}
  };
  marketWorkspace.querySelectorAll('[data-edit-collection]').forEach(button=>button.onclick=async()=>{
    const collection=collections.find(x=>Number(x.id)===Number(button.dataset.editCollection));if(!collection)return;
    const name=prompt('Collection name:',collection.name||'');if(name==null||!String(name).trim())return;
    const description=prompt('Collection description:',collection.description||'');if(description==null)return;
    try{
      await mapi('/api/merchant/catalog-v3/collections/'+Number(collection.id),{method:'PUT',body:JSON.stringify({
        business_id:Number(merchantStore?.business_id),name:String(name).trim(),description:String(description).trim(),
        active:collection.active!==false,sort_order:Number(collection.sort_order||0)
      })});
      mtoast('Collection updated.');await renderMerchantCatalog();
    }catch(error){mtoast(error.message)}
  });
  marketWorkspace.querySelectorAll('[data-archive-collection]').forEach(button=>button.onclick=async()=>{
    const collection=collections.find(x=>Number(x.id)===Number(button.dataset.archiveCollection));if(!collection)return;
    if(!confirm(`Archive collection “${collection.name}”? Products will not be deleted.`))return;
    try{
      await mapi('/api/merchant/catalog-v3/collections/'+Number(collection.id),{method:'PUT',body:JSON.stringify({
        business_id:Number(merchantStore?.business_id),name:collection.name,description:collection.description||'',
        active:false,sort_order:Number(collection.sort_order||0)
      })});
      if(String(retailCatalogState.collection_id)===String(collection.id))retailCatalogState.collection_id='';
      mtoast('Collection archived.');await renderMerchantCatalog();
    }catch(error){mtoast(error.message)}
  });
}

function catalogDomainForKind(kind){
  return String(kind||'')==='non_food_resale'?'non_food':'food';
}
function catalogDefaultCategoryForKind(kind){
  return ({fresh_direct:'fresh_food',packaged_resale:'packaged_food_drink',non_food_resale:'general_retail',prepared_food:'prepared_food'})[String(kind||'')]||'';
}
function catalogSchemaCategories(schema=merchantCatalogSchema,domain=''){
  return (Array.isArray(schema?.categories)?schema.categories:[]).filter(category=>!domain||category.domain_hint===domain);
}
function catalogCategoryOptions(schema,domain,selected=''){
  const rows=catalogSchemaCategories(schema,domain);
  return '<option value="">Choose product category</option>'+rows.map(category=>
    '<option value="'+mh(category.code)+'" '+(String(selected)===String(category.code)?'selected':'')+'>'+mh(category.label)+'</option>'
  ).join('');
}
function catalogCategoryFromSchema(schema,code){
  return (schema?.categories||[]).find(category=>String(category.code)===String(code))||null;
}
function catalogAttributeValue(values,code){
  const entry=values&&Object.prototype.hasOwnProperty.call(values,code)?values[code]:'';
  if(entry&&typeof entry==='object'&&Object.prototype.hasOwnProperty.call(entry,'value'))return entry.value;
  return entry??'';
}
function catalogAttributeField(mapping,value,prefix){
  const def=mapping?.definition||{},code=String(mapping?.attribute_code||def.code||''),id=prefix+'-'+code;
  if(!code)return'';
  const required=mapping.required?' required':'',variant=mapping.variant_axis?'<span class="catalogVariantAxis">Variant option</span>':'';
  const unit=def.unit_family?'<span class="catalogAttributeUnit">'+mh(def.unit_family)+'</span>':'';
  let control='';
  if(def.value_type==='boolean'){
    control='<select id="'+mh(id)+'" data-catalog-attribute="'+mh(code)+'" data-value-type="boolean"'+required+'><option value="">Choose</option><option value="true" '+(value===true||String(value)==='true'?'selected':'')+'>Yes</option><option value="false" '+(value===false||String(value)==='false'?'selected':'')+'>No</option></select>';
  }else if(def.value_type==='select'){
    control='<select id="'+mh(id)+'" data-catalog-attribute="'+mh(code)+'" data-value-type="select"'+required+'><option value="">Choose</option>'+
      (def.allowed_values||[]).map(option=>'<option value="'+mh(option)+'" '+(String(value)===String(option)?'selected':'')+'>'+mh(mnice(option))+'</option>').join('')+
    '</select>';
  }else{
    const type=def.value_type==='number'?'number':'text',min=type==='number'?' min="0" step="any"':'';
    control='<input id="'+mh(id)+'" type="'+type+'" data-catalog-attribute="'+mh(code)+'" data-value-type="'+mh(def.value_type||'text')+'" value="'+mh(value)+'"'+min+required+'>';
  }
  return '<label class="catalogAdaptiveField"><span>'+mh(def.label||code)+(mapping.required?' *':'')+variant+'</span><span class="catalogAttributeControl">'+control+unit+'</span></label>';
}
function catalogAdaptiveAttributesMarkup(schema,categoryCode,values={},prefix='catalogAttr'){
  const category=catalogCategoryFromSchema(schema,categoryCode);
  if(!category)return '<div class="catalogAdaptiveEmpty">Choose a product category to show only the details that apply to this product.</div>';
  const mappings=Array.isArray(category.attributes)?category.attributes:[];
  if(!mappings.length)return '<div class="catalogAdaptiveEmpty">No extra product details are required for '+mh(category.label)+'.</div>';
  return '<div class="catalogAdaptiveHead"><div><strong>'+mh(category.label)+' details</strong><small>Only fields relevant to this category are shown.</small></div><span>'+mappings.length+' fields</span></div>'+
    '<div class="catalogAdaptiveGrid">'+mappings.map(mapping=>catalogAttributeField(mapping,catalogAttributeValue(values,mapping.attribute_code),prefix)).join('')+'</div>';
}
function collectCatalogAttributes(root,{includeEmpty=false}={}){
  const values={};
  root?.querySelectorAll('[data-catalog-attribute]').forEach(input=>{
    const code=input.dataset.catalogAttribute,type=input.dataset.valueType||'text',raw=input.value;
    if(raw===''){if(includeEmpty)values[code]='';return}
    if(type==='number')values[code]=Number(raw);
    else if(type==='boolean')values[code]=raw==='true';
    else values[code]=raw;
  });
  return values;
}
function catalogProductTypeOptions(){
  const domain=merchantStore?.merchant_domain||'mixed',options=[];
  if(domain==='food'||domain==='mixed'){
    options.push(['fresh_direct','Fresh / direct food'],['packaged_resale','Packaged food resale']);
  }
  if(domain==='non_food'||domain==='mixed')options.push(['non_food_resale','Non-food resale']);
  return options;
}
function catalogIdentityAdvancedMarkup(prefix='merchantCatalog',values={},kind='non_food_resale'){
  const retail=kind==='non_food_resale',packaged=kind==='packaged_resale',direct=kind!=='prepared_food';
  const identityFields=retail
    ?'<div class="merchantStoreForm two catalogAdvancedGrid">'+
      '<label>Brand<input id="'+prefix+'Brand" maxlength="120" value="'+mh(values.brand||'')+'" placeholder="Optional"></label>'+
      '<label>Model<input id="'+prefix+'Model" maxlength="120" value="'+mh(values.model||'')+'" placeholder="Optional"></label>'+
      '<label>Condition<select id="'+prefix+'Condition"><option value="">Not specified</option><option value="new" '+(values.condition_code==='new'?'selected':'')+'>New</option><option value="used" '+(values.condition_code==='used'?'selected':'')+'>Used</option><option value="refurbished" '+(values.condition_code==='refurbished'?'selected':'')+'>Refurbished</option><option value="other" '+(values.condition_code==='other'?'selected':'')+'>Other</option></select></label>'+
      '<label>Manufacturer / part number<input id="'+prefix+'Mpn" maxlength="120" value="'+mh(values.manufacturer_part_number||'')+'" placeholder="Optional"></label>'+
    '</div>'
    :packaged
      ?'<div class="merchantStoreForm catalogAdvancedGrid"><label>Brand<input id="'+prefix+'Brand" maxlength="120" value="'+mh(values.brand||'')+'" placeholder="Optional"></label></div>'
      :'';
  const packageFields=direct
    ?'<div class="catalogPackageHead"><strong>Delivery package</strong><small>Optional. Used for fulfilment and delivery planning; not exposed as private stock/accounting data.</small></div>'+
      '<div class="merchantStoreForm two catalogPackageGrid">'+
        '<label>Length (cm)<input id="'+prefix+'PackageLength" type="number" min="0" step="0.01" value="'+mh(values.package_length_cm??'')+'"></label>'+
        '<label>Width (cm)<input id="'+prefix+'PackageWidth" type="number" min="0" step="0.01" value="'+mh(values.package_width_cm??'')+'"></label>'+
        '<label>Height (cm)<input id="'+prefix+'PackageHeight" type="number" min="0" step="0.01" value="'+mh(values.package_height_cm??'')+'"></label>'+
        '<label>Weight (kg)<input id="'+prefix+'PackageWeight" type="number" min="0" step="0.001" value="'+mh(values.package_weight_kg??'')+'"></label>'+
      '</div>'
    :'';
  if(!identityFields&&!packageFields)return'';
  return '<details class="catalogAdvancedDetails"><summary>'+(retail?'Brand, condition & delivery package':packaged?'Brand & delivery package':'Delivery package')+'</summary>'+identityFields+packageFields+'</details>';
}
function catalogCreateSection(inventory=[],schema=merchantCatalogSchema){
  const defaultKind=(merchantStore?.merchant_domain==='non_food')?'non_food_resale':'fresh_direct';
  const defaultDomain=catalogDomainForKind(defaultKind),defaultCategory=catalogDefaultCategoryForKind(defaultKind);
  const options=(inventory||[]).map(item=>
    '<option value="'+Number(item.id)+'" data-unit="'+mh(item.unit||'unit')+'" data-name="'+mh(item.item)+'" data-domain="'+mh(item.inventory_domain||'')+'">'+
      mh(item.item)+' · '+Number(item.usable_quantity??item.quantity??0).toLocaleString('en-PH',{maximumFractionDigits:4})+' '+mh(item.unit||'')+
    '</option>'
  ).join('');
  const kindOptions=catalogProductTypeOptions().map(([value,label])=>'<option value="'+value+'" '+(value===defaultKind?'selected':'')+'>'+label+'</option>').join('');
  return '<section class="merchantStoreCard merchantCatalogCreate"><div class="merchantCatalogHead"><div><small>ADAPTIVE PRODUCT EDITOR</small><h2>Add product from Inventory</h2><p>Choose what you sell first. Business & Life then shows only the product details that apply to that category.</p></div></div>'+
    '<form id="merchantCatalogCreateForm" class="merchantStoreForm">'+
      '<input id="merchantCatalogBusinessId" type="hidden" value="'+Number(merchantStore?.business_id||0)+'">'+
      '<label>Inventory item<select id="merchantCatalogInventory" required><option value="">Choose recorded stock</option>'+options+'</select><span class="storeFieldHelp">Catalog never duplicates stock. This product points to the Inventory item that fulfils an order.</span></label>'+
      '<div class="merchantStoreForm two">'+
        '<label>Product type<select id="merchantCatalogKind">'+kindOptions+'</select></label>'+
        '<label>Customer-facing name<input id="merchantCatalogName" maxlength="120" required placeholder="Example: Cotton T-Shirt"></label>'+
      '</div>'+
      '<div class="merchantStoreForm two">'+
        '<label>Selling price ₱<input id="merchantCatalogPrice" type="number" min="0" step="0.01" required></label>'+
        '<label>Stock used per sale<input id="merchantCatalogQuantity" type="number" min="0.0001" step="0.0001" value="1" required></label>'+
      '</div>'+
      '<label>Product category<select id="merchantCatalogCategoryCode" required>'+catalogCategoryOptions(schema,defaultDomain,defaultCategory)+'</select><span class="storeFieldHelp">This controls relevant specifications and filters. It is different from a promotional collection.</span></label>'+
      '<label>Customer section / shelf<input id="merchantCatalogCategory" maxlength="100" value="General" placeholder="Example: Men / Shirts"></label>'+
      '<label>Description<textarea id="merchantCatalogDescription" rows="2" maxlength="800" placeholder="What customers should know about this product"></textarea></label>'+
      '<section id="merchantCatalogAdaptiveAttributes" class="catalogAdaptiveAttributes">'+catalogAdaptiveAttributesMarkup(schema,defaultCategory,{},'merchantCatalogCreateAttr')+'</section>'+
      '<div id="merchantCatalogAdvancedHost">'+catalogIdentityAdvancedMarkup('merchantCatalog',{},defaultKind)+'</div>'+
      '<div id="merchantCatalogStockHint" class="catalogBoundaryNote">Choose an Inventory item. Its cost remains private; this form sets only the public selling product.</div>'+
      '<div class="storeFormActions"><button class="saveStore" type="submit">Create private product</button></div>'+
      '<div id="merchantCatalogCreateMessage" class="avatarHint"></div>'+
    '</form>'+
  '</section>';
}
function preparedImportSection(){
  return `<section class="merchantStoreCard merchantPreparedImport"><h2>Prepared recipes</h2><p>Recipes are created in Products & recipes, then imported here as private Catalog products. Importing never publishes automatically.</p><button class="importProducts catalogImportPrepared" id="importLegacy" type="button">Import prepared products</button><div id="catalogImportMessage" class="avatarHint"></div></section>`;
}
function catalogSection(products){
  const all=(Array.isArray(products)?products:[]).filter(product=>product.product_domain==='food');
  if(!all.length)return '';
  const active=all.filter(p=>p.active!==false),archived=all.filter(p=>p.active===false);
  const rows=active.length?active.map(p=>{const images=Array.isArray(p.images)?p.images:[];const primary=images.find(x=>x.is_primary&&x.approval_status==='approved'&&x.public_visible);const draft=images.find(x=>x.source_type==='ai_generated'&&x.approval_status==='draft');const visual=primary?.data_url||draft?.data_url||p.image_data_url||'';const aiPrimary=primary?.source_type==='ai_generated';const canGenerate=p.product_domain==='food'&&p.product_kind==='prepared_food'&&Boolean(p.legacy_product_id);const allergenState=canGenerate?(p.allergen_review_current?'<span class="allergenReviewBadge current">Ingredient disclosure reviewed</span>':'<span class="allergenReviewBadge required">Ingredient disclosure review required</span>'):'';return `<div class="merchantProductRow merchantProductMediaRow"><div class="merchantProductVisual">${visual?`<img src="${visual}" alt="${mh(p.name)}">`:'<span>＋ photo</span>'}</div><div class="merchantProductCopy"><strong>${mh(p.name)}</strong><small>${mh(p.category)} • ${mphp(p.selling_price)} • ${p.legacy_product_id?'Prepared recipe':p.inventory_id?`${mnice(p.product_kind)} · ${Number(p.quantity_per_unit).toLocaleString('en-PH',{maximumFractionDigits:4})} ${mh(p.inventory_unit||'stock')}/sale`:'Marketplace product'}</small>${aiPrimary?'<span class="aiReferenceLabel">AI-generated reference image</span>':''}${draft?'<span class="aiDraftLabel">AI image draft · review before use</span>':''}${allergenState}${p.catalog_review_required?'<span class="catalogReviewBadge">Product details need review</span>':''}<div class="merchantImageActions"><button class="imageAction" type="button" data-edit-catalog-product="${p.id}">Edit product</button>${canGenerate?`<button class="imageAction" type="button" data-generate-image="${p.id}">${draft?'Generate another':'Generate AI image'}</button>`:''}${draft?`<button class="imageAction primary" type="button" data-approve-image="${p.id}" data-media-id="${draft.id}">Use as primary</button><button class="imageAction danger" type="button" data-archive-image="${p.id}" data-media-id="${draft.id}">Discard image</button>`:''}<button class="imageAction danger" type="button" data-archive-product="${p.id}">Archive product</button></div></div><button class="publishButton ${p.published?'on':''}" type="button" data-toggle-product="${p.id}" data-published="${p.published?'1':'0'}">${p.published?'Published':'Private'}</button></div>`}).join(''):'<div class="marketEmpty">No active Catalog products yet. Add one from Inventory or import prepared recipes above.</div>';
  const archivedHtml=archived.length?`<details class="catalogArchived"><summary>Archived products (${archived.length})</summary><div class="merchantCatalogList">${archived.map(p=>`<div class="merchantProductRow"><div class="merchantProductCopy"><strong>${mh(p.name)}</strong><small>${mh(p.category)} • ${mphp(p.selling_price)} • archived</small></div><div class="merchantImageActions"><button class="imageAction" type="button" data-edit-catalog-product="${p.id}">Edit</button><button class="publishButton" type="button" data-restore-product="${p.id}">Restore</button></div></div>`).join('')}</div></details>`:'';
  return `<section class="merchantStoreCard"><h2>Your Catalog</h2><p>These are the products customers can eventually see. Publishing is separate from creating or importing.</p><div class="merchantCatalogList">${rows}</div>${archivedHtml}</section>`;
}
function bindCatalogCreate(inventory=[],schema=merchantCatalogSchema){
  const form=document.getElementById('merchantCatalogCreateForm'),select=document.getElementById('merchantCatalogInventory'),kind=document.getElementById('merchantCatalogKind'),category=document.getElementById('merchantCatalogCategoryCode');
  if(!form||!select||!kind||!category)return;

  const syncInventory=()=>{
    const domain=catalogDomainForKind(kind.value);
    [...select.options].forEach(option=>{
      if(!option.value)return;
      const optionDomain=String(option.dataset.domain||'');
      option.disabled=Boolean(optionDomain&&optionDomain!==domain);
    });
    if(select.selectedOptions?.[0]?.disabled)select.value='';
  };
  const syncCategory=(preserve=false)=>{
    const domain=catalogDomainForKind(kind.value),previous=preserve?category.value:'',preferred=previous||catalogDefaultCategoryForKind(kind.value);
    category.innerHTML=catalogCategoryOptions(schema,domain,preferred);
    if(!category.value){
      const fallback=catalogDefaultCategoryForKind(kind.value);
      if([...category.options].some(option=>option.value===fallback))category.value=fallback;
    }
    const host=document.getElementById('merchantCatalogAdaptiveAttributes');
    if(host)host.innerHTML=catalogAdaptiveAttributesMarkup(schema,category.value,{},'merchantCatalogCreateAttr');
    const advancedHost=document.getElementById('merchantCatalogAdvancedHost');
    if(advancedHost)advancedHost.innerHTML=catalogIdentityAdvancedMarkup('merchantCatalog',{},kind.value);
  };
  const syncStock=()=>{
    const id=Number(select.value),item=(inventory||[]).find(x=>Number(x.id)===id),name=document.getElementById('merchantCatalogName'),hint=document.getElementById('merchantCatalogStockHint');
    if(item&&name&&!name.value)name.value=item.item||'';
    if(hint)hint.textContent=item
      ?`Selling one unit will use the quantity you set from ${item.item} (${item.unit||'stock'}). Inventory cost, supplier data and stock history stay private.`
      :'Choose an Inventory item. Its cost remains private; this form sets only the public selling product.';
  };
  kind.onchange=()=>{syncInventory();syncCategory(false);syncStock()};
  category.onchange=()=>{
    const host=document.getElementById('merchantCatalogAdaptiveAttributes');
    if(host)host.innerHTML=catalogAdaptiveAttributesMarkup(schema,category.value,{},'merchantCatalogCreateAttr');
  };
  select.onchange=syncStock;
  syncInventory();syncCategory(true);syncStock();

  form.onsubmit=async event=>{
    event.preventDefault();
    const msg=document.getElementById('merchantCatalogCreateMessage');if(msg)msg.textContent='Creating product…';
    try{
      const inventoryId=Number(select.value),item=(inventory||[]).find(x=>Number(x.id)===inventoryId);
      if(!item)throw new Error('Choose an Inventory item.');
      const payload={
        business_id:Number(merchantStore?.business_id),
        inventory_id:inventoryId,
        product_kind:kind.value,
        name:document.getElementById('merchantCatalogName').value,
        description:document.getElementById('merchantCatalogDescription').value,
        category:document.getElementById('merchantCatalogCategory').value,
        catalog_category_code:category.value,
        catalog_attributes:collectCatalogAttributes(document.getElementById('merchantCatalogAdaptiveAttributes')),
        selling_price:Number(document.getElementById('merchantCatalogPrice').value),
        quantity_per_unit:Number(document.getElementById('merchantCatalogQuantity').value),
        unit_code:(document.getElementById('merchantCatalogQuantity').value||'1')+' '+(item.unit||'unit'),
        brand:document.getElementById('merchantCatalogBrand')?.value||'',
        model:document.getElementById('merchantCatalogModel')?.value||'',
        condition_code:document.getElementById('merchantCatalogCondition')?.value||'',
        manufacturer_part_number:document.getElementById('merchantCatalogMpn')?.value||'',
        package_length_cm:document.getElementById('merchantCatalogPackageLength')?.value||null,
        package_width_cm:document.getElementById('merchantCatalogPackageWidth')?.value||null,
        package_height_cm:document.getElementById('merchantCatalogPackageHeight')?.value||null,
        package_weight_kg:document.getElementById('merchantCatalogPackageWeight')?.value||null,
        published:false
      };
      await mapi('/api/merchant/storefront/products',{method:'POST',body:JSON.stringify(payload)});
      mtoast('Catalog product created as Private.');
      await renderMerchantCatalog();
    }catch(error){if(msg)msg.textContent=error.message}
  };

  const importButton=document.getElementById('importLegacy');
  if(importButton)importButton.onclick=async()=>{
    const msg=document.getElementById('catalogImportMessage');if(msg)msg.textContent='Importing prepared products…';
    try{
      const result=await mapi('/api/merchant/storefront/import-legacy',{method:'POST',body:JSON.stringify({business_id:Number(merchantStore?.business_id)})});
      mtoast(`${result.imported_or_updated} prepared product${Number(result.imported_or_updated)===1?'':'s'} imported or updated.`);
      await renderMerchantCatalog();
    }catch(error){if(msg)msg.textContent=error.message}
  };
}
function closeCatalogEditor(){
  const backdrop=document.getElementById('catalogEditorBackdrop');
  backdrop?.classList.add('hidden');
  if(document.getElementById('checkoutBackdrop')?.classList.contains('hidden')!==false&&document.getElementById('productDetailBackdrop')?.classList.contains('hidden')!==false)document.body.style.overflow='';
}
function catalogAttributeLabel(schema,code){
  for(const category of schema?.categories||[]){
    const mapping=(category.attributes||[]).find(row=>String(row.attribute_code)===String(code));
    if(mapping)return mapping.definition?.label||code;
  }
  return mnice(code);
}
function catalogReviewValue(value){
  if(value==null)return'';
  if(typeof value==='object')return JSON.stringify(value);
  if(value===true)return'Yes';
  if(value===false)return'No';
  return String(value);
}
function catalogEditorReviewMarkup(data){
  const reviews=Array.isArray(data?.catalog_attribute_reviews)?data.catalog_attribute_reviews:[];
  if(!reviews.length)return '';
  return '<section class="catalogReviewPanel"><div class="catalogReviewHead"><div><strong>Previous category details need review</strong><small>These values no longer belong to the current product category. They are preserved for review and are not shown to customers.</small></div><span>'+reviews.length+'</span></div>'+
    '<div class="catalogReviewList">'+reviews.map(row=>'<div><strong>'+mh(catalogAttributeLabel(data.schema,row.attribute_code))+'</strong><span>'+mh(catalogReviewValue(row.value_json))+'</span></div>').join('')+'</div>'+
    '<button type="button" id="catalogResolveReviews" class="catalogReviewResolve">Acknowledge previous details</button>'+
  '</section>';
}
function catalogCategoryChangeNotice(schema,fromCode,toCode,currentValues={}){
  if(String(fromCode||'')===String(toCode||''))return '';
  const next=catalogCategoryFromSchema(schema,toCode),allowed=new Set((next?.attributes||[]).map(row=>String(row.attribute_code)));
  const removed=Object.keys(currentValues||{}).filter(code=>!allowed.has(String(code)));
  if(!removed.length)return '<div class="catalogCategoryChangeNotice safe"><strong>Category change is compatible</strong><span>Existing compatible details will be kept.</span></div>';
  return '<div class="catalogCategoryChangeNotice"><strong>'+removed.length+' previous detail'+(removed.length===1?'':'s')+' will move to review</strong><span>'+removed.map(code=>mh(catalogAttributeLabel(schema,code))).join(', ')+'</span><small>The product will become Private until you acknowledge those previous-category details.</small></div>';
}
function catalogEditorStatus(product){
  if(product.active===false)return'Archived';
  return product.published?'Published':'Private';
}
function catalogEditorKindLabel(kind){
  return ({prepared_food:'Prepared food',fresh_direct:'Fresh / direct food',packaged_resale:'Packaged food resale',non_food_resale:'Non-food resale'})[String(kind||'')]||mnice(kind);
}
function catalogEditorMarkup(data){
  const p=data.product||{},schema=data.schema||{},attrs=data.catalog_attributes||{};
  const categoryCode=p.catalog_category_code||catalogDefaultCategoryForKind(p.product_kind);
  const review=catalogEditorReviewMarkup(data);
  return '<div class="catalogEditorTop"><div><small>ADAPTIVE PRODUCT EDITOR</small><h2>'+mh(p.name||'Product')+'</h2><span>'+mh(catalogEditorKindLabel(p.product_kind))+' · '+mh(catalogEditorStatus(p))+'</span></div><button type="button" id="catalogEditorClose" aria-label="Close">×</button></div>'+
    '<form id="catalogEditorForm" class="catalogEditorForm">'+
      '<div class="merchantStoreForm two">'+
        '<label>Customer-facing name<input id="catalogEditName" maxlength="120" required value="'+mh(p.name||'')+'"></label>'+
        '<label>Selling price ₱<input id="catalogEditPrice" type="number" min="0" step="0.01" required value="'+mh(p.selling_price??'')+'"></label>'+
      '</div>'+
      '<label>Product category<select id="catalogEditCategoryCode" required>'+catalogCategoryOptions(schema,p.product_domain,categoryCode)+'</select><span class="storeFieldHelp">Choose the canonical product category. Relevant details below adapt automatically.</span></label>'+
      '<label>Customer section / shelf<input id="catalogEditCategory" maxlength="100" value="'+mh(p.category||'General')+'"></label>'+
      '<label>Description<textarea id="catalogEditDescription" rows="3" maxlength="800">'+mh(p.description||'')+'</textarea></label>'+
      '<div id="catalogCategoryChangeHost"></div>'+
      '<section id="catalogEditorAdaptiveAttributes" class="catalogAdaptiveAttributes">'+catalogAdaptiveAttributesMarkup(schema,categoryCode,attrs,'catalogEditAttr')+'</section>'+
      '<div id="catalogEditorAdvancedHost">'+catalogIdentityAdvancedMarkup('catalogEdit',p,p.product_kind)+'</div>'+
      '<div class="catalogEditorSource"><strong>Stock source</strong><span>'+(
        p.variant_mode?'Retail variants are linked to Inventory separately.'
        :p.inventory_id?'Direct Inventory-linked product.'
        :p.product_kind==='prepared_food'?'Prepared recipe product.'
        :'No direct Inventory source'
      )+'</span><small>Stock counts, supplier costs and accounting remain private.</small></div>'+
      review+
      '<div class="catalogEditorActions"><button type="button" id="catalogEditorCancel">Cancel</button><button type="submit" class="saveStore">Save product</button></div>'+
      '<div id="catalogEditorMessage" class="avatarHint" aria-live="polite"></div>'+
    '</form>';
}
async function openCatalogEditor(productId){
  ensureMarket();
  const backdrop=document.getElementById('catalogEditorBackdrop'),panel=document.getElementById('catalogEditorPanel');
  if(!backdrop||!panel)return;
  panel.innerHTML='<div class="marketEmpty">Loading product editor…</div>';
  backdrop.classList.remove('hidden');document.body.style.overflow='hidden';
  try{
    const data=await mapi('/api/merchant/catalog-v3/products/'+Number(productId)+'/editor');
    const p=data.product||{},schema=data.schema||{},originalAttrs={...(data.catalog_attributes||{})},originalCategory=p.catalog_category_code||catalogDefaultCategoryForKind(p.product_kind);
    panel.innerHTML=catalogEditorMarkup(data);
    document.getElementById('catalogEditorClose').onclick=closeCatalogEditor;
    document.getElementById('catalogEditorCancel').onclick=closeCatalogEditor;

    const category=document.getElementById('catalogEditCategoryCode'),attrHost=document.getElementById('catalogEditorAdaptiveAttributes'),notice=document.getElementById('catalogCategoryChangeHost');
    const renderAdaptive=()=>{
      const current=collectCatalogAttributes(attrHost,{includeEmpty:true});
      const seed={...originalAttrs,...current};
      attrHost.innerHTML=catalogAdaptiveAttributesMarkup(schema,category.value,seed,'catalogEditAttr');
      notice.innerHTML=catalogCategoryChangeNotice(schema,originalCategory,category.value,originalAttrs);
    };
    category.onchange=renderAdaptive;
    notice.innerHTML=catalogCategoryChangeNotice(schema,originalCategory,category.value,originalAttrs);

    document.getElementById('catalogResolveReviews')?.addEventListener('click',async()=>{
      const button=document.getElementById('catalogResolveReviews');if(button)button.disabled=true;
      try{
        const reviewIds=(data.catalog_attribute_reviews||[]).map(row=>Number(row.id));
        await mapi('/api/merchant/catalog-v3/products/'+Number(p.id)+'/attribute-review',{
          method:'POST',body:JSON.stringify({review_ids:reviewIds,decision:'resolved'})
        });
        mtoast('Previous category details acknowledged.');
        await openCatalogEditor(Number(p.id));
        await renderMerchantCatalog();
      }catch(error){mtoast(error.message);if(button)button.disabled=false}
    });

    const form=document.getElementById('catalogEditorForm');
    form.onsubmit=async event=>{
      event.preventDefault();
      const message=document.getElementById('catalogEditorMessage'),save=form.querySelector('button[type="submit"]');
      if(message)message.textContent='Saving product…';if(save)save.disabled=true;
      try{
        const payload={
          name:document.getElementById('catalogEditName').value,
          selling_price:Number(document.getElementById('catalogEditPrice').value),
          catalog_category_code:category.value,
          category:document.getElementById('catalogEditCategory').value,
          description:document.getElementById('catalogEditDescription').value,
          catalog_attributes:collectCatalogAttributes(attrHost,{includeEmpty:true})
        };
        const brand=document.getElementById('catalogEditBrand'),model=document.getElementById('catalogEditModel'),condition=document.getElementById('catalogEditCondition'),mpn=document.getElementById('catalogEditMpn');
        if(brand)payload.brand=brand.value;if(model)payload.model=model.value;if(condition)payload.condition_code=condition.value;if(mpn)payload.manufacturer_part_number=mpn.value;
        for(const [field,id] of [['package_length_cm','catalogEditPackageLength'],['package_width_cm','catalogEditPackageWidth'],['package_height_cm','catalogEditPackageHeight'],['package_weight_kg','catalogEditPackageWeight']]){
          const input=document.getElementById(id);if(input)payload[field]=input.value||null;
        }
        const saved=await mapi('/api/merchant/storefront/products/'+Number(p.id),{method:'PATCH',body:JSON.stringify(payload)});
        const needsReview=Array.isArray(saved.catalog_attribute_reviews)&&saved.catalog_attribute_reviews.length>0;
        mtoast(needsReview?'Product saved as Private — review previous category details.':'Product saved.');
        await renderMerchantCatalog();
        if(needsReview)await openCatalogEditor(Number(p.id));else closeCatalogEditor();
      }catch(error){if(message)message.textContent=error.message;if(save)save.disabled=false}
    };
  }catch(error){
    panel.innerHTML='<div class="catalogEditorTop"><div><h2>Product editor</h2></div><button type="button" id="catalogEditorClose" aria-label="Close">×</button></div><div class="marketEmpty">'+mh(error.message)+'</div>';
    document.getElementById('catalogEditorClose').onclick=closeCatalogEditor;
  }
}

function bindStoreForm(){const f=document.getElementById('merchantStoreForm');if(!f)return;f.onsubmit=async e=>{e.preventDefault();const msg=document.getElementById('storeMessage');msg.textContent='';try{await mapi('/api/merchant/storefront',{method:'PUT',body:JSON.stringify({business_id:Number(document.getElementById('storeBusinessId').value),store_name:document.getElementById('storeName').value,description:document.getElementById('storeDescription').value,merchant_domain:document.getElementById('storeDomain').value,publication_status:document.getElementById('storeStatus').value,pickup_address:document.getElementById('storeAddress').value,presence_type:document.getElementById('storePresence')?.value||'online',public_location_enabled:Boolean(document.getElementById('storePublicLocation')?.checked),location_label:document.getElementById('storeLocationLabel')?.value||'',finding_instructions:document.getElementById('storeFinding')?.value||'',opening_hours_text:document.getElementById('storeOpeningHours')?.value||'',pickup_lat:document.getElementById('storeLat')?.value||null,pickup_lng:document.getElementById('storeLng')?.value||null,opening_status:document.getElementById('storeOpening').value,preparation_eta_minutes:Number(document.getElementById('storeEta').value),pickup_enabled:document.getElementById('storePickup').checked,delivery_enabled:document.getElementById('storeDelivery').checked,cash_enabled:document.getElementById('storeCash').checked,online_enabled:document.getElementById('storeOnline').checked,public_reputation_enabled:document.getElementById('storeReputation').checked,price_comparison_enabled:document.getElementById('storeCompare').checked,logo_data_url:document.getElementById('storeLogoData')?.value||merchantStore?.logo_data_url||''})});mtoast('Storefront saved.');await renderMerchantStore()}catch(err){msg.textContent=err.message}}}
function bindCatalog(){
  marketWorkspace.querySelectorAll('[data-edit-catalog-product]').forEach(button=>button.onclick=()=>openCatalogEditor(Number(button.dataset.editCatalogProduct)));
  marketWorkspace.querySelectorAll('[data-toggle-product]').forEach(b=>b.onclick=async()=>{try{const id=Number(b.dataset.toggleProduct),published=b.dataset.published!=='1';await mapi(`/api/merchant/storefront/products/${id}`,{method:'PATCH',body:JSON.stringify({published})});mtoast(published?'Product published.':'Product hidden from Marketplace.');await renderMerchantCatalog()}catch(e){mtoast(e.message)}});
  marketWorkspace.querySelectorAll('[data-archive-product]').forEach(b=>b.onclick=async()=>{if(!confirm('Archive this Catalog product? It will be hidden from customers and kept for history.'))return;try{await mapi(`/api/merchant/storefront/products/${Number(b.dataset.archiveProduct)}`,{method:'PATCH',body:JSON.stringify({active:false,published:false})});mtoast('Product archived.');await renderMerchantCatalog()}catch(e){mtoast(e.message)}});
  marketWorkspace.querySelectorAll('[data-restore-product]').forEach(b=>b.onclick=async()=>{try{await mapi(`/api/merchant/storefront/products/${Number(b.dataset.restoreProduct)}`,{method:'PATCH',body:JSON.stringify({active:true,published:false})});mtoast('Product restored as Private.');await renderMerchantCatalog()}catch(e){mtoast(e.message)}});
  marketWorkspace.querySelectorAll('[data-generate-image]').forEach(b=>b.onclick=async()=>{if(b.disabled)return;b.disabled=true;const label=b.textContent;b.textContent='Generating…';try{await mapi(`/api/merchant/storefront/products/${Number(b.dataset.generateImage)}/images/generate`,{method:'POST',body:'{}'});mtoast('AI image draft created. Review it before use.');await renderMerchantCatalog()}catch(e){mtoast(e.message);b.disabled=false;b.textContent=label}});
  marketWorkspace.querySelectorAll('[data-approve-image]').forEach(b=>b.onclick=async()=>{try{await mapi(`/api/merchant/storefront/products/${Number(b.dataset.approveImage)}/images/${Number(b.dataset.mediaId)}/approve`,{method:'POST',body:JSON.stringify({primary:true})});mtoast('Image approved as primary.');await renderMerchantCatalog()}catch(e){mtoast(e.message)}});
  marketWorkspace.querySelectorAll('[data-archive-image]').forEach(b=>b.onclick=async()=>{try{await mapi(`/api/merchant/storefront/products/${Number(b.dataset.archiveImage)}/images/${Number(b.dataset.mediaId)}/archive`,{method:'POST',body:'{}'});mtoast('Image draft discarded.');await renderMerchantCatalog()}catch(e){mtoast(e.message)}});
}
function showPlatformStore(){ensureMarket();hideBase();marketWorkspace.classList.remove('hidden');document.getElementById('basketBar').classList.add('hidden');marketWorkspace.innerHTML=marketHeader('Platform Store','Business & Life — Philippines')+`<section class="platformStoreNotice"><h2>Philippines Platform Store</h2><p>This destination is reserved for the separate Philippines Shopify store owned by the platform. It will not reuse products, collections or pricing from Ireland. The catalog stays empty until verified Philippines-local products and the dedicated Shopify store are configured.</p></section>`;bindBack()}

function applyMarketState(detail){const state=detail?.snapshot?detail:window.BusinessLifeProfileState;if(state?.snapshot)marketMe=state.snapshot}
async function decorateMarket(detail){if(!ensureMarket()||!mtok())return;const state=detail?.snapshot?detail:window.BusinessLifeProfileState;applyMarketState(state);if(!marketMe)return;const role=state?.surface==='profile'?state.activeRole:null;const hub=document.getElementById('roleHub');if(hub&&role==='customer'){const tiles=[...hub.querySelectorAll('[data-hub-feature="Marketplace"]')];if(tiles[0])tiles[0].onclick=()=>openMarketplace('food');if(tiles[1])tiles[1].onclick=()=>openMarketplace('non_food');const platform=hub.querySelector('[data-hub-feature="Platform Store"]');if(platform)platform.onclick=showPlatformStore}}
function observeMarket(){document.addEventListener('abl:profile-state',e=>decorateMarket(e.detail).catch(()=>{}),{passive:true})}
async function boot(){ensureMarket();observeMarket();await decorateMarket(window.BusinessLifeProfileState)}
window.BusinessLifeMarketplace=Object.freeze({openMerchantStore,openMerchantCatalog,openMarketplace,showPlatformStore,renderPublicStoreMap});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
