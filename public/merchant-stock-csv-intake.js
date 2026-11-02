// Merchant stock CSV intake — client-only review layer over the canonical Inventory purchase API.
// Never holds auth tokens, bypasses current-business checks, or creates financial transactions.
const SUPPORTED_UNITS=new Set(['kg','g','L','ml','unit']);
export const STOCK_INTAKE_CLASSIFICATIONS=Object.freeze({
  food_ingredient:Object.freeze({label:'Food · recipe ingredient',inventory_domain:'food',stock_role:'ingredient',inventory_type:'ingredient'}),
  food_resale:Object.freeze({label:'Food · direct resale',inventory_domain:'food',stock_role:'direct_resale',inventory_type:'resale_item'}),
  non_food_resale:Object.freeze({label:'Non-food · direct resale',inventory_domain:'non_food',stock_role:'direct_resale',inventory_type:'resale_item'}),
  production_material:Object.freeze({label:'Non-food · production material',inventory_domain:'non_food',stock_role:'production_material',inventory_type:'production_material'}),
  packaging:Object.freeze({label:'Operations · packaging',inventory_domain:'operations',stock_role:'packaging',inventory_type:'packaging'}),
  kitchen_consumable:Object.freeze({label:'Operations · kitchen consumable',inventory_domain:'operations',stock_role:'operational_consumable',inventory_type:'kitchen_consumable'}),
  cleaning_sanitation:Object.freeze({label:'Operations · cleaning / sanitation',inventory_domain:'operations',stock_role:'operational_supply',inventory_type:'cleaning_sanitation'}),
  operational_supply:Object.freeze({label:'Operations · other supply',inventory_domain:'operations',stock_role:'operational_supply',inventory_type:'operational_supply'})
});
// A CSV or shop receipt cannot prove Inventory classification. The operator
// must choose the canonical category of EACH physical item before posting.
export function stockIntakeClassification(code){
  if(typeof code!=='string'||!Object.hasOwn(STOCK_INTAKE_CLASSIFICATIONS,code))return null;
  const {inventory_domain,stock_role,inventory_type}=STOCK_INTAKE_CLASSIFICATIONS[code];
  return{inventory_domain,stock_role,inventory_type};
}
const NORMALIZE=value=>String(value??'').trim().toLocaleLowerCase('en-PH').replace(/\s+/g,' ');
const CENTS=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;

// Reject non-decimal CSV and form values before numeric coercion: financial
// evidence must not silently round fractions of a peso or accept exponent/radix
// shorthand. Null means invalid/unverified, never a confirmed zero.
export function parsePhpMoney(value){
  const raw=String(value??'').trim();
  if(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(raw))return null;
  const [whole,fraction='']=raw.split('.');
  const centavos=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')||'0');
  if(centavos<1n||centavos>10000000000n)return null;
  return Number(centavos)/100;
}
export function parseStockQuantity(value){
  const raw=String(value??'').trim();
  if(!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,4})?$/.test(raw))return null;
  const [whole,fraction='']=raw.split('.');
  const tenThousandths=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0')||'0');
  if(tenThousandths<1n||tenThousandths>10000000000n)return null;
  return Number(tenThousandths)/10000;
}
export function validPhilippinePurchaseDate(value,today){
  const date=String(value||''),parts=/^([1-9]\d{3})-(\d{2})-(\d{2})$/.exec(date);
  if(!parts||typeof today!=='string'||date>today)return false;
  const year=Number(parts[1]),month=Number(parts[2]),day=Number(parts[3]);
  const actual=new Date(Date.UTC(year,month-1,day));
  return actual.getUTCFullYear()===year&&actual.getUTCMonth()===month-1&&actual.getUTCDate()===day;
}

