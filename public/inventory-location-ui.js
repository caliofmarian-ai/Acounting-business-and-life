const byId=id=>document.getElementById(id);

export function createInventoryLocationUi({
  api,
  getInventory,
  refreshInventory,
  escapeHtml,
  formatNumber,
  onLocationsChanged
}){
  const esc=escapeHtml;
  const num=formatNumber;
  let locations=[];
  let balances=[];
  let transfers=[];
  let wired=false;

  function setText(id,text,tone=''){
    const node=byId(id);
    if(!node)return;
    node.className=tone||'';
    node.textContent=text;
  }

  function inventoryRows(){
    return Array.isArray(getInventory?.())?getInventory():[];
  }

  function locationById(id){
    return locations.find(row=>Number(row.id)===Number(id))||null;
  }

  function renderBalances(){
    const list=byId('inventoryLocationBalanceList');
    if(!list)return;
    const nodes=balances.filter(row=>Number(row.quantity)>0).map(row=>{
      const div=document.createElement('div');
      div.className='listRow inventoryLocationBalanceRow';
      div.dataset.inventoryId=String(row.inventory_id);
      div.dataset.locationId=String(row.location_id);
      div.innerHTML='<div class="rowMain"><strong>'+esc(row.item)+' · '+esc(row.location_name)+'</strong><small>'+esc(row.storage_condition)+' · '+esc(String(row.storage_area_type||'').replaceAll('_',' '))+(row.location_label?' · '+esc(row.location_label):'')+'</small></div><span>'+num(row.quantity,4)+' '+esc(row.unit||'')+'</span>';
      return div;
    });
    list.replaceChildren(...(nodes.length?nodes:[emptyNode('No allocated location balances yet.')]));
  }

  function fillTransferItems(){
    const select=byId('inventoryTransferItem');
    if(!select)return;
    const previous=select.value;
    const rows=inventoryRows().filter(item=>balances.some(b=>Number(b.inventory_id)===Number(item.id)&&Number(b.quantity)>0));
    select.replaceChildren(new Option('Choose an item',''),...rows.map(item=>new Option(item.item,String(item.id))));
    if(previous&&rows.some(item=>String(item.id)===previous))select.value=previous;
    fillTransferLocations();
  }

  function fillTransferLocations(){
    const inventoryId=Number(byId('inventoryTransferItem')?.value);
    const source=byId('inventoryTransferSource');
    const destination=byId('inventoryTransferDestination');
    if(!source||!destination)return;
    const sourcePrior=source.value,destinationPrior=destination.value;
    const available=balances.filter(row=>Number(row.inventory_id)===inventoryId&&Number(row.quantity)>0);
    source.replaceChildren(
      new Option('Choose source',''),
      ...available.map(row=>new Option(row.location_name+' · '+num(row.quantity,4)+' '+(row.unit||''),String(row.location_id)))
    );
    destination.replaceChildren(
      new Option('Choose destination',''),
      ...locations.filter(row=>row.active!==false).map(row=>new Option(row.name,String(row.id)))
    );
    if(sourcePrior&&available.some(row=>String(row.location_id)===sourcePrior))source.value=sourcePrior;
    if(destinationPrior&&locations.some(row=>String(row.id)===destinationPrior))destination.value=destinationPrior;
    updateTransferPreview();
  }

  function updateTransferPreview(){
    const out=byId('inventoryTransferPreview');
    if(!out)return;
    const inventoryId=Number(byId('inventoryTransferItem')?.value);
    const sourceId=Number(byId('inventoryTransferSource')?.value);
    const destinationId=Number(byId('inventoryTransferDestination')?.value);
    const qty=Number(byId('inventoryTransferQuantity')?.value);
    const item=inventoryRows().find(row=>Number(row.id)===inventoryId);
    const source=balances.find(row=>Number(row.inventory_id)===inventoryId&&Number(row.location_id)===sourceId);
    const destination=locationById(destinationId);
    if(!item||!source||!destination||sourceId===destinationId||!Number.isFinite(qty)||qty<=0){
      out.textContent='Choose an item, two different locations and a quantity greater than zero.';
      return;
    }
    if(qty>Number(source.quantity)+1e-9){
      out.innerHTML='<strong class="negative">Source location has only '+num(source.quantity,4)+' '+esc(item.unit||'')+'.</strong>';
      return;
    }
    out.innerHTML='Move <strong>'+num(qty,4)+' '+esc(item.unit||'')+'</strong> from <strong>'+esc(source.location_name)+'</strong> to <strong>'+esc(destination.name)+'</strong>. Business-total stock remains unchanged.';
  }

  function renderTransfers(){
    const list=byId('inventoryTransferList');
    if(!list)return;
    const reversed=new Set(transfers.filter(row=>row.reversal_of_transfer_id!=null).map(row=>Number(row.reversal_of_transfer_id)));
    const nodes=transfers.map(row=>{
      const div=document.createElement('div');
      div.className='listRow inventoryTransferRow';
      const when=row.created_at?new Date(row.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'}):'';
      const reversedByAnother=reversed.has(Number(row.id));
      const reversal=row.reversal_of_transfer_id!=null;
      div.innerHTML='<div class="rowMain"><strong>'+esc(row.item)+' · '+num(row.quantity,4)+' '+esc(row.unit||'')+'</strong><small>'+esc(row.source_location)+' → '+esc(row.destination_location)+(reversal?' · reversal of #'+esc(row.reversal_of_transfer_id):'')+(when?' · '+esc(when):'')+(row.note?' · '+esc(row.note):'')+'</small></div>';
      if(!reversal&&!reversedByAnother){
        const button=document.createElement('button');
        button.type='button';button.className='miniBtn';button.textContent='Reverse';
        button.addEventListener('click',()=>reverseTransfer(row.id));
        div.appendChild(button);
      }else{
        const state=document.createElement('span');
        state.className=reversal?'positive':'muted';
        state.textContent=reversal?'REVERSAL':'REVERSED';
        div.appendChild(state);
      }
      return div;
    });
    list.replaceChildren(...(nodes.length?nodes:[emptyNode('No internal transfers recorded yet.')]));
  }

  function emptyNode(text){
    const node=document.createElement('div');
    node.className='emptyState';
    node.textContent=text;
    return node;
  }

  async function load(){
    if(!byId('inventoryLocationsCard'))return{locations:[],balances:[],transfers:[]};
    try{
      const result=await Promise.all([
        api('/api/inventory/locations'),
        api('/api/inventory/location-balances'),
        api('/api/inventory/transfers')
      ]);
      locations=Array.isArray(result[0])?result[0]:[];
      balances=Array.isArray(result[1])?result[1]:[];
      transfers=Array.isArray(result[2])?result[2]:[];
      renderBalances();
      fillTransferItems();
      renderTransfers();
      onLocationsChanged?.(locations);
      return{locations,balances,transfers};
    }catch(error){
      setText('inventoryTransferMessage',error.message||'Storage locations could not be loaded.','negative');
      return{locations,balances,transfers};
    }
  }

  async function createLocation(event){
    event.preventDefault();
    setText('inventoryLocationMessage','Saving location…');
    try{
      await api('/api/inventory/locations',{
        method:'POST',
        body:JSON.stringify({
          name:byId('inventoryLocationName')?.value||'',
          storage_condition:byId('inventoryLocationCondition')?.value||'other',
          storage_area_type:byId('inventoryLocationArea')?.value||'other',
          location_label:byId('inventoryLocationLabel')?.value||'',
          storage_segregated:Boolean(byId('inventoryLocationSegregated')?.checked)
        })
      });
      event.target.reset();
      setText('inventoryLocationMessage','Location added.','positive');
      await load();
    }catch(error){
      setText('inventoryLocationMessage',error.message||'Location could not be added.','negative');
    }
  }

  async function transfer(event){
    event.preventDefault();
    const inventoryId=Number(byId('inventoryTransferItem')?.value);
    const sourceId=Number(byId('inventoryTransferSource')?.value);
    const destinationId=Number(byId('inventoryTransferDestination')?.value);
    const quantity=Number(byId('inventoryTransferQuantity')?.value);
    if(!Number.isInteger(inventoryId)||!Number.isInteger(sourceId)||!Number.isInteger(destinationId)||sourceId===destinationId||!Number.isFinite(quantity)||quantity<=0){
      setText('inventoryTransferMessage','Choose an item, two different locations and a valid quantity.','negative');
      return;
    }
    setText('inventoryTransferMessage','Transferring stock…');
    try{
      const saved=await api('/api/inventory/transfers',{
        method:'POST',
        body:JSON.stringify({
          inventory_id:inventoryId,
          source_location_id:sourceId,
          destination_location_id:destinationId,
          quantity,
          note:byId('inventoryTransferNote')?.value||''
        })
      });
      setText('inventoryTransferMessage','Transfer saved. Business total remains '+num(saved.business_total,4)+' '+(inventoryRows().find(x=>Number(x.id)===inventoryId)?.unit||'')+'.','positive');
      if(byId('inventoryTransferQuantity'))byId('inventoryTransferQuantity').value='';
      if(byId('inventoryTransferNote'))byId('inventoryTransferNote').value='';
      await load();
      if(typeof refreshInventory==='function')await refreshInventory();
    }catch(error){
      setText('inventoryTransferMessage',error.message||'Transfer could not be saved.','negative');
    }
  }

  async function reverseTransfer(id){
    setText('inventoryTransferMessage','Reversing transfer…');
    try{
      await api('/api/inventory/transfers/'+Number(id)+'/reverse',{
        method:'POST',
        body:JSON.stringify({note:'Reversed from Merchant Inventory'})
      });
      setText('inventoryTransferMessage','Transfer reversed with linked audit evidence.','positive');
      await load();
      if(typeof refreshInventory==='function')await refreshInventory();
    }catch(error){
      setText('inventoryTransferMessage',error.message||'Transfer could not be reversed.','negative');
    }
  }

  function wire(){
    if(wired||!byId('inventoryLocationsCard'))return;
    wired=true;
    byId('inventoryLocationForm')?.addEventListener('submit',createLocation);
    byId('inventoryTransferForm')?.addEventListener('submit',transfer);
    byId('inventoryTransferItem')?.addEventListener('change',fillTransferLocations);
    byId('inventoryTransferSource')?.addEventListener('change',updateTransferPreview);
    byId('inventoryTransferDestination')?.addEventListener('change',updateTransferPreview);
    byId('inventoryTransferQuantity')?.addEventListener('input',updateTransferPreview);
    byId('inventoryLocationsRefresh')?.addEventListener('click',()=>load());
  }

  return{
    wire,
    load,
    getLocations:()=>locations.slice(),
    getBalances:()=>balances.slice()
  };
}
