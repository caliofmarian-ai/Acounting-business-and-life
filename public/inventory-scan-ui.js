const byId=id=>document.getElementById(id);

function scannerSupported(){
  return Boolean(window.isSecureContext&&window.BarcodeDetector&&navigator.mediaDevices?.getUserMedia);
}

export function createInventoryScanUi({
  api,
  getInventory,
  refreshInventory,
  escapeHtml,
  formatNumber,
  onReceiveItem,
  onCountItem
}){
  const esc=escapeHtml;
  const num=formatNumber;
  let wired=false;
  let stream=null;
  let detector=null;
  let scanning=false;
  let detectBusy=false;
  let lastDetectAt=0;

  function setMessage(text='',tone=''){
    const node=byId('inventoryLookupMessage');
    if(!node)return;
    node.className=tone||'';
    node.textContent=text;
  }

  function setIdentifierMessage(text='',tone=''){
    const node=byId('inventoryIdentifierMessage');
    if(!node)return;
    node.className=tone||'';
    node.textContent=text;
  }

  function inventoryRows(){
    return Array.isArray(getInventory?.())?getInventory():[];
  }

  function fillIdentifierItems(preferredId=null){
    const select=byId('inventoryIdentifierItem');
    if(!select)return;
    const rows=inventoryRows();
    const prior=preferredId!=null?String(preferredId):select.value;
    select.replaceChildren(
      new Option('Choose an item',''),
      ...rows.map(row=>new Option(
        String(row.item||'')+(row.internal_sku?' · '+row.internal_sku:'')+(row.barcode?' · '+row.barcode:''),
        String(row.id)
      ))
    );
    if(prior&&rows.some(row=>String(row.id)===prior))select.value=prior;
    loadIdentifierEditor();
  }

  function loadIdentifierEditor(){
    const id=Number(byId('inventoryIdentifierItem')?.value);
    const row=inventoryRows().find(item=>Number(item.id)===id);
    if(byId('inventoryInternalSku'))byId('inventoryInternalSku').value=row?.internal_sku||'';
    if(byId('inventoryBarcode'))byId('inventoryBarcode').value=row?.barcode||'';
    setIdentifierMessage(row
      ?'Editing optional identifiers for '+row.item+'.'
      :'Choose an Inventory item. Fresh ingredients can stay code-free.'
    );
  }

  function identifierCopy(row){
    const parts=[];
    if(row.internal_sku)parts.push('SKU '+esc(row.internal_sku));
    if(row.barcode)parts.push('barcode '+esc(row.barcode));
    return parts.length?parts.join(' · '):'No SKU or barcode assigned';
  }

  function renderResults(rows,{source='search'}={}){
    const list=byId('inventoryLookupResults');
    if(!list)return;
    const items=Array.isArray(rows)?rows:[];
    if(!items.length){
      list.replaceChildren();
      setMessage(
        source==='scan'
          ?'No Inventory item matches this scanned code. Manual search and identifier editing remain available.'
          :'No Inventory item matches that search.',
        'negative'
      );
      return;
    }
    const nodes=items.map(row=>{
      const wrap=document.createElement('div');
      wrap.className='listRow inventoryLookupResult';
      wrap.dataset.inventoryId=String(row.id);
      const main=document.createElement('div');
      main.className='rowMain';
      const stock=Number(row.usable_quantity??row.quantity??0);
      main.innerHTML='<strong>'+esc(row.item)+'</strong><small>'+identifierCopy(row)+' · stock '+num(stock,4)+' '+esc(row.unit||'')+'</small>';
      const actions=document.createElement('div');
      actions.className='inventoryLookupActions';

      const receive=document.createElement('button');
      receive.type='button';receive.className='miniBtn';receive.textContent='Receive purchase';
      receive.addEventListener('click',()=>{
        onReceiveItem?.(row);
        setMessage(row.item+' loaded into receiving. Enter the actual purchase quantity, cost, lot and expiry.','positive');
      });

      const count=document.createElement('button');
      count.type='button';count.className='miniBtn';count.textContent='Count item';
      count.addEventListener('click',()=>{
        const ok=onCountItem?.(row);
        if(ok)setMessage(row.item+' selected in the active Inventory count.','positive');
        else setMessage('This item is not available in an active count session. Start or resume a count, or keep using manual Inventory controls.','negative');
      });

      const edit=document.createElement('button');
      edit.type='button';edit.className='miniBtn';edit.textContent='Identifiers';
      edit.addEventListener('click',()=>{
        byId('inventoryIdentifiersEditor')?.setAttribute('open','');
        fillIdentifierItems(row.id);
        byId('inventoryIdentifiersEditor')?.scrollIntoView({behavior:'smooth',block:'nearest'});
      });

      actions.append(receive,count,edit);
      wrap.append(main,actions);
      return wrap;
    });
    list.replaceChildren(...nodes);
    setMessage(
      items.length===1
        ?'1 Inventory item matched'+(source==='scan'?' the scanned barcode':'')+'.'
        :items.length+' Inventory items matched. Choose the correct item.',
      'positive'
    );
  }

  async function lookup({query='',barcode=''}={}){
    const cleanQuery=String(query||'').trim();
    const cleanBarcode=String(barcode||'').trim();
    if(!cleanQuery&&!cleanBarcode){
      setMessage('Enter an item name, SKU or barcode.','negative');
      return[];
    }
    setMessage(cleanBarcode?'Looking up scanned barcode…':'Searching Inventory…');
    try{
      const path=cleanBarcode
        ?'/api/inventory/lookup?barcode='+encodeURIComponent(cleanBarcode)
        :'/api/inventory/lookup?q='+encodeURIComponent(cleanQuery);
      const rows=await api(path);
      renderResults(rows,{source:cleanBarcode?'scan':'search'});
      return rows;
    }catch(error){
      renderResults([],{source:cleanBarcode?'scan':'search'});
      setMessage(error.message||'Inventory lookup failed.','negative');
      return[];
    }
  }

  function stopCamera(){
    scanning=false;
    detectBusy=false;
    if(stream){
      for(const track of stream.getTracks())track.stop();
      stream=null;
    }
    const video=byId('inventoryScanVideo');
    if(video){
      try{video.pause()}catch{}
      video.srcObject=null;
    }
    byId('inventoryScannerPane')?.classList.add('hidden');
  }

  async function scanLoop(timestamp=0){
    if(!scanning)return;
    const video=byId('inventoryScanVideo');
    if(!video||video.readyState<2){
      requestAnimationFrame(scanLoop);
      return;
    }
    if(!detectBusy&&timestamp-lastDetectAt>=220){
      lastDetectAt=timestamp;
      detectBusy=true;
      try{
        const hits=await detector.detect(video);
        const code=String(hits?.[0]?.rawValue||'').trim();
        if(code){
          if(byId('inventoryLookupQuery'))byId('inventoryLookupQuery').value=code;
          stopCamera();
          await lookup({barcode:code});
          return;
        }
      }catch(error){
        if(scanning){
          stopCamera();
          setMessage('Camera scanning stopped. Manual search remains available.','negative');
          const support=byId('inventoryScanSupport');
          if(support)support.textContent=error?.message||'Barcode detection could not continue.';
          return;
        }
      }finally{
        detectBusy=false;
      }
    }
    if(scanning)requestAnimationFrame(scanLoop);
  }

  async function startCamera(){
    if(!scannerSupported()){
      const support=byId('inventoryScanSupport');
      if(support)support.innerHTML='<strong>Manual search available</strong><br><span class="muted">This browser does not expose camera barcode detection. Inventory remains fully usable without scanning.</span>';
      setMessage('Camera scanning is unavailable on this device/browser. Use manual search instead.','negative');
      return;
    }
    stopCamera();
    setMessage('Opening camera…');
    try{
      detector=new window.BarcodeDetector();
      stream=await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}
      });
      const video=byId('inventoryScanVideo');
      if(!video)throw new Error('Scanner view is unavailable.');
      video.srcObject=stream;
      await video.play();
      scanning=true;
      byId('inventoryScannerPane')?.classList.remove('hidden');
      const support=byId('inventoryScanSupport');
      if(support)support.innerHTML='<strong>Camera scanner active</strong><br><span class="muted">Align one barcode in the frame. No image is uploaded or stored.</span>';
      setMessage('Scanning for a barcode…');
      requestAnimationFrame(scanLoop);
    }catch(error){
      stopCamera();
      const support=byId('inventoryScanSupport');
      if(support)support.innerHTML='<strong>Manual search available</strong><br><span class="muted">Camera access was unavailable or denied. Inventory remains fully usable without scanning.</span>';
      setMessage(error?.name==='NotAllowedError'
        ?'Camera permission was denied. Use manual search instead.'
        :(error.message||'Camera scanning is unavailable. Use manual search instead.'),
      'negative');
    }
  }

  async function saveIdentifiers(){
    const inventoryId=Number(byId('inventoryIdentifierItem')?.value);
    if(!Number.isInteger(inventoryId)){
      setIdentifierMessage('Choose an Inventory item first.','negative');
      return;
    }
    setIdentifierMessage('Saving identifiers…');
    try{
      const saved=await api('/api/inventory/'+inventoryId+'/identifiers',{
        method:'PATCH',
        body:JSON.stringify({
          internal_sku:byId('inventoryInternalSku')?.value||'',
          barcode:byId('inventoryBarcode')?.value||''
        })
      });
      if(typeof refreshInventory==='function')await refreshInventory();
      fillIdentifierItems(saved.id);
      setIdentifierMessage('Identifiers saved. Manual search and camera lookup now use these values.','positive');
    }catch(error){
      const detail=error?.data?.conflicting_item?' Conflicts with '+error.data.conflicting_item+'.':'';
      setIdentifierMessage((error.message||'Identifiers could not be saved.')+detail,'negative');
    }
  }

  function syncInventory(){
    fillIdentifierItems();
  }

  function wire(){
    if(wired||!byId('inventoryScanCard'))return;
    wired=true;
    const supported=scannerSupported();
    const scan=byId('inventoryScanStart');
    if(scan)scan.disabled=!supported;
    const support=byId('inventoryScanSupport');
    if(support)support.innerHTML=supported
      ?'<strong>Camera scan available</strong><br><span class="muted">Camera permission is requested only when you tap Scan barcode. Manual search is always available.</span>'
      :'<strong>Manual search available</strong><br><span class="muted">Camera barcode detection is not supported here. Inventory remains fully usable without scanning.</span>';

    byId('inventoryLookupForm')?.addEventListener('submit',event=>{
      event.preventDefault();
      lookup({query:byId('inventoryLookupQuery')?.value||''});
    });
    scan?.addEventListener('click',startCamera);
    byId('inventoryScanStop')?.addEventListener('click',stopCamera);
    byId('inventoryIdentifierItem')?.addEventListener('change',loadIdentifierEditor);
    byId('inventoryIdentifierSave')?.addEventListener('click',saveIdentifiers);
    window.addEventListener('pagehide',stopCamera);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera()});
    syncInventory();
  }

  return{
    wire,
    syncInventory,
    lookup,
    stopCamera,
    selectIdentifierItem(id){
      byId('inventoryIdentifiersEditor')?.setAttribute('open','');
      fillIdentifierItems(id);
    }
  };
}
