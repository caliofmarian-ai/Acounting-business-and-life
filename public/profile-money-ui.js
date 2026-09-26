let pmWorkspace=null,pmRole='',pmData=null,pmReversalEntryId=null;
const pmtok=()=>localStorage.getItem('abl_token')||'';
const pmh=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const pmnice=v=>String(v||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const pmmoney=v=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(v)||0);
async function pmapi(path,options={}){const headers={Authorization:'Bearer '+pmtok(),...(options.headers||{})};if(options.body&&!headers['Content-Type'])headers['Content-Type']='application/json';const r=await fetch(path,{...options,headers});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'Request failed ('+r.status+')');return b}
function pmtoast(msg){let t=document.getElementById('roleToast')||document.getElementById('profileMoneyFallbackToast');if(!t){t=document.createElement('div');t.id='profileMoneyFallbackToast';t.className='roleToast';t.setAttribute('role','status');t.setAttribute('aria-live','polite');document.body.appendChild(t)}t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600);return false}
function ensurePmReversalDialog(){
  let backdrop=document.getElementById('profileMoneyReversalBackdrop');
  if(backdrop)return backdrop;
  backdrop=document.createElement('div');
  backdrop.id='profileMoneyReversalBackdrop';
  backdrop.className='moneyReversalBackdrop hidden';
  backdrop.innerHTML='<section class="moneyReversalDialog" role="dialog" aria-modal="true" aria-labelledby="moneyReversalTitle"><header><div><small>ACCOUNTING CORRECTION</small><h2 id="moneyReversalTitle">Reverse this entry?</h2></div><button id="moneyReversalClose" type="button" aria-label="Close">×</button></header><form id="moneyReversalForm"><p>The original entry stays in the audit history. A reversal records the correction instead of deleting history.</p><label>Reason for reversal<textarea id="moneyReversalReason" rows="3" maxlength="700" required placeholder="Explain why this entry is being corrected"></textarea></label><div class="moneyReversalActions"><button id="moneyReversalCancel" type="button">Cancel</button><button id="moneyReversalSubmit" class="danger" type="submit">Reverse entry</button></div><div id="moneyReversalStatus" class="moneyFormStatus" role="status" aria-live="polite"></div></form></section>';
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click',event=>{if(event.target===backdrop)closePmReversalDialog()});
  backdrop.querySelector('#moneyReversalClose').onclick=closePmReversalDialog;
  backdrop.querySelector('#moneyReversalCancel').onclick=closePmReversalDialog;
  backdrop.querySelector('#moneyReversalForm').onsubmit=submitProfileMoneyReversal;
  return backdrop;
}
function closePmReversalDialog(){
  const backdrop=document.getElementById('profileMoneyReversalBackdrop');
  backdrop?.classList.add('hidden');
  pmReversalEntryId=null;
  document.body.style.overflow='';
}
function openPmReversalDialog(id){
  const entryId=Number(id);
  if(!Number.isInteger(entryId)||entryId<=0)return pmtoast('This entry is not available for reversal.');
  const backdrop=ensurePmReversalDialog();
  pmReversalEntryId=entryId;
  const form=backdrop.querySelector('#moneyReversalForm');
  form?.reset();
  const status=backdrop.querySelector('#moneyReversalStatus');if(status)status.textContent='';
  const submit=backdrop.querySelector('#moneyReversalSubmit');if(submit){submit.disabled=false;submit.removeAttribute('aria-busy');submit.textContent='Reverse entry'}
  backdrop.classList.remove('hidden');
  document.body.style.overflow='hidden';
  setTimeout(()=>backdrop.querySelector('#moneyReversalReason')?.focus(),0);
}
async function submitProfileMoneyReversal(event){
  event.preventDefault();
  const id=pmReversalEntryId;
  const backdrop=document.getElementById('profileMoneyReversalBackdrop');
  const reason=String(backdrop?.querySelector('#moneyReversalReason')?.value||'').trim();
  const status=backdrop?.querySelector('#moneyReversalStatus');
  const submit=backdrop?.querySelector('#moneyReversalSubmit');
  if(!id)return closePmReversalDialog();
  if(!reason){if(status)status.textContent='Add a reason before reversing this entry.';return}
  if(submit){submit.disabled=true;submit.setAttribute('aria-busy','true');submit.textContent='Reversing…'}
  const key='profile-money-reverse-'+id+'-'+Date.now();
  try{
    await pmapi('/api/profile-money/'+encodeURIComponent(pmRole)+'/entries/'+id+'/reverse',{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify({note:reason})});
    closePmReversalDialog();
    await reloadProfileMoney();
  }catch(err){
    if(status)status.textContent=err.message||'This entry could not be reversed.';
    if(submit){submit.disabled=false;submit.removeAttribute('aria-busy');submit.textContent='Reverse entry'}
  }
}
function ensurePm(){const shell=document.getElementById('shell');if(!shell)return false;if(!document.getElementById('profileMoneyWorkspace')){pmWorkspace=document.createElement('section');pmWorkspace.id='profileMoneyWorkspace';pmWorkspace.className='profileMoneyWorkspace hidden';shell.querySelector('.topbar')?.insertAdjacentElement('afterend',pmWorkspace)}else pmWorkspace=document.getElementById('profileMoneyWorkspace');return true}
function hidePmBase(){document.querySelectorAll('#shell > .view').forEach(v=>v.classList.add('hidden'));document.querySelector('.bottomNav')?.classList.add('hidden');for(const id of ['roleHub','accountSettingsWorkspace','ordersWorkspace','marketWorkspace','servicesWorkspace','supWorkspace','deliveryWorkspace','profileSettingsWorkspace'])document.getElementById(id)?.classList.add('hidden');for(const id of ['basketBar','orderModalBackdrop','checkoutBackdrop','serviceModalBackdrop','supModalBg','deliveryModalBg'])document.getElementById(id)?.classList.add('hidden')}
function openPmWorkspace(){if(!ensurePm())return false;if(window.BusinessLifeShell?.openFeatureWorkspace?.('profileMoneyWorkspace'))return true;hidePmBase();pmWorkspace.classList.remove('hidden');return true}
function closePm(){closePmReversalDialog();pmWorkspace?.classList.add('hidden');window.BusinessLifeShell?.showActiveWorkspace?.()}
function metric(label,value,detail=''){return '<div class="moneyMetric"><span>'+pmh(label)+'</span><strong>'+pmmoney(value)+'</strong>'+(detail?'<small>'+pmh(detail)+'</small>':'')+'</div>'}
function status(v){const x=String(v||'');return '<span class="moneyStatus '+pmh(x)+'">'+pmh(pmnice(x||'unknown'))+'</span>'}
function budgetSummary(){const rows=pmData?.budgets||[];return '<section class="moneyCard"><h2>Profile budget</h2><p>These amounts are planned allocations for this profile only. They are not bank/e-wallet balances.</p>'+(rows.length?'<div class="moneyList">'+rows.map(b=>'<div class="moneyRow"><div><strong>'+pmh(b.label)+'</strong><small>'+pmh(pmnice(b.purpose))+(b.linked_account_display_name?' • linked to '+pmh(b.linked_account_display_name):'')+'</small><span class="moneyStatus pending">Planning only</span></div><div class="moneyRowAmount"><strong>'+pmmoney(b.allocated_budget)+'</strong><small>allocated budget</small></div></div>').join('')+'</div>':'<div class="moneyEmpty">No budget envelope for this profile yet. Create one in Settings.</div>')+'</section>'}
function ledgerAccountOptions(){const rows=(pmData?.financial_accounts||[]).filter(a=>a.status==='active');return '<option value="">No linked financial account</option>'+rows.map(a=>'<option value="'+a.id+'">'+pmh(a.display_name||pmnice(a.account_kind))+(a.reference_last4?' •••• '+pmh(a.reference_last4):'')+'</option>').join('')}
function ledgerCategoryOptions(){const rows=pmData?.profile_ledger?.capabilities?.categories||[];return rows.map(x=>'<option value="'+pmh(x)+'">'+pmh(pmnice(x))+'</option>').join('')}
function ledgerTypeOptions(){const rows=pmData?.profile_ledger?.capabilities?.entry_types||[];return rows.map(x=>'<option value="'+pmh(x)+'">'+pmh(pmnice(x))+'</option>').join('')}
function ledgerSourceOptions(){
  if(pmRole==='courier'){const rows=pmData?.recent_deliveries||[];return '<option value="">No linked delivery</option>'+rows.map(x=>'<option value="'+x.id+'">'+pmh(x.order_number||('Delivery '+x.id))+' · '+pmh(pmnice(x.status))+'</option>').join('')}
  if(pmRole==='service_provider'){const rows=pmData?.recent_jobs||[];return '<option value="">No linked job</option>'+rows.map(x=>'<option value="'+x.id+'">'+pmh(x.service_label||('Job '+x.id))+' · '+pmh(pmnice(x.status))+'</option>').join('')}
  return '';
}
function ledgerEntryRows(){const rows=pmData?.profile_ledger?.entries||[];return rows.length?'<div class="moneyList moneyLedgerList">'+rows.slice(0,30).map(x=>'<div class="moneyRow"><div><strong>'+pmh(pmnice(x.category))+' · '+pmh(pmnice(x.entry_type))+'</strong><small>'+new Date(x.occurred_at).toLocaleDateString()+(x.financial_account_name?' • '+pmh(x.financial_account_name):'')+(x.source_type!=='manual'?' • '+pmh(pmnice(x.source_type))+' #'+pmh(x.source_id):'')+'</small>'+status(x.status)+(x.note?'<small>'+pmh(x.note)+'</small>':'')+'</div><div class="moneyRowAmount"><strong class="'+(x.direction==='out'?'moneyOut':'moneyIn')+'">'+(x.direction==='out'?'−':'+')+pmmoney(x.amount)+'</strong>'+(x.status==='active'&&x.entry_type!=='reversal'?'<button class="moneyReverse" type="button" data-money-reverse="'+x.id+'">Reverse</button>':'')+'</div></div>').join('')+'</div>':'<div class="moneyEmpty">No manual/profile money entries yet.</div>'}
function profileLedgerSection(){
  const l=pmData?.profile_ledger||{},s=l.summary||{},cap=l.capabilities||{};
  const sourceField=pmRole==='courier'?'<label>Related delivery<select id="profileMoneySource">'+ledgerSourceOptions()+'</select></label>':pmRole==='service_provider'?'<label>Related job<select id="profileMoneySource">'+ledgerSourceOptions()+'</select></label>':'';
  const intro=pmRole==='customer'
    ?'Optional personal cash-flow entries. Marketplace purchases/refunds stay sourced from platform payments and are not duplicated here.'
    :pmRole==='courier'
      ?'Record work expenses such as fuel or maintenance. Courier earnings cannot be typed here; earnings require courier_net evidence.'
      :'Record job-related expenses such as materials or travel. Service income cannot be typed here; income requires payment/settlement evidence.';
  return '<section class="moneyCard moneyLedgerCard"><h2>'+pmh(pmRole==='customer'?'Personal cash flow':pmRole==='courier'?'Courier work expenses':'Service work expenses')+'</h2><p>'+pmh(intro)+'</p>'
    +'<div class="moneyMetrics">'+(pmRole==='customer'?metric('Recorded money in',s.recorded_money_in||0,'Optional personal entries'):'')+metric('Recorded money out',s.recorded_money_out||0,'Manual/profile entries')+metric('Recorded net',s.recorded_net||0,'Not provider cash balance')+'</div>'
    +'<div class="moneyNotice"><strong>Recorded cash flow ≠ provider balance</strong><br>These entries do not change a bank, e-wallet or PayMongo Wallet balance.</div>'
    +'<form id="profileMoneyEntryForm" class="moneyEntryForm"><div class="moneyFormGrid"><label>Type<select id="profileMoneyEntryType">'+ledgerTypeOptions()+'</select></label><label>Direction<select id="profileMoneyDirection"><option value="out">Money out</option><option value="in">Money in</option></select></label><label>Category<select id="profileMoneyCategory">'+ledgerCategoryOptions()+'</select></label><label>Amount<input id="profileMoneyAmount" type="number" min="0.01" step="0.01" required></label><label>Financial account<select id="profileMoneyAccount">'+ledgerAccountOptions()+'</select></label>'+sourceField+'</div><label>Note<input id="profileMoneyNote" maxlength="700" placeholder="What was this for?"></label><label>Evidence/reference (optional)<input id="profileMoneyEvidence" maxlength="500" placeholder="Receipt/reference note"></label><button class="moneySettingsButton" type="submit">Add entry</button><div id="profileMoneyEntryStatus" class="moneyFormStatus"></div></form>'
    +'<div class="moneySectionLabel"><strong>Recorded entries</strong><span>'+pmh(cap.canonical_income_rule||'')+'</span></div>'+ledgerEntryRows()+'</section>';
}
function syncProfileMoneyForm(){
  const type=document.getElementById('profileMoneyEntryType'),direction=document.getElementById('profileMoneyDirection');
  if(!type||!direction)return;
  if(type.value==='money_in'){direction.value='in';direction.disabled=true}
  else if(type.value==='expense'){direction.value='out';direction.disabled=true}
  else direction.disabled=false;
}
async function reloadProfileMoney(){pmData=await pmapi('/api/profile-money/'+encodeURIComponent(pmRole));renderPm()}
async function saveProfileMoneyEntry(e){
  e.preventDefault();const out=document.getElementById('profileMoneyEntryStatus');out.textContent='Saving…';
  const source=document.getElementById('profileMoneySource'),sourceId=source?.value||null;
  const payload={entry_type:document.getElementById('profileMoneyEntryType').value,direction:document.getElementById('profileMoneyDirection').value,category:document.getElementById('profileMoneyCategory').value,amount:Number(document.getElementById('profileMoneyAmount').value),currency_code:'PHP',financial_account_id:document.getElementById('profileMoneyAccount').value||null,source_type:sourceId?(pmRole==='courier'?'delivery':'service_job'):'manual',source_id:sourceId,note:document.getElementById('profileMoneyNote').value,evidence_reference:document.getElementById('profileMoneyEvidence').value};
  const key='profile-money-'+Date.now()+'-'+Math.random().toString(16).slice(2);
  try{await pmapi('/api/profile-money/'+encodeURIComponent(pmRole)+'/entries',{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(payload)});await reloadProfileMoney()}catch(err){out.textContent=err.message}
}
function reverseProfileMoneyEntry(id){openPmReversalDialog(id)}
function bindProfileLedger(){
  const form=document.getElementById('profileMoneyEntryForm');if(form)form.onsubmit=saveProfileMoneyEntry;
  const type=document.getElementById('profileMoneyEntryType');if(type){type.onchange=syncProfileMoneyForm;syncProfileMoneyForm()}
  document.querySelectorAll('[data-money-reverse]').forEach(btn=>btn.onclick=()=>reverseProfileMoneyEntry(btn.dataset.moneyReverse));
}
function financialDestinations(){const rows=pmData?.account_money?.destinations||[],methods=pmData?.account_money?.saved_payment_methods||[],legacy=pmData?.legacy_profile_financial_accounts||[];return '<section class="moneyCard"><h2>Money & Banking</h2><p>External banking and saved payment methods belong to your Avatar/Account and are shared across your profiles. This profile keeps only its own internal Balance and activity.</p>'+(rows.length?'<div class="moneyList">'+rows.filter(a=>a.status==='active').map(a=>'<div class="moneyRow"><div><strong>'+pmh(a.display_name||pmnice(a.destination_kind))+'</strong><small>'+pmh(a.institution_name||a.provider_code||pmnice(a.destination_kind))+(a.reference_last4?' •••• '+pmh(a.reference_last4):'')+'</small>'+status(a.verification_status)+'</div><div class="moneyRowAmount"><small>'+(a.is_default_payout?'Default payout · ':'')+(a.can_payout?'Withdraw ':'')+(a.can_receive?'Receive':'')+'</small></div></div>').join('')+'</div>':'<div class="moneyEmpty">No account-level payout destination configured yet.</div>')+(methods.length?'<div class="moneySectionLabel"><strong>Saved payment methods</strong><span>Provider-tokenized only</span></div><div class="moneyList">'+methods.filter(m=>m.status==='active').map(m=>'<div class="moneyRow"><div><strong>'+pmh(m.display_label||m.brand||pmnice(m.method_kind))+'</strong><small>'+pmh(m.provider_code||'Provider token')+(m.last4?' •••• '+pmh(m.last4):'')+'</small>'+status(m.verification_status)+'</div><div class="moneyRowAmount"><small>'+(m.is_default?'Default':'Saved')+'</small></div></div>').join('')+'</div>':'')+(legacy.length?'<div class="moneyNotice"><strong>Legacy profile destination preserved</strong><br>Old per-profile banking references remain for history, but new Money & Banking setup is account-level.</div>':'')+'<button id="moneyOpenSettings" class="moneySettingsButton" type="button">Open Money & Banking</button></section>'}
function customerSimpleBanking(){
  const methods=pmData?.account_money?.saved_payment_methods||[];
  return '<section class="moneyCard moneySimpleBanking"><h2>How you pay</h2><p>Choose Cash or an available online method at checkout. You do not need a business ledger or payout setup to shop.</p>'
    +(methods.length?'<div class="moneyList">'+methods.filter(x=>x.status==='active').map(m=>'<div class="moneyRow"><div><strong>'+pmh(m.display_label||m.brand||pmnice(m.method_kind))+'</strong><small>'+pmh(m.provider_code||'Secure provider')+(m.last4?' •••• '+pmh(m.last4):'')+'</small></div><div class="moneyRowAmount"><small>'+(m.is_default?'Default':'Saved')+'</small></div></div>').join('')+'</div>':'<div class="moneyEmpty">No saved payment method. You can still use Cash or available online checkout methods.</div>')
    +'<button id="moneyOpenSettings" class="moneySettingsButton" type="button">Payment settings</button></section>';
}
function customerOptionalTracking(){return '<details class="moneyAdvanced"><summary>Optional personal money tracking</summary><div class="moneyAdvancedBody">'+profileLedgerSection()+'</div></details>'}
function renderCustomer(){
  const s=pmData.summary||{};
  return '<section class="moneyHero moneyHeroCustomer"><small>MY MONEY</small><h2>Purchases and payments.</h2><p>Personal purchase activity only — no business accounting. Only what you bought, what you paid, what is still due and what was refunded.</p></section>'
    +'<div class="moneyMetrics moneyMetricsPrimary">'+metric('Confirmed payments',s.confirmed_payments,'Paid successfully')+metric('Outstanding purchases',s.outstanding_purchases,'Still due')+metric('Refunded',s.refunded,'Completed refunds')+metric('Purchases',s.purchase_value,(s.order_count||0)+' orders')+'</div>'
    +(Number(s.pending_payments||0)>0||Number(s.pending_refunds||0)>0?'<section class="moneyCard"><h2>In progress</h2><div class="moneyMetrics">'+metric('Pending payment',s.pending_payments)+metric('Pending refund',s.pending_refunds)+'</div></section>':'')
    +customerOrders()+customerPayments()+customerSimpleBanking()+customerOptionalTracking();
}
function customerOrders(){const rows=pmData.recent_orders||[];return '<section class="moneyCard"><h2>Recent purchases</h2><p>Order value and outstanding amount are kept separate from confirmed payments.</p>'+(rows.length?'<div class="moneyList">'+rows.map(o=>'<div class="moneyRow"><div><strong>'+pmh(o.order_number||('Order '+o.id))+' • '+pmh(o.business_name||'Merchant')+'</strong><small>'+new Date(o.created_at).toLocaleDateString()+' • '+pmh(pmnice(o.payment_method))+'</small>'+status(o.payment_status)+'</div><div class="moneyRowAmount"><strong>'+pmmoney(o.total)+'</strong><small>'+pmmoney(o.outstanding_amount)+' due</small></div></div>').join('')+'</div>':'<div class="moneyEmpty">No purchases yet.</div>')+'</section>'}
function customerPayments(){const rows=pmData.recent_payments||[];return '<section class="moneyCard"><h2>Payment activity</h2>'+(rows.length?'<div class="moneyList">'+rows.map(p=>'<div class="moneyRow"><div><strong>'+pmh(pmnice(p.logical_method))+'</strong><small>'+pmh(p.provider_code||'No provider')+' • '+new Date(p.created_at).toLocaleDateString()+'</small>'+status(p.status)+'</div><div class="moneyRowAmount"><strong>'+pmmoney(p.amount)+'</strong></div></div>').join('')+'</div>':'<div class="moneyEmpty">No payment intents recorded yet.</div>')+'</section>'}
function settlementBlock(title,data,note){const tracked=Boolean(data?.tracked);return '<section class="moneyCard"><h2>'+pmh(title)+'</h2><div class="moneyNotice '+(tracked?'ok':'')+'"><strong>'+(tracked?'Settlement tracking is active':'Settlement amount is not configured yet')+'</strong><br>'+pmh(note||'')+'</div>'+(tracked?'<div class="moneyMetrics">'+metric('Paid',data.paid)+metric('Eligible',data.eligible)+metric('Pending',data.pending)+metric('Processing',data.processing)+'</div>':'')+'</section>'}
function courierTrackedGross(e={}){return ['pending','eligible','held','processing','paid','failed'].reduce((sum,key)=>sum+Number(e[key]||0),0)}
function courierPayoutHistory(){const rows=pmData.payout_history||[];return '<section class="moneyCard"><h2>Payout history</h2><p>Payout and withdrawal state is separate from Customer delivery charges. Only provider-confirmed execution may be shown as succeeded.</p>'+(rows.length?'<div class="moneyList">'+rows.map(x=>'<div class="moneyRow"><div><strong>'+pmh(pmnice(x.movement_type))+' · '+pmh(x.destination_account_name||'Payout destination')+'</strong><small>'+new Date(x.created_at).toLocaleDateString()+(x.provider_code?' • '+pmh(x.provider_code):'')+(x.provider_reference?' • '+pmh(x.provider_reference):'')+'</small>'+status(x.status)+(x.hold_code?'<small>'+pmh(pmnice(x.hold_code))+'</small>':'')+'</div><div class="moneyRowAmount"><strong>'+pmmoney(x.amount)+'</strong><small>'+(x.status==='succeeded'?'Provider-confirmed':'Provider execution not confirmed')+'</small></div></div>').join('')+'</div>':'<div class="moneyEmpty">No payout or withdrawal requests yet. Configure a payout destination in Money & Banking when needed.</div>')+'</section>'}
function renderCourier(){
  const s=pmData.summary||{},e=s.earnings||{},ledger=pmData?.profile_ledger?.summary||{};
  const gross=e.tracked?courierTrackedGross(e):null,expenses=Number(ledger.recorded_money_out||0),net=gross==null?null:gross-expenses;
  const earningsMetric=e.tracked?metric('Gross compensation',gross,'Recorded courier_net allocations'):'<div class="moneyMetric"><span>Recorded earnings</span><strong>Not tracked</strong><small>No courier_net allocation yet</small></div>';
  const settlementMetric=e.tracked?metric('Paid settlement',e.paid,'Recorded paid courier_net'):'<div class="moneyMetric"><span>Paid settlement</span><strong>Not tracked</strong><small>No payout evidence assumed</small></div>';
  const netMetric=net==null?'<div class="moneyMetric"><span>Net after recorded expenses</span><strong>Unavailable</strong><small>Requires Courier compensation evidence</small></div>':metric('Net after recorded expenses',net,'Recorded compensation minus recorded work expenses — not provider balance');
  return '<section class="moneyHero"><small>DELIVERY MONEY</small><h2>Compensation, work costs and payout evidence.</h2><p>The customer delivery fee is not automatically your Courier earnings. Courier income exists only when courier_net allocation evidence exists.</p></section>'
    +'<div class="moneyMetrics moneyMetricsPrimary">'+earningsMetric+settlementMetric+metric('Work expenses',expenses,'Fuel, maintenance, parking/toll and other recorded Courier costs')+netMetric+'</div>'
    +'<section class="moneyCard"><h2>Delivery activity context</h2><div class="moneyMetrics"><div class="moneyMetric"><span>Delivered jobs</span><strong>'+Number(s.delivered_count||0)+'</strong><small>Completed deliveries</small></div><div class="moneyMetric"><span>Active deliveries</span><strong>'+Number(s.active_count||0)+'</strong><small>Current work</small></div>'+metric('Delivery fee context',s.customer_delivery_fees_context,'Customer charges — not earnings')+'</div></section>'
    +settlementBlock('Courier settlement',e,pmData.authority?.note)+courierRows()+courierPayoutHistory()+profileLedgerSection()+budgetSummary()+financialDestinations();
}
function courierRows(){const rows=pmData.recent_deliveries||[];return '<section class="moneyCard"><h2>Delivery activity</h2><p>Customer delivery charge and Courier compensation remain separate on every delivery.</p>'+(rows.length?'<div class="moneyList">'+rows.map(d=>{const tracked=Number(d.courier_allocation_count||0)>0,comp=Number(d.courier_compensation||0),bits=[];if(tracked){if(Number(d.courier_paid||0)>0)bits.push('Paid '+pmmoney(d.courier_paid));if(Number(d.courier_eligible||0)>0)bits.push('Eligible '+pmmoney(d.courier_eligible));if(Number(d.courier_pending||0)>0)bits.push('Pending '+pmmoney(d.courier_pending));if(Number(d.courier_processing||0)>0)bits.push('Processing '+pmmoney(d.courier_processing));if(Number(d.courier_held||0)>0)bits.push('Held '+pmmoney(d.courier_held));if(Number(d.courier_failed||0)>0)bits.push('Failed '+pmmoney(d.courier_failed))}return '<div class="moneyRow"><div><strong>'+pmh(d.order_number||('Delivery '+d.id))+' • '+pmh(d.business_name||'Merchant')+'</strong><small>'+Number(d.route_distance_km||0).toFixed(1)+' km'+(d.delivered_at?' • '+new Date(d.delivered_at).toLocaleDateString():'')+'</small><small>Customer delivery charge '+pmmoney(d.delivery_fee)+' · context only</small>'+status(d.status)+'</div><div class="moneyRowAmount"><strong>'+(tracked?pmmoney(comp):'Not tracked')+'</strong><small>'+(tracked?'courier_net'+(bits.length?' · '+bits.join(' · '):''):'No courier_net evidence')+'</small></div></div>'}).join('')+'</div>':'<div class="moneyEmpty">No Courier deliveries recorded yet.</div>')+'</section>'}
function renderServices(){const s=pmData.summary||{},payments=s.payments||{},income=s.income||{},ledger=pmData?.profile_ledger?.summary||{};return '<section class="moneyHero"><small>LOCAL SERVICES MONEY</small><h2>Jobs, Customer payments and settlement are separate facts.</h2><p>Customer payment evidence comes from verified Payment Intents. Service Provider payout remains a separate settlement state.</p></section><div class="moneyMetrics moneyMetricsPrimary">'+metric('Completed job value',s.confirmed_job_value,(s.confirmed_completed_count||0)+' Customer-confirmed jobs')+metric('Customer paid',payments.confirmed_customer_payments||0,(payments.paid_job_count||0)+' jobs with payment evidence')+metric('Still to collect',payments.outstanding_receivables||0,(payments.receivable_job_count||0)+' unpaid / partially paid jobs')+metric('Work expenses',ledger.recorded_money_out||0,'Recorded Service work expenses')+'</div>'+(Number(payments.pending_customer_payments||0)>0||Number(payments.refunded_customer_payments||0)>0?'<section class="moneyCard"><h2>Payment context</h2><div class="moneyMetrics">'+metric('Pending Customer payment',payments.pending_customer_payments||0)+metric('Refunded to Customer',payments.refunded_customer_payments||0)+metric('Open work value',s.open_commercial_value,(s.open_commercial_jobs||0)+' quoted/active jobs')+'</div></section>':'<section class="moneyCard"><h2>Open work</h2><div class="moneyMetrics">'+metric('Open work value',s.open_commercial_value,(s.open_commercial_jobs||0)+' quoted/active jobs')+'</div></section>')+settlementBlock('Service Provider settlement',income,pmData.authority?.note)+serviceRows()+profileLedgerSection()+budgetSummary()+financialDestinations()}
function serviceRows(){const rows=pmData.recent_jobs||[];return '<section class="moneyCard"><h2>Recent jobs and receivables</h2>'+(rows.length?'<div class="moneyList">'+rows.map(j=>{const paid=Number(j.payment_received||0),due=Number(j.outstanding_receivable||0),refunded=Number(j.payment_refunded||0),pending=Number(j.payment_pending||0);const paymentBits=[];if(paid>0)paymentBits.push('Paid '+pmmoney(paid));if(due>0&&j.status==='completed'&&j.customer_confirmed_at)paymentBits.push('Due '+pmmoney(due));if(pending>0)paymentBits.push('Pending '+pmmoney(pending));if(refunded>0)paymentBits.push('Refunded '+pmmoney(refunded));return '<div class="moneyRow"><div><strong>'+pmh(j.service_label||('Job '+j.id))+'</strong><small>'+new Date(j.created_at).toLocaleDateString()+(j.customer_confirmed_at?' • customer confirmed':'')+'</small>'+status(j.status)+(paymentBits.length?'<small>'+paymentBits.join(' • ')+'</small>':'')+'</div><div class="moneyRowAmount"><strong>'+pmmoney(j.final_price??j.quote_amount??0)+'</strong><small>'+(j.final_price!=null?'final price':j.quote_amount!=null?'quoted value':'no price yet')+'</small></div></div>'}).join('')+'</div>':'<div class="moneyEmpty">No service jobs recorded yet.</div>')+'</section>'}
function openPmSettings(){
  const shell=window.BusinessLifeShell;
  if(typeof shell?.openProfileSettings==='function')return shell.openProfileSettings(pmRole);
  return pmtoast('Profile Settings is still loading. Try again in a moment.');
}
function renderPm(){if(!pmData)return;const title=pmRole==='customer'?'My Money':pmRole==='courier'?'Earnings & Money':'Money';pmWorkspace.innerHTML='<div class="moneyHeader"><button id="moneyBack" class="moneyBack" type="button">‹</button><div><h1>'+title+'</h1><p>'+pmh(pmRole==='customer'?'Personal payments and purchases':pmRole==='courier'?'Courier settlement and activity':'Service-job value and settlement')+'</p></div></div>'+(pmRole==='customer'?renderCustomer():pmRole==='courier'?renderCourier():renderServices());document.getElementById('moneyBack').onclick=closePm;document.getElementById('moneyOpenSettings')?.addEventListener('click',openPmSettings);bindProfileLedger()}
async function openPm(role){pmRole=role;if(!pmtok()||!openPmWorkspace())return;pmWorkspace.innerHTML='<div class="moneyEmpty">Loading Money…</div>';try{pmData=await pmapi('/api/profile-money/'+encodeURIComponent(role));renderPm()}catch(e){pmWorkspace.innerHTML='<div class="moneyHeader"><button id="moneyBack" class="moneyBack" type="button">‹</button><div><h1>Money</h1></div></div><div class="moneyEmpty">'+pmh(e.message)+'</div>';document.getElementById('moneyBack').onclick=closePm}}
function decorateMoney(detail){const state=detail?.snapshot?detail:window.BusinessLifeProfileState,role=state?.surface==='profile'?state.activeRole:null,hub=document.getElementById('roleHub');if(!hub||!['customer','courier','service_provider'].includes(role))return;const tile=hub.querySelector('[data-hub-feature="Money"]');if(tile)tile.onclick=()=>openPm(role)}
window.BusinessLifeProfileMoney=Object.freeze({openCustomerMoney:()=>openPm('customer'),openProfileMoney:openPm});
function bootPm(){ensurePm();document.addEventListener('abl:profile-state',e=>decorateMoney(e.detail),{passive:true});decorateMoney(window.BusinessLifeProfileState)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootPm,{once:true});else bootPm();