export function parseCsvRecords(text){
  const source=String(text||'').replace(/^\uFEFF/,'');
  if(source.length>250000||new TextEncoder().encode(source).byteLength>250000)
    throw new Error('CSV exceeds the 250 KB review limit.');
  const records=[];let field='',fields=[],mode='start';
  const finishField=()=>{fields.push(field);field='';mode='start'};
  const finishRecord=()=>{
    finishField();
    if(fields.some(value=>String(value).trim()))records.push(fields);
    fields=[];
  };
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(mode==='quoted'){
      if(ch==='"'){
        if(source[i+1]==='"'){field+='"';i++}
        else mode='closed';
      }else field+=ch;
      continue;
    }
    if(ch==='"'){
      if(mode!=='start')throw new Error('Invalid CSV quote boundary at character '+(i+1)+'. Review the source before importing.');
      mode='quoted';
    }else if(ch===','){finishField()}
    else if(ch==='\n'||ch==='\r'){
      finishRecord();
      if(ch==='\r'&&source[i+1]==='\n')i++;
    }else{
      if(mode==='closed')throw new Error('Unexpected content after a quoted CSV field at character '+(i+1)+'.');
      mode='unquoted';field+=ch;
    }
  }
  if(mode==='quoted')throw new Error('Unclosed quoted CSV field.');
  if(field||fields.length||mode==='closed')finishRecord();
  return records;
}

// An older File.text() promise cannot replace posted outcomes or a newer CSV.
export function csvReadIsCurrent(ticket,latestTicket,posting){
  return Number.isSafeInteger(ticket)&&ticket===latestTicket&&!posting;
}

// Human confirmation and private paid-stock evidence are scoped to one verified
// account/business identity, not just an identical displayed business name.
export function preserveIntakeReviewForMerchant(state,previous,next){
  const same=Boolean(previous&&next&&
    Number.isSafeInteger(previous.accountId)&&previous.accountId>0&&
    Number.isSafeInteger(previous.businessId)&&previous.businessId>0&&
    previous.accountId===next.accountId&&previous.businessId===next.businessId&&
    previous.businessName===next.businessName);
  if(!same){state.rows=[];state.resultLog=[]}
  return same;
}

// Expired authentication revokes private CSV and expense evidence, even
// when a previously dispatched purchase has not returned yet.
export function revokeMerchantIntakeSession(state){
  state.contextReadRevision++;
  state.csvReadRevision++;
  state.stop=true;
  preserveIntakeReviewForMerchant(state,state.context,null);
  state.context=null;
  state.inventory=[];
  state.transactions=[];
  state.accountId=null;
}
// Human Stop does not invalidate the active request; a changed login does.
export function intakeOperationIsCurrent(state,revision,expectedCsrf,currentCsrf){
  return Number.isSafeInteger(revision)&&revision===state.contextReadRevision&&
    Boolean(state.context)&&typeof expectedCsrf==='string'&&expectedCsrf.length>0&&
    expectedCsrf===currentCsrf;
}

export function parseStockIntakeCsv(text){
  const records=parseCsvRecords(text);
  if(records.length<2)throw new Error('CSV must have a header and at least one product.');
  const headers=records.shift().map(x=>NORMALIZE(x));
  if(new Set(headers).size!==headers.length)throw new Error('Duplicate CSV column name; check the original source before importing.');
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
    const quantity=data.proposed_quantity===''?null:parseStockQuantity(data.proposed_quantity);
    const total=parsePhpMoney(data.screenshot_line_php);
    const expectedProvided=data.recomputed_line_php!==''&&data.recomputed_line_php!==undefined;
    const expected=expectedProvided?parsePhpMoney(data.recomputed_line_php):null;
    const unit=data.proposed_unit||'';
    const flag=data.posting_status||'';
    const paidRaw=data.actual_total_paid_php||'';
    const paidTotal=paidRaw===''?null:parsePhpMoney(paidRaw);
    if(paidRaw!==''&&paidTotal===null){
      throw new Error('Invalid confirmed paid total on CSV line '+(index+2));
    }
    const costMismatch=expected!==null&&total!==null&&Math.abs(expected-total)>0.009;
    const requiresReview=quantity===null||total===null||!SUPPORTED_UNITS.has(unit)||
      (expectedProvided&&expected===null)||costMismatch
      ||/(VERIFY|CONFIRM QTY|CHECK PRICE|REVIEW|UNKNOWN)/i.test(flag);
    return{
      key:String(index+1),item,quantity,unit,total,expected,flag,paidTotal,classificationCode:'',
      note:String(data.review_note||'').slice(0,240),
      requiresReview,reviewConfirmed:false,selected:false,
      exists:null,result:'pending',error:''
    };
  });
}

