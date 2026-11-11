// #812 + #871: execute actual Settings form handlers with a synthetic DOM/transport.
// This guards typed-text fidelity without authorizing any provider or ledger write.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/profile-settings-ui.js',import.meta.url),'utf8');
function section(start,end){
  const first=source.indexOf(start);
  const last=source.indexOf(end,first+start.length);
  assert.ok(first>=0&&last>first,'Missing actual Settings code boundary: '+start);
  return source.slice(first,last);
}
function singleLineFunction(name){
  const line=source.split('\n').find(line=>line.startsWith('async function '+name+'('));
  assert.ok(line,'Missing actual Settings handler: '+name);
  return line;
}
const names=['saveProfileFundTransfer','saveBudgetAllocation','saveBudgetTransfer','saveMoneyMovement'];
const sourceUnderTest=[
  section('function settingsExactPesoAmount(id){','\nasync function saveProfileFundTransfer(e){'),
  section('async function saveProfileFundTransfer(e){','\nfunction moneyMovementForm()'),
  ...names.slice(1).map(singleLineFunction)
].join('\n');

const config=[
  ['saveProfileFundTransfer','profileFundAmount','profileFundStatus','/api/settings/profile-fund-transfers'],
  ['saveBudgetAllocation','budgetAdjustAmount','budgetAdjustStatus','/api/settings/budgets/42/entries'],
  ['saveBudgetTransfer','budgetTransferAmount','budgetTransferStatus','/api/settings/budget-transfers'],
  ['saveMoneyMovement','movementAmount','movementStatus','/api/settings/money-movements']
];
function harness(){
  const elements=new Map(),writes=[],refreshes=[];
  const defaults={
    profileFundFrom:'merchant|42',profileFundTo:'customer|0',
    budgetAdjustEnvelope:'42',budgetAdjustDirection:'credit',
    budgetTransferFrom:'42',budgetTransferTo:'43',
    movementType:'transfer',movementSource:'11',movementDestination:'12'
  };
  const el=id=>{
    if(!elements.has(id))elements.set(id,{value:defaults[id]||'',textContent:'',checked:false});
    return elements.get(id);
  };
  const context=vm.createContext({
    document:{getElementById:el},Date,Math,
    fundScopeFromKey:key=>key==='merchant|42'
      ?{profile_role:'merchant',business_id:42,currency_code:'PHP'}
      :{profile_role:'customer',business_id:null,currency_code:'PHP'},
    sapi:async(path,options)=>{
      writes.push({path,options,payload:JSON.parse(options.body)});
      return {provider_money_moved:false,execution_status:'HOLD'};
    },
    stoast:()=>{},refreshSettings:async()=>{refreshes.push(true)},
    settingsStaleError:()=>false
  });
  vm.runInContext(sourceUnderTest,context);
  return {el,writes,refreshes,run:name=>vm.runInContext(name+'({preventDefault(){}})',context)};
}
test('all four forms reject original malformed or rounded amounts before network requests',async()=>{
  const invalid=['1e3','0x10','0.005','1.234','0','-1','1,000','1.0000000000000001','1000000000000','NaN','Infinity'];
  for(const[name,input,status,path]of config){
    for(const raw of invalid){
      const h=harness();h.el(input).value=raw;
      await h.run(name);
      assert.equal(h.writes.length,0,name+' accepted '+raw);
      assert.equal(h.refreshes.length,0,name+' refreshed after invalid '+raw);
      assert.match(h.el(status).textContent,/PHP amount|positive PHP amount/,name+' error for '+raw);
    }
  }
});
test('all four Settings forms transmit exact valid decimal strings, not Number coercions',async()=>{
  const valid=['0.01','1.23','123.40','999999999999.99','001.20'];
  for(const[name,input,status,path]of config){
    for(const raw of valid){
      const h=harness();h.el(input).value=raw;
      await h.run(name);
      assert.equal(h.writes.length,1,name+' should submit once for '+raw);
      assert.equal(h.writes[0].path,path);
      assert.equal(h.writes[0].payload.amount,raw,name+' must retain decimal text');
      assert.equal(typeof h.writes[0].payload.amount,'string');
      assert.equal(h.refreshes.length,1);
      assert.doesNotMatch(h.el(status).textContent,/positive PHP amount/);
    }
  }
});
test('input text is trimmed but forbidden syntax is never silently converted',async()=>{
  const h=harness();h.el('movementAmount').value=' 12.50 ';
  await h.run('saveMoneyMovement');
  assert.equal(h.writes[0].payload.amount,'12.50');
  assert.equal(h.writes[0].payload.currency_code,'PHP');
  assert.equal(h.writes[0].payload.movement_type,'transfer');
  assert.equal(h.writes[0].options.method,'POST');
  assert.match(h.writes[0].options.headers['Idempotency-Key'],/^money-move-/);
  assert.equal(h.writes[0].payload.source_financial_account_id,'11');
  assert.equal(h.writes[0].payload.destination_financial_account_id,'12');
});
test('source preserves distinct Settings authority contexts and no cash/provider execution',()=>{
  assert.match(source,/function settingsAuthority\(/);
  assert.match(source,/function settingsAuthorityMatches\(/);
  assert.match(source,/function settingsExactPesoAmount\(id\)/);
  assert.doesNotMatch(sourceUnderTest,/amount:Number\(document\.getElementById\('(profileFundAmount|budgetAdjustAmount|budgetTransferAmount|movementAmount)'\)/);
  for(const [,input]of config)assert.match(sourceUnderTest,new RegExp('settingsExactPesoAmount\\(\\\''+input+'\\\'\\)'));
});
