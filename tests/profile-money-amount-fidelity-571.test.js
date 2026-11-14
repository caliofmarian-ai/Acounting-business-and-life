// #571 + #871: run the shipped manual-ledger form with a controlled transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/profile-money-ui.js',import.meta.url),'utf8');
function between(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing actual Profile Money code');
  return source.slice(a,b);
}
const actualCode=between('function pmExactPesoAmount(id){','\nasync function pmapi(')
  +'\n'+between('async function saveProfileMoneyEntry(e){','\nfunction reverseProfileMoneyEntry(');
function harness(role='customer'){
  const elements=new Map(),calls=[],reloads=[];
  const defaults={
    profileMoneyEntryType:'expense',profileMoneyDirection:'out',
    profileMoneyCategory:'other',profileMoneyAccount:'7',
    profileMoneySource:'',profileMoneyNote:'Synthetic note',profileMoneyEvidence:'Ref'
  };
  const el=id=>{
    if(!elements.has(id))elements.set(id,{value:defaults[id]||'',textContent:''});
    return elements.get(id);
  };
  const context=vm.createContext({
    document:{getElementById:el},
    Date,Math,pmRole:role,
    pmapi:async(path,options)=>{calls.push({path,options,payload:JSON.parse(options.body)});return {id:1}},
    reloadProfileMoney:async()=>{reloads.push(1)}
  });
  vm.runInContext(actualCode,context);
  return{el,calls,reloads,run:()=>vm.runInContext('saveProfileMoneyEntry({preventDefault(){}})',context)};
}
test('malformed, coerced and sub-cent manual money values cannot reach the API',async()=>{
  for(const role of ['customer','courier','service_provider']){
    for(const amount of ['1e3','0x10','0.005','1.234','0','-1','1,000','1.0000000000000001','1000000000000','Infinity','NaN']){
      const h=harness(role);h.el('profileMoneyAmount').value=amount;
      await h.run();
      assert.equal(h.calls.length,0,role+' posted invalid '+amount);
      assert.equal(h.reloads.length,0);
      assert.match(h.el('profileMoneyEntryStatus').textContent,/PHP amount|positive PHP amount/);
    }
  }
});
test('valid PHP decimal text remains exact with source and idempotency semantics intact',async()=>{
  for(const role of ['customer','courier','service_provider']){
    for(const amount of ['0.01','1.23','123.40','999999999999.99','001.20']){
      const h=harness(role);h.el('profileMoneyAmount').value=amount;
      await h.run();
      assert.equal(h.calls.length,1);
      const {path,options,payload}=h.calls[0];
      assert.equal(path,'/api/profile-money/'+role+'/entries');
      assert.equal(options.method,'POST');
      assert.match(options.headers['Idempotency-Key'],/^profile-money-/);
      assert.equal(payload.amount,amount,'must preserve typed precision and trailing zeros');
      assert.equal(typeof payload.amount,'string');
      assert.equal(payload.currency_code,'PHP');
      assert.equal(payload.entry_type,'expense');
      assert.equal(payload.source_type,'manual');
      assert.equal(payload.financial_account_id,'7');
      assert.equal(h.reloads.length,1);
    }
  }
});
test('authorized linked source keeps its original delivery/service-job classification',async()=>{
  for(const [role,expected]of [['courier','delivery'],['service_provider','service_job']]){
    const h=harness(role);
    h.el('profileMoneyAmount').value=' 10.50 ';
    h.el('profileMoneySource').value='204';
    await h.run();
    assert.equal(h.calls[0].payload.amount,'10.50');
    assert.equal(h.calls[0].payload.source_type,expected);
    assert.equal(h.calls[0].payload.source_id,'204');
    assert.equal(h.calls[0].payload.note,'Synthetic note');
    assert.equal(h.calls[0].payload.evidence_reference,'Ref');
  }
});
test('actual form source never coerces money before validation',()=>{
  assert.match(source,/function pmExactPesoAmount\(id\)/);
  assert.match(actualCode,/amount:pmExactPesoAmount\('profileMoneyAmount'\)/);
  assert.doesNotMatch(actualCode,/amount:Number\(document\.getElementById\('profileMoneyAmount'\)/);
});