export function validStockIntakeRow(row){
  return Boolean(row&&stockIntakeClassification(row.classificationCode)&&row.item&&row.item.length<=100&&
    Number.isFinite(row.quantity)&&row.quantity>0&&row.quantity<=1000000&&
    Math.abs(row.quantity*10000-Math.round(row.quantity*10000))<1e-6&&
    SUPPORTED_UNITS.has(row.unit)&&Number.isFinite(row.total)&&
    row.total>0&&row.total<=100000000&&
    Math.abs(row.total*100-Math.round(row.total*100))<1e-6&&
    (!row.requiresReview||row.reviewConfirmed)&&
    !row.exists&&row.result==='pending');
}

export function findExistingInventory(row,inventory){
  const name=NORMALIZE(row?.item);
  return (Array.isArray(inventory)?inventory:[]).find(value=>NORMALIZE(value.item)===name)||null;
}

// A changed physical count, unit, or paid value voids any prior human approval.
// Never carry an old review checkbox or selection onto a different purchase.
export function reviseStockIntakeRow(row,field,raw){
  if(!row||row.result!=='pending'||!['quantity','unit','total','classificationCode'].includes(field))return false;
  const next=field==='quantity'?(raw===''?null:parseStockQuantity(raw)):
    field==='total'?(raw===''?null:parsePhpMoney(raw)):
    field==='classificationCode'?(stockIntakeClassification(raw)?raw:''):String(raw??'');
  if(Object.is(row[field],next))return false;
  const wasClassified=Boolean(stockIntakeClassification(row.classificationCode));
  row[field]=next;
  // Initial choice is explicit human classification; a subsequent change
  // also demands renewed line review and both batch approvals.
  if(field!=='classificationCode'||wasClassified)row.requiresReview=true;
  row.reviewConfirmed=false;
  row.selected=false;
  return true;
}

// Client preflight is not a server-side idempotency or create-only guarantee.
// If one selected item becomes present, STOP the full paid batch; continuing
// the remaining purchases would no longer reconcile to the confirmed total.
// A human-confirmed paid batch is bound to its exact rows. Re-selecting even
// equal-priced items changes the physical and ledger evidence being approved.
export function revokePaidBatchConfirmations(physicalCheckbox,moneyCheckbox){
  physicalCheckbox.checked=false;
  moneyCheckbox.checked=false;
}
export function guardNewPaidStockIntakeRow(row,inventory){
  const existing=findExistingInventory(row,inventory);
  if(!existing)return true;
  row.exists=existing;
  row.selected=false;
  const error=new Error('Selected item appeared in live Inventory after paid-total confirmation. No purchase was submitted for this item. Stop and reconcile the entire Stock and Money batch before any further posting.');
  error.paidBatchConflict=true;
  error.conflictRow=row;
  throw error;
}

// A human approves one complete paid batch. A duplicate in a later selected
// line must stop the batch BEFORE any earlier line is durably posted. This is
// only a preflight safety check; server-side atomicity/idempotency is still
// required to eliminate races with other devices.
export function guardNewPaidStockIntakeBatch(rows,inventory){
  for(const row of rows)guardNewPaidStockIntakeRow(row,inventory);
  return true;
}

