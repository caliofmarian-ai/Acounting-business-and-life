// Merchant stock CSV intake — client-only review layer over the canonical Inventory purchase API.
// Never holds auth tokens, bypasses current-business checks, or creates financial transactions.
const SUPPORTED_UNITS=new Set(['kg','g','L','ml','unit']);
const NORMALIZE=value=>String(value??'').trim().toLocaleLowerCase('en-PH').replace(/\s+/g,' ');
const CENTS=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;

export function parseCsvRecords(text){
  const source=String(text||'').replace(/^\uFEFF/,'');
  if(source.length>250000)throw new Error('CSV exceeds the 250 KB review limit.');
  const records=[];let field='',fields=[],quoted=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(ch==='"'){
      if(quoted&&source[i+1]==='"'){field+='"';i++}
      else quoted=!quoted;
    }else if(ch===','&&!quoted){fields.push(field);field=''}
    else if((ch==='\n'||ch==='\r')&&!quoted){
      fields.push(field);field='';
      if(fields.some(x=>String(x).trim()))records.push(fields);
      fields=[];if(ch==='\r'&&source[i+1]==='\n')i++;
    }else{field+=ch}
  }
  if(quoted)throw new Error('Unclosed quoted CSV field.');
  if(field||fields.length){fields.push(field);if(fields.some(x=>String(x).trim()))records.push(fields)}
  return records;
}

export function parseStockIntakeCsv(text){
  const records=parseCsvRecords(text);
  if(records.length<2)throw new Error('CSV must have a header and at least one product.');
  const headers=records.shift().map(x=>NORMALIZE(x));
  for(const required of ['item','proposed_quantity','proposed_unit','screenshot_line_php']){
    if(!headers.includes(required))throw new Error('Missing required CSV column: '+required);
  }
  if(records.length>80)throw new Error('Maximum 80 purchase lines per reviewed batch.');
  const seen=new Set();
  return records.map((cells,index)=>{
    if(cells.length!==headers.length)throw new Error('CSV line '+(index+2)+' has an incorrect number of columns.');
    const data=Object.fromEntries(headers.map((key,j)=>[key,String(cells[j]||'').trim()]));
    const item=data.item||'';
    if(!item||item.length>100)throw new Error('CSV line '+(index+2)+' has an invalid item name.');
    const key=NORMALIZE(item);
    if(seen.has(key))throw new Error('Duplicate product name in CSV: '+item);
    seen.add(key);
    const quantity=data.proposed_quantity===''?null:Number(data.proposed_quantity);
    const total=data.screenshot_line_php===''?NaN:Number(data.screenshot_line_php);
    const expected=data.recomputed_line_php===''||data.recomputed_line_php===undefined?null:Number(data.recomputed_line_php);
    const unit=data.proposed_unit||'';
    const flag=data.posting_status||'';
    const costMismatch=expected!==null&&Number.isFinite(expected)&&Number.isFinite(total)&&Math.abs(expected-total)>0.009;
    const requiresReview=!Number.isFinite(quantity)||quantity===null||quantity<=0||costMismatch
      ||/(VERIFY|CONFIRM QTY|CHECK PRICE|REVIEW|UNKNOWN)/i.test(flag);
    return{
      key:String(index+1),item,quantity,unit,total,expected,flag,
      note:String(data.review_note||'').slice(0,240),
      requiresReview,reviewConfirmed:false,selected:false,
      exists:null,result:'pending',error:''
    };
  });
}

export function validStockIntakeRow(row){
  return Boolean(row&&row.item&&row.item.length<=100&&
    Number.isFinite(row.quantity)&&row.quantity>0&&row.quantity<=1000000&&
    Math.abs(row.quantity*10000-Math.round(row.quantity*10000))<1e-6&&
    SUPPORTED_UNITS.has(row.unit)&&Number.isFinite(row.total)&&
    row.total>=0&&row.total<=100000000&&
    Math.abs(row.total*100-Math.round(row.total*100))<1e-6&&
    (!row.requiresReview||row.reviewConfirmed)&&
    !row.exists&&row.result==='pending');
}

export function findExistingInventory(row,inventory){
  const name=NORMALIZE(row?.item);
  return (Array.isArray(inventory)?inventory:[]).find(value=>NORMALIZE(value.item)===name)||null;
}

const hasDocument=typeof document!=='undefined';
if(hasDocument){
  const $=id=>document.getElementById(id);
  const state={context:null,inventory:[],rows:[],busy:false,stop:false,accountId:null,resultLog:[]};
  function message(id,text,kind=''){
    const el=$(id);if(!el)return;el.textContent=text;el.classList.toggle('error',kind==='error');el.classList.toggle('ok',kind==='ok');
  }
  async function api(path,options={}){
    const response=await fetch(path,{
      credentials:'same-origin',cache:'no-store',...options,
      headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}
    });
    const data=await response.json().catch(()=>({error:'Invalid server response'}));
    if(!response.ok){const err=new Error(data.error||'Request failed ('+response.status+')');err.status=response.status;throw err}
    return data;
  }
  async function snapshot(){
    if(!window.ABLSession?.authenticated())throw new Error('Please sign in to Business & Life first, then return to this page.');
    const me=await api('/api/me');
    if(me?.account?.active_role!=='merchant'||!me?.profiles?.some(p=>p.role==='merchant'&&p.enabled))
      throw new Error('Switch to an active Merchant profile before starting a stock import.');
    const workspace=await api('/api/accounting/workspaces');
    if(workspace.role!=='merchant')throw new Error('The active business is not a Merchant workspace.');
    if(!Array.isArray(workspace.businesses)||workspace.businesses.length!==1)
      throw new Error('Multiple Merchant businesses are bound to this account. Use the normal Merchant Stock form until exact-business-bound purchases are released.');
    const business=workspace.businesses[0];
    if(Number(business.id)!==Number(workspace.active_business_id))
      throw new Error('The active Merchant business changed. Reload before importing.');
    if(business.country_code&&business.country_code!=='PH')
      throw new Error('This importer is for Philippines Merchant businesses only.');
    return{accountId:Number(me.account.id),businessId:Number(business.id),businessName:String(business.name||'')};
  }
  function sameContext(a,b){
    return a&&b&&a.accountId===b.accountId&&a.businessId===b.businessId&&a.businessName===b.businessName;
  }
  function exactlyConfirmedBusiness(){
    return Boolean(state.context&&NORMALIZE($('businessName').value)===NORMALIZE(state.context.businessName));
  }
  function refreshExisting(){
    state.rows.forEach(row=>{row.exists=findExistingInventory(row,state.inventory)});
  }
  function renderBusiness(){
    $('businessCheck').classList.toggle('hidden',!state.context);
    if(state.context){
      message('authStatus','Signed in as Merchant. Active business: '+state.context.businessName+
        ' (ID '+state.context.businessId+'). Current Inventory items: '+state.inventory.length+
        '. No stock has been changed.','ok');
    }
    updateControls();
  }
  async function refreshContext(){
    if(state.busy)return;
    $('refreshContext').disabled=true;
    message('authStatus','Checking Merchant profile, business binding, and live Inventory…');
    state.context=null;state.inventory=[];
    try{
      const next=await snapshot();
      const inventory=await api('/api/inventory');
      const verify=await snapshot();
      if(!sameContext(next,verify))throw new Error('Merchant business changed during Inventory read.');
      state.context=verify;state.accountId=verify.accountId;
      state.inventory=Array.isArray(inventory)?inventory:[];
      refreshExisting();renderRows();renderBusiness();
    }catch(error){
      message('authStatus',error.message||'Merchant and Inventory could not be checked.','error');
      $('businessCheck').classList.add('hidden');
    }finally{$('refreshContext').disabled=false;updateControls()}
  }
  function element(tag,cls,text){
    const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;
  }
  function createField(labelText,value,options,onChange){
    const wrap=element('label');wrap.appendChild(element('span','',labelText));
    let input;
    if(options?.choices){
      input=document.createElement('select');
      for(const choice of options.choices){
        const opt=document.createElement('option');opt.value=choice;opt.textContent=choice;input.appendChild(opt);
      }
      input.value=value;
    }else{
      input=document.createElement('input');input.type='number';input.inputMode='decimal';
      input.min=options?.min??'0';input.step=options?.step??'0.0001';
      input.value=value===null||!Number.isFinite(Number(value))?'':String(value);
    }
    input.disabled=state.busy||options?.disabled||false;
    input.addEventListener('change',()=>onChange(input.value));
    wrap.appendChild(input);return wrap;
  }
  function renderRows(){
    const target=$('rows');target.replaceChildren();
    state.rows.forEach(row=>{
      const item=element('article','item'+(row.exists?' existing':'')+(row.requiresReview?' review':'')+(row.result==='saved'?' saved':''));
      const top=element('div','controls');
      const title=element('h3','',row.item);top.appendChild(title);
      const status=row.result==='saved'?'Saved':row.exists?'Already in Inventory':row.result==='uncertain'?'Needs investigation':row.result==='error'?'Stopped':row.requiresReview?'Review required':'Ready to review';
      top.appendChild(element('span','tag'+(row.exists||row.result==='error'?' error':row.requiresReview?' warn':' ok'),status));
      item.appendChild(top);
      const detail=element('p','muted',
        'Source: '+(row.expected!==null&&Number.isFinite(row.expected)?'recalculated ₱'+CENTS(row.expected).toFixed(2)+' · ':'')+
        'recorded ₱'+(Number.isFinite(row.total)?CENTS(row.total).toFixed(2):'unknown')+
        (row.flag?' · '+row.flag:''));
      item.appendChild(detail);
      if(row.note)item.appendChild(element('p','muted',row.note));
      if(row.exists)item.appendChild(element('p','error',
        'An Inventory item already exists with this name (on hand: '+String(row.exists.quantity??row.exists.on_hand_quantity??'unknown')+
        ' '+String(row.exists.unit||'')+'). This tool will NOT add it again. Use ordinary Stock receiving if this is a distinct new purchase.'));
      const columns=element('div','columns');
      columns.appendChild(createField('Physically confirmed quantity',row.quantity,{step:'0.0001'},value=>{
        row.quantity=value===''?null:Number(value);renderRows();
      }));
      columns.appendChild(createField('Unit',row.unit,{choices:['kg','g','L','ml','unit']},value=>{
        row.unit=value;renderRows();
      }));
      columns.appendChild(createField('Value of stock to add (₱)',row.total,{step:'0.01'},value=>{
        row.total=value===''?NaN:Number(value);renderRows();
      }));
      item.appendChild(columns);
      if(row.requiresReview){
        const label=element('label','check');
        const check=document.createElement('input');check.type='checkbox';
        check.checked=row.reviewConfirmed;check.disabled=state.busy||row.result!=='pending';
        check.addEventListener('change',()=>{row.reviewConfirmed=check.checked;renderRows()});
        label.append(check,element('span','',
          'I verified the unclear amount, pack size or quantity against the actual goods. Accept this corrected value.'));
        item.appendChild(label);
      }
      const select=element('label','check');
      const check=document.createElement('input');check.type='checkbox';check.checked=row.selected;
      check.disabled=state.busy||row.result!=='pending'||Boolean(row.exists);
      check.addEventListener('change',()=>{row.selected=check.checked;updateControls()});
      select.append(check,element('span','',row.result==='saved'?'Saved to Merchant Stock':
        row.exists?'Not selected — existing stock detected':'Include this item in the approved stock batch'));
      item.appendChild(select);
      if(row.error)item.appendChild(element('p','error',row.error));
      target.appendChild(item);
    });
    updateControls();
  }
  function updateControls(){
    const selected=state.rows.filter(x=>x.selected&&x.result==='pending');
    const valid=selected.filter(validStockIntakeRow);
    $('reviewPanel').classList.toggle('hidden',!state.rows.length);
    $('commitPanel').classList.toggle('hidden',!state.rows.length);
    $('rowsCounter').textContent=
      state.rows.length+' lines · '+selected.length+' selected · '+valid.length+' validated · '+
      state.rows.filter(x=>x.exists).length+' already in Inventory · '+
      state.rows.filter(x=>x.result==='saved').length+' saved this session';
    $('post').disabled=state.busy||!state.context||!exactlyConfirmedBusiness()||
      !selected.length||selected.length!==valid.length||
      !$('physicalConfirm').checked||!$('moneyConfirm').checked;
    $('stop').disabled=!state.busy;
    $('selectSafe').disabled=state.busy||!state.rows.length;
    $('clearSelection').disabled=state.busy||!state.rows.length;
  }
  async function readFile(){
    const file=$('csv').files?.[0];if(!file)return;
    if(file.size>250000){message('fileStatus','CSV is too large.','error');return}
    try{
      const parsed=parseStockIntakeCsv(await file.text());
      state.rows=parsed;state.resultLog=[];
      refreshExisting();renderRows();
      message('fileStatus',parsed.length+' rows loaded locally. No server writes have occurred.','ok');
      message('results','No changes made.');
    }catch(error){state.rows=[];renderRows();message('fileStatus',error.message,'error')}
  }
  async function assertLiveContext(){
    const before=await snapshot();
    if(!sameContext(before,state.context)||state.accountId!==before.accountId)
      throw new Error('Active Merchant account or business changed. Import stopped.');
    const inventory=await api('/api/inventory');
    const after=await snapshot();
    if(!sameContext(after,state.context))throw new Error('Merchant business changed during stock preflight.');
    state.inventory=Array.isArray(inventory)?inventory:[];
  }
  async function saveSelected(){
    if($('post').disabled||state.busy)return;
    state.busy=true;state.stop=false;updateControls();
    const originalContext=state.context;
    const pending=state.rows.filter(row=>row.selected&&validStockIntakeRow(row));
    let saved=0;
    for(const row of pending){
      if(state.stop)break;
      try{
        await assertLiveContext();
        if(!sameContext(originalContext,state.context))throw new Error('Merchant context changed.');
        // Existing-name checks stop this row rather than silently increasing stock.
        const existing=findExistingInventory(row,state.inventory);
        if(existing){row.exists=existing;row.selected=false;row.error='Item appeared in existing Inventory; no automatic additional purchase posted.';continue}
        if(!validStockIntakeRow(row))throw new Error('Stock quantity, unit, cost or review confirmation is not valid.');
        row.result='posting';renderRows();
        // One canonical purchase per line. Never set record_expense=true for a historical import.
        const result=await api('/api/inventory/purchase',{method:'POST',body:JSON.stringify({
          item:row.item,inventory_domain:'food',stock_role:'ingredient',inventory_type:'ingredient',
          purchase_quantity:row.quantity,purchase_unit:row.unit,total_cost:CENTS(row.total),
          account:'other',record_expense:false,
          note:'Physical Merchant stock intake from reviewed CSV. Original purchase date/payment not asserted. '+row.note
        })});
        if(!result?.inventory?.id||!result?.purchase?.id)throw new Error('Purchase response was incomplete; manual reconciliation required.');
        row.result='saved';row.selected=false;saved++;
        state.inventory.push(result.inventory);
        state.resultLog.push(row.item+' — confirmed purchase #'+result.purchase.id);
        message('results',saved+' item(s) saved. No money transactions created.\n'+state.resultLog.join('\n'),'ok');
        renderRows();
      }catch(error){
        // No automatic retry: the server endpoint has no request-key idempotency.
        row.result='uncertain';row.error='STOPPED: '+(error?.message||'Unknown error')+
          '. The request may have reached production; reconcile Stock before any retry.';
        state.stop=true;renderRows();
        message('results','Batch STOPPED after '+saved+' confirmed item(s). Review the last item and refreshed Inventory before attempting anything else.','error');
        break;
      }
    }
    state.busy=false;
    if(!state.stop)message('results',saved+' new item(s) saved to the active Merchant, with no financial expense posted.\n'+state.resultLog.join('\n'),'ok');
    renderRows();updateControls();
  }
  $('refreshContext').addEventListener('click',refreshContext);
  $('csv').addEventListener('change',readFile);
  $('businessName').addEventListener('input',updateControls);
  $('physicalConfirm').addEventListener('change',updateControls);
  $('moneyConfirm').addEventListener('change',updateControls);
  $('post').addEventListener('click',saveSelected);
  $('stop').addEventListener('click',()=>{state.stop=true;message('results','Stopping after the active purchase request finishes. No next item will be sent.','error')});
  $('selectSafe').addEventListener('click',()=>{
    state.rows.forEach(r=>{if(r.result==='pending'&&!r.exists&&!r.requiresReview&&validStockIntakeRow({...r,selected:true}))r.selected=true});
    renderRows();
  });
  $('clearSelection').addEventListener('click',()=>{state.rows.forEach(r=>{if(r.result==='pending')r.selected=false});renderRows()});
  refreshContext();
}