const hasDocument=typeof document!=='undefined';
if(hasDocument){
  const $=id=>document.getElementById(id);
  const state={context:null,inventory:[],transactions:[],rows:[],busy:false,stop:false,accountId:null,resultLog:[],csvReadRevision:0,contextReadRevision:0};
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
    let membershipChanged=false;
    state.rows.forEach(row=>{
      const wasExisting=Boolean(row.exists);
      row.exists=findExistingInventory(row,state.inventory);
      if(Boolean(row.exists)!==wasExisting){
        row.selected=false;
        membershipChanged=true;
      }
    });
    if(membershipChanged)revokeBatchConfirmations();
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
  function revokeBatchConfirmations(){
    revokePaidBatchConfirmations($('physicalConfirm'),$('moneyConfirm'));
  }
  function resetIntakeReviewFields(){
    $('csv').value='';
    $('businessName').value='';
    $('actualTotalPaid').value='';
    $('physicalConfirm').checked=false;
    $('moneyConfirm').checked=false;
    message('fileStatus','Select and review a CSV for the verified Merchant business.');
    message('results','No stock or Money changes were made by this review session.');
  }
  function invalidatePrivateReview(){
    revokeMerchantIntakeSession(state);
    resetIntakeReviewFields();
    $('rows').replaceChildren();
    $('reviewPanel').classList.add('hidden');
    $('commitPanel').classList.add('hidden');
    $('businessCheck').classList.add('hidden');
    message('authStatus','Merchant session ended or changed. Sign in again, then reconcile Stock and Money before retrying any interrupted purchase.','error');
    message('ledgerStatus','Merchant identity verification required.');
    updateControls();
  }
  async function refreshContext(){
    if(state.busy)return;
    const previous=state.context;
    const revision=++state.contextReadRevision;
    // Cancel any pending file read before a different session can be shown.
    ++state.csvReadRevision;
    $('refreshContext').disabled=true;
    message('authStatus','Checking Merchant profile, business binding, and live Inventory…');
    message('ledgerStatus','Verifying Merchant identity before showing Money details…');
    // Do not display a previous account's private review while auth is pending.
    $('rows').replaceChildren();
    $('reviewPanel').classList.add('hidden');
    $('commitPanel').classList.add('hidden');
    message('results','Verifying Merchant identity before showing review history…');
    state.context=null;state.inventory=[];state.transactions=[];state.accountId=null;
    try{
      const next=await snapshot();
      const [inventory,transactions]=await Promise.all([
        api('/api/inventory'),api('/api/transactions')
      ]);
      const verify=await snapshot();
      if(revision!==state.contextReadRevision)return;
      if(!sameContext(next,verify))throw new Error('Merchant business changed during Inventory/Money read.');
      if(!preserveIntakeReviewForMerchant(state,previous,verify))resetIntakeReviewFields();
      state.context=verify;state.accountId=verify.accountId;
      state.inventory=Array.isArray(inventory)?inventory:[];
      state.transactions=Array.isArray(transactions)?transactions:[];
      const expenses=state.transactions.filter(tx=>tx.type==='business_expense');
      const total=expenses.reduce((sum,tx)=>sum+Number(tx.amount||0),0);
      message('ledgerStatus','This business already has '+expenses.length+' recent expense entries in Money, totaling ₱'+
        CENTS(total).toFixed(2)+'. Check for any payment that covered these products; this list is not guaranteed to include older entries.');
      refreshExisting();renderRows();renderBusiness();
    }catch(error){
      if(revision!==state.contextReadRevision)return;
      preserveIntakeReviewForMerchant(state,previous,null);
      resetIntakeReviewFields();
      renderRows();
      message('ledgerStatus','Money details unavailable until Merchant verification succeeds.');
      message('authStatus',error.message||'Merchant and Inventory could not be checked.','error');
      $('businessCheck').classList.add('hidden');
    }finally{
      if(revision===state.contextReadRevision){
        $('refreshContext').disabled=false;updateControls();
      }
    }
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
        const opt=document.createElement('option');
        const [key,label]=Array.isArray(choice)?choice:[choice,choice];
        opt.value=key;opt.textContent=label;input.appendChild(opt);
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
      const item=element('article','item'+(row.exists?' existing':'')+(row.requiresReview?' review':'')+(['saved','saved-date-pending'].includes(row.result)?' saved':''));
      const top=element('div','controls');
      const title=element('h3','',row.item);top.appendChild(title);
      const status=row.result==='saved'?'Saved stock and expense':row.result==='saved-date-pending'?'Saved; date needs correction':row.exists?'Already in Inventory':row.result==='uncertain'?'Needs investigation':row.result==='error'?'Stopped':!stockIntakeClassification(row.classificationCode)?'Choose stock category':row.requiresReview?'Review required':'Ready to review';
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
        if(reviseStockIntakeRow(row,'quantity',value))revokeBatchConfirmations();renderRows();
      }));
      columns.appendChild(createField('Unit',row.unit,{choices:['kg','g','L','ml','unit']},value=>{
        if(reviseStockIntakeRow(row,'unit',value))revokeBatchConfirmations();renderRows();
      }));
      columns.appendChild(createField('Value of stock to add (₱)',row.total,{step:'0.01'},value=>{
        if(reviseStockIntakeRow(row,'total',value))revokeBatchConfirmations();renderRows();
      }));
      item.appendChild(columns);
      item.appendChild(createField('Verified Inventory category',row.classificationCode,{
        choices:[['','Choose category (required)'],
          ...Object.entries(STOCK_INTAKE_CLASSIFICATIONS).map(([code,choice])=>[code,choice.label])]
      },value=>{
        if(reviseStockIntakeRow(row,'classificationCode',value))revokeBatchConfirmations();
        renderRows();
      }));
      if(row.requiresReview){
        const label=element('label','check');
        const check=document.createElement('input');check.type='checkbox';
        check.checked=row.reviewConfirmed;check.disabled=state.busy||row.result!=='pending';
        check.addEventListener('change',()=>{row.reviewConfirmed=check.checked;revokeBatchConfirmations();renderRows()});
        label.append(check,element('span','',
          'I verified the unclear amount, pack size or quantity against the actual goods. Accept this corrected value.'));
        item.appendChild(label);
      }
      const select=element('label','check');
      const check=document.createElement('input');check.type='checkbox';check.checked=row.selected;
      check.disabled=state.busy||row.result!=='pending'||Boolean(row.exists);
      check.addEventListener('change',()=>{if(row.selected!==check.checked){row.selected=check.checked;revokeBatchConfirmations()}updateControls()});
      select.append(check,element('span','',row.result==='saved'?'Saved to Merchant Stock and Money':
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
      state.rows.filter(x=>['saved','saved-date-pending'].includes(x.result)).length+' saved this session';
    const date=String($('purchaseDate').value||'');
    const validDate=validPhilippinePurchaseDate(date,localDatePH());
    const validAccount=['cash','gcash','bank','other'].includes($('purchaseAccount').value);
    const selectedPaid=CENTS(selected.reduce((sum,row)=>sum+Number(row.total||0),0));
    const paidText=String($('actualTotalPaid').value||'');
    const parsedPaid=parsePhpMoney(paidText);
    const confirmedPaid=parsedPaid===null?NaN:parsedPaid;
    const totalsMatch=Number.isFinite(confirmedPaid)&&confirmedPaid>0&&
      Math.abs(CENTS(confirmedPaid)-selectedPaid)<0.005;
    message('reconciliation',
      'Selected item costs: ₱'+selectedPaid.toFixed(2)+
      ' · Actual total paid: '+(Number.isFinite(confirmedPaid)&&paidText!==''?'₱'+CENTS(confirmedPaid).toFixed(2):'not entered')+
      ' · Difference: '+(Number.isFinite(confirmedPaid)&&paidText!==''?'₱'+CENTS(selectedPaid-confirmedPaid).toFixed(2):'unknown')+
      (totalsMatch?' · Reconciled':' · NOT RECONCILED'),
      totalsMatch?'ok':selected.length?'error':'');
    $('post').disabled=state.busy||!state.context||!exactlyConfirmedBusiness()||
      !selected.length||selected.length!==valid.length||!validDate||!validAccount||!totalsMatch||
      !$('physicalConfirm').checked||!$('moneyConfirm').checked;
    $('csv').disabled=state.busy;
    $('businessName').disabled=state.busy;
    $('physicalConfirm').disabled=state.busy;
    $('moneyConfirm').disabled=state.busy;
    $('actualTotalPaid').disabled=state.busy;
    $('purchaseAccount').disabled=state.busy;
    $('purchaseDate').disabled=state.busy;
    $('stop').disabled=!state.busy;
    $('selectSafe').disabled=state.busy||!state.rows.length;
    $('clearSelection').disabled=state.busy||!state.rows.length;
  }
  function localDatePH(){
    return new Intl.DateTimeFormat('en-CA',{
      timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'
    }).format(new Date());
  }
  async function readFile(){
    if(state.busy)return;
    const file=$('csv').files?.[0];if(!file)return;
    const ticket=++state.csvReadRevision;
    if(file.size>250000){message('fileStatus','CSV is too large.','error');return}
    try{
      const csvText=await file.text();
      if(!csvReadIsCurrent(ticket,state.csvReadRevision,state.busy))return;
      const parsed=parseStockIntakeCsv(csvText);
      const sourcePaidTotals=[...new Set(parsed.map(row=>row.paidTotal).filter(value=>value!==null))];
      if(sourcePaidTotals.length>1)
        throw new Error('CSV contains different confirmed paid totals. Reconcile the source before importing.');
      state.rows=parsed;state.resultLog=[];
      $('physicalConfirm').checked=false;$('moneyConfirm').checked=false;
      $('actualTotalPaid').value=sourcePaidTotals.length?sourcePaidTotals[0].toFixed(2):'';
      refreshExisting();renderRows();
      message('fileStatus',parsed.length+' rows loaded locally. '+(sourcePaidTotals.length?
        'Source says ₱'+sourcePaidTotals[0].toFixed(2)+' was paid; verify this amount against purchase evidence. ': 
        'Enter the amount actually paid. ')+ 'No server writes have occurred.','ok');
      message('results','No changes made.');
    }catch(error){
      if(!csvReadIsCurrent(ticket,state.csvReadRevision,state.busy))return;
      state.rows=[];renderRows();message('fileStatus',error.message,'error');
    }
  }
  async function assertMerchantContext(){
    const before=await snapshot();
    if(!sameContext(before,state.context)||state.accountId!==before.accountId)
      throw new Error('Active Merchant account or business changed. Import stopped.');
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
    // Invalidate outstanding file reads before the first durable request.
    state.csvReadRevision++;
    state.busy=true;state.stop=false;updateControls();
    const operationRevision=state.contextReadRevision;
    const csrfAtStart=window.ABLSession?.csrfToken?.()||'';
    const stillCurrent=()=>intakeOperationIsCurrent(
      state,operationRevision,csrfAtStart,window.ABLSession?.csrfToken?.()||''
    );
    const requireCurrent=()=>{
      if(stillCurrent())return true;
      if(state.context||state.rows.length||state.resultLog.length)invalidatePrivateReview();
      return false;
    };
    if(!requireCurrent()){state.busy=false;updateControls();return;}
    const originalContext=state.context;
    const paidFrom=$('purchaseAccount').value,originalDate=$('purchaseDate').value;
    const pending=state.rows.filter(row=>row.selected&&validStockIntakeRow(row));
    let saved=0;
    let initialBatchChecked=false;
    for(const row of pending){
      if(state.stop||!requireCurrent())break;
      let purchaseDispatched=false;
      try{
        await assertLiveContext();
        if(!requireCurrent())break;
        if(!sameContext(originalContext,state.context))throw new Error('Merchant context changed.');
        if(!initialBatchChecked){
          // Check ALL approved items before submitting even the first expense.
          guardNewPaidStockIntakeBatch(pending,state.inventory);
          initialBatchChecked=true;
        }
        // Recheck each item as the import progresses (other devices may write).
        guardNewPaidStockIntakeRow(row,state.inventory);
        if(!validStockIntakeRow(row))throw new Error('Stock quantity, unit, category, cost or review confirmation is not valid.');
        const classification=stockIntakeClassification(row.classificationCode);
        if(!classification)throw new Error('Choose and verify the Inventory category before posting.');
        row.result='posting';renderRows();
        // From this point an interrupted response is uncertain; never auto-retry.
        purchaseDispatched=true;
        // Canonical atomic purchase + linked expense. This records an existing payment; no funds transfer occurs.
        const result=await api('/api/inventory/purchase',{method:'POST',body:JSON.stringify({
          item:row.item,...classification,
          purchase_quantity:row.quantity,purchase_unit:row.unit,total_cost:CENTS(row.total),
          account:paidFrom,record_expense:true,
          note:'Paid stock intake from reviewed Merchant CSV. Actual purchase date: '+originalDate+'. '+row.note
        })});
        if(!requireCurrent())break;
        if(!result?.inventory?.id||!result?.purchase?.id||!result?.transaction?.id){
          throw new Error('Purchase/payment response was incomplete; manually reconcile before retry.');
        }
        // At this point the stock and a linked expense exist even if the date correction fails.
        row.result='saved-date-pending';row.selected=false;saved++;
        state.inventory.push(result.inventory);
        const note=row.item+' — stock purchase #'+result.purchase.id+
          ' · linked expense #'+result.transaction.id+' · ₱'+CENTS(row.total).toFixed(2);
        state.resultLog.push(note);
        message('results',saved+' paid item(s) saved; checking historical purchase date.\n'+state.resultLog.join('\n'),'ok');
        renderRows();
        // The canonical accounting route posts NOW. If that is the actual PH business date,
        // retain the real posting timestamp. Only backdate older days (at local noon,
        // an explicitly approximate time) through the existing audited correction API.
        if(originalDate!==localDatePH()){
          await assertMerchantContext();
          if(!requireCurrent())break;
          const dated=await api('/api/transactions/'+result.transaction.id,{
            method:'PATCH',
            body:JSON.stringify({
              occurred_at:originalDate+'T12:00:00+08:00',
              reason:'Merchant confirmed historical PH purchase date; time-of-day is unknown'
            })
          });
          if(!requireCurrent())break;
          if(Number(dated?.id)!==Number(result.transaction.id))
            throw new Error('Linked expense date correction could not be verified.');
        }
        row.result='saved';
        message('results',saved+' purchase(s) and linked expenses dated '+originalDate+'.\n'+state.resultLog.join('\n'),'ok');
        renderRows();
      }catch(error){
        if(!requireCurrent())break;
        // No automatic retry: the server endpoint has no request-key idempotency.
        if(error?.paidBatchConflict){
          const conflictRow=error.conflictRow||row;
          conflictRow.result='error';
          conflictRow.error='NOT POSTED: '+error.message;
          revokeBatchConfirmations();
        }else if(row.result==='saved-date-pending'){
          row.error='STOCK AND EXPENSE ARE SAVED, but the original payment date could not be confirmed: '+
            (error?.message||'Unknown error')+'. Correct expense date in Money; do NOT post the stock purchase again.';
        }else if(!purchaseDispatched){
          // Validation, business recheck or a duplicate stopped BEFORE any POST.
          row.result='error';
          row.error='NOT POSTED: '+(error?.message||'Unknown error')+
            '. No purchase request was sent for this item. Refresh context and re-confirm the paid batch.';
          revokeBatchConfirmations();
        }else{
          row.result='uncertain';row.error='STOPPED: '+(error?.message||'Unknown error')+
            '. The request may have reached production; reconcile both Stock and Money before any retry.';
        }
        state.stop=true;renderRows();
        message('results','Batch STOPPED after '+saved+' saved purchase(s). Review Stock AND Money. Never retry an uncertain purchase until both are reconciled.\n'+state.resultLog.join('\n'),'error');
        break;
      }
    }
    state.busy=false;
    if(!requireCurrent()){updateControls();return;}
    if(!state.stop)message('results',saved+' stock purchase(s) and '+saved+' linked paid business expense(s) saved to the active Merchant, dated '+originalDate+'. No payment was sent.\n'+state.resultLog.join('\n'),'ok');
    renderRows();updateControls();
  }
  document.addEventListener('abl:auth-expired',invalidatePrivateReview);
  window.addEventListener('pagehide',invalidatePrivateReview);
  window.addEventListener('pageshow',event=>{if(event.persisted&&!state.busy)refreshContext()});
  $('refreshContext').addEventListener('click',refreshContext);
  $('csv').addEventListener('change',readFile);
  $('businessName').addEventListener('input',updateControls);
  $('physicalConfirm').addEventListener('change',updateControls);
  $('moneyConfirm').addEventListener('change',updateControls);
  $('purchaseAccount').addEventListener('change',()=>{
    $('moneyConfirm').checked=false;updateControls();
  });
  $('purchaseDate').addEventListener('change',()=>{
    $('moneyConfirm').checked=false;updateControls();
  });
  $('actualTotalPaid').addEventListener('input',()=>{
    $('moneyConfirm').checked=false;updateControls();
  });
  $('purchaseDate').max=localDatePH();
  $('post').addEventListener('click',saveSelected);
  $('stop').addEventListener('click',()=>{state.stop=true;message('results','Stopping after the active purchase request finishes. No next item will be sent.','error')});
  $('selectSafe').addEventListener('click',()=>{
    let changed=false;
    state.rows.forEach(r=>{
      if(!r.selected&&r.result==='pending'&&!r.exists&&!r.requiresReview&&validStockIntakeRow({...r,selected:true})){
        r.selected=true;changed=true;
      }
    });
    if(changed)revokeBatchConfirmations();
    renderRows();
  });
  $('clearSelection').addEventListener('click',()=>{
    let changed=false;
    state.rows.forEach(r=>{if(r.result==='pending'&&r.selected){r.selected=false;changed=true}});
    if(changed)revokeBatchConfirmations();
    renderRows();
  });
  refreshContext();
}
