// #856/#883 — execute the literal Merchant purchase-document save controller with a
// minimal browser-form harness. All API calls are synthetic and have no live side effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/purchase-documents-ui.js',import.meta.url),'utf8');
const start=source.indexOf('  async function save(event){');
const end=source.indexOf('\n  function close(',start);
assert.ok(start>=0&&end>start,'literal shipped save controller must be present');
const saveSource=source.slice(start,end);
const closeStart=source.indexOf('  function close(',end);
const closeEnd=source.indexOf('\n  async function open(){',closeStart);
assert.ok(closeStart>=0&&closeEnd>closeStart,'literal shipped close controller must be present');
const closeSource=source.slice(closeStart,closeEnd);

function makeController(){
  const fields={document_kind:'purchase_receipt',issuer_name:'Market',issue_date:'2026-11-06',
    document_number:'',gross_amount:'30.00',note:''};
  const button={disabled:false};
  const form={elements:{issue_date:{value:''}},reset(){}};
  const receiptLabel={textContent:''};
  let selectedLinks=[];
  const panel={removed:false,remove(){this.removed=true},querySelectorAll:()=>selectedLinks.map(value=>({value}))};
  const messages=[],posts=[];
  let keys=0,workspaceIsMerchant=true,failPostOnce=false,failFileOnce=false;
  let workspaceChecks=0,changeDuringVerify=null,changeDuringRead=null;
  let failArchiveOnce=false,failLinkableOnce=false,confirmResult=false,confirmationCount=0;
  let holdPost=false,releasePost=null,notifyPostHeld=null;
  let holdArchive=false,releaseArchive=null,notifyArchiveHeld=null;
  let holdWorkspace=false,releaseWorkspace=null,notifyWorkspaceHeld=null;
  const api=async(path,options)=>{
    if(path==='/api/accounting/workspaces'){
      workspaceChecks++;
      if(holdWorkspace){
        holdWorkspace=false;
        await new Promise(resolve=>{releaseWorkspace=resolve;notifyWorkspaceHeld?.()});
      }
      if(workspaceChecks%2===0&&changeDuringVerify){
        const change=changeDuringVerify;changeDuringVerify=null;
        await Promise.resolve();change();
      }
      return {role:workspaceIsMerchant?'merchant':'customer',active_business_id:14};
    }
    assert.equal(path,'/api/procurement/purchase-documents');
    const payload=JSON.parse(options.body);
    posts.push(payload);
    if(holdPost){
      holdPost=false;
      await new Promise(resolve=>{releasePost=resolve;notifyPostHeld?.()});
    }
    if(failPostOnce){failPostOnce=false;throw new Error('Connection lost after submit');}
    return {already_saved:posts.length>1};
  };
  const FakeFormData=function(){this.get=name=>fields[name]??null};
  const fn=new Function('api','FormData','requestKey','today','message','archive','linkable','readFile','window','document',
    'form','button','receiptLabel','panel',
    `const ROOT='/api/procurement/purchase-documents';
      let overlay=panel,businessId=14,pendingKey=null,pendingPayload=null,
          pendingSubmitted=false,chosenFile=null,saveInProgress=false,openAttempt=0,opening=false;
      const $=selector=>selector==='#mpdForm'?form:
        selector==='#mpdSave'?button:receiptLabel;
      let previousOverflow='';
      ${saveSource}
      ${closeSource}
      return {save,close,setFile:file=>{chosenFile=file},state:()=>({pendingKey,pendingPayload,pendingSubmitted,overlayActive:!!overlay,saveInProgress})};`);
  const controller=fn(api,FakeFormData,()=>('purchase-intent-'+(++keys)),()=>fields.issue_date,
    (text,isError)=>messages.push({text,isError}),
    async()=>{
      if(holdArchive){holdArchive=false;await new Promise(resolve=>{releaseArchive=resolve;notifyArchiveHeld?.()})}
      if(failArchiveOnce){failArchiveOnce=false;throw new Error('Archive GET unavailable');}
    },
    async()=>{if(failLinkableOnce){failLinkableOnce=false;throw new Error('Purchase-link GET unavailable');}},
    async()=>{if(failFileOnce){failFileOnce=false;throw new Error('File read failed');}
      if(changeDuringRead){const change=changeDuringRead;changeDuringRead=null;await Promise.resolve();change();}
      return 'data:application/pdf;base64,JVBERi0xLjQK'},
    {confirm:()=>{confirmationCount++;return confirmResult}},
    {body:{style:{overflow:'hidden'}}},form,button,receiptLabel,panel);
  return{...controller,fields,posts,messages,
    failNextPost:()=>{failPostOnce=true},failNextFile:()=>{failFileOnce=true},
    failNextArchive:()=>{failArchiveOnce=true},failNextLinkable:()=>{failLinkableOnce=true},
    setWorkspaceRole:merchant=>{workspaceIsMerchant=merchant},keyCount:()=>keys,
    setConfirm:value=>{confirmResult=value},confirmations:()=>confirmationCount,
    holdNextArchive:()=>{
      let notify;
      const whenHeld=new Promise(resolve=>{notify=resolve});
      holdArchive=true;notifyArchiveHeld=notify;
      return {whenHeld,release:()=>{assert.ok(releaseArchive,'archive must be held');releaseArchive()}};
    },
    holdNextPost:()=>{
      let notify;
      const whenHeld=new Promise(resolve=>{notify=resolve});
      holdPost=true;notifyPostHeld=notify;
      return {whenHeld,release:()=>{assert.ok(releasePost,'POST must be held');releasePost()}};
    },
    setLinks:links=>{selectedLinks=links},
    holdNextWorkspace:()=>{
      let notify;
      const whenHeld=new Promise(resolve=>{notify=resolve});
      holdWorkspace=true;notifyWorkspaceHeld=notify;
      return {whenHeld,release:()=>{assert.ok(releaseWorkspace,'workspace must be held');releaseWorkspace()}};
    },
    changeDuringConfirmation:change=>{changeDuringVerify=change},
    changeDuringFileRead:change=>{changeDuringRead=change},
    submit:()=>controller.save({preventDefault(){}})};
}

test('uncertain POST: same payload replays original key; edited payload cannot use that key',async()=>{
  const c=makeController();
  c.failNextPost();
  await c.submit();
  assert.equal(c.posts.length,1);
  const originalKey=c.posts[0].client_request_key;
  assert.equal(c.state().pendingSubmitted,true);
  assert.equal(c.messages.at(-1).isError,true);
  c.fields.gross_amount='31.00';
  await c.submit();
  assert.equal(c.posts.length,1,'edited request must not be sent under uncertain original key');
  assert.match(c.messages.at(-1).text,/may already be saved/);
  c.fields.gross_amount='30.00';
  await c.submit();
  assert.equal(c.posts.length,2);
  assert.equal(c.posts[1].client_request_key,originalKey);
  assert.equal(c.state().pendingKey,null,'confirmed replay releases pending intent');
  c.fields.gross_amount='45.00';
  await c.submit();
  assert.equal(c.posts.length,3);
  assert.notEqual(c.posts[2].client_request_key,originalKey,'new confirmed intent must use new key');
});

test('failed workspace and file preflight do not reserve or submit a request key',async()=>{
  const c=makeController();
  c.setWorkspaceRole(false);
  await c.submit();
  assert.equal(c.keyCount(),0);
  assert.equal(c.posts.length,0);
  c.setWorkspaceRole(true);
  c.setFile({name:'receipt.pdf'});
  c.failNextFile();
  await c.submit();
  assert.equal(c.keyCount(),0);
  assert.equal(c.posts.length,0);
  c.fields.note='Confirmed file selection';
  await c.submit();
  assert.equal(c.posts.length,1);
  assert.equal(c.keyCount(),1);
  assert.equal(c.posts[0].note,'Confirmed file selection');
});

test('in-flight metadata edit during workspace recheck never posts an obsolete receipt',async()=>{
  const c=makeController();
  c.changeDuringConfirmation(()=>{c.fields.gross_amount='31.00'});
  await c.submit();
  assert.equal(c.posts.length,0);
  assert.equal(c.keyCount(),0,'no intent key reserved before final draft check');
  assert.match(c.messages.at(-1).text,/changed while preparing/);
  await c.submit();
  assert.equal(c.posts.length,1);
  assert.equal(c.posts[0].gross_amount,'31.00');
});

test('in-flight linked purchase checkbox edit cannot post a stale receipt-to-purchase association',async()=>{
  const c=makeController();
  c.setLinks(['101']);
  c.changeDuringConfirmation(()=>c.setLinks(['102']));
  await c.submit();
  assert.equal(c.posts.length,0);
  assert.equal(c.keyCount(),0);
  assert.match(c.messages.at(-1).text,/changed while preparing/);
  await c.submit();
  assert.deepEqual(c.posts[0].links,[{kind:'inventory_purchase',id:102}]);
});

test('camera file replacement while file read is pending never posts the old scan',async()=>{
  const c=makeController();
  c.setFile({name:'old.pdf'});
  c.changeDuringFileRead(()=>c.setFile({name:'new.pdf'}));
  await c.submit();
  assert.equal(c.posts.length,0);
  assert.equal(c.keyCount(),0);
  assert.match(c.messages.at(-1).text,/changed while preparing/);
  await c.submit();
  assert.equal(c.posts.length,1);
  assert.equal(c.posts[0].file_name,'new.pdf');
});

// A real browser can dispatch submit by Enter, keyboard or scripted event even
// after the button becomes disabled. Preflight must be a single-flight operation:
// without the guard, the second invocation posts and clears pendingKey before
// the first resumes, producing two distinct receipt keys for one visible form.
test('overlapping save events cannot create a second receipt intent while preflight awaits',async()=>{
  const c=makeController();
  const gate=c.holdNextWorkspace();
  const first=c.submit();
  await gate.whenHeld;
  assert.equal(c.posts.length,0);
  assert.equal(c.keyCount(),0);
  await c.submit();
  assert.equal(c.posts.length,0,'second submit must not reach POST while first preflight waits');
  assert.equal(c.keyCount(),0,'second submit must not allocate a separate receipt key');
  gate.release();
  await first;
  assert.equal(c.posts.length,1);
  assert.equal(c.keyCount(),1);
  assert.equal(c.state().pendingSubmitted,false);
  assert.equal(c.state().pendingKey,null);
});

test('confirmed save remains confirmed when archive GET fails after POST',async()=>{
  const c=makeController();
  c.failNextArchive();
  await c.submit();
  assert.equal(c.posts.length,1,'save was committed by the POST mock');
  assert.equal(c.keyCount(),1);
  assert.equal(c.state().pendingKey,null,'confirmed save releases the key even when archive GET fails');
  assert.equal(c.state().pendingSubmitted,false);
  assert.match(c.messages.at(-1).text,/Purchase document saved securely/);
  assert.match(c.messages.at(-1).text,/Archive or purchase links could not refresh/);
  assert.match(c.messages.at(-1).text,/save is confirmed/);
  c.fields.note='New independently confirmed receipt';
  await c.submit();
  assert.equal(c.posts.length,2,'the operator can explicitly save the next receipt');
  assert.notEqual(c.posts[1].client_request_key,c.posts[0].client_request_key);
  assert.notEqual(c.messages.at(-1).isError,true,'successful subsequent save is not an error');
});

test('confirmed replay remains confirmed when linked-purchase GET fails',async()=>{
  const c=makeController();
  c.failNextPost();
  await c.submit();
  assert.equal(c.posts.length,1);
  const originalKey=c.posts[0].client_request_key;
  c.failNextLinkable();
  await c.submit();
  assert.equal(c.posts.length,2,'same-key replay reaches the server only once more');
  assert.equal(c.posts[1].client_request_key,originalKey);
  assert.equal(c.state().pendingKey,null);
  assert.match(c.messages.at(-1).text,/This document was already saved/);
  assert.match(c.messages.at(-1).text,/save is confirmed/);
  assert.match(c.messages.at(-1).text,/could not refresh/);
});

test('closing while the real save controller has an in-flight POST cannot drop its intent key',async()=>{
  const c=makeController();
  const gate=c.holdNextPost();
  const saving=c.submit();
  await gate.whenHeld;
  assert.equal(c.posts.length,1);
  const key=c.posts[0].client_request_key;
  assert.equal(c.state().saveInProgress,true);
  assert.equal(c.close(),false,'X/Escape close must be rejected during an unacknowledged POST');
  assert.equal(c.state().overlayActive,true);
  assert.equal(c.state().pendingKey,key);
  assert.equal(c.confirmations(),0,'do not offer a dismiss option while HTTP is pending');
  gate.release();
  await saving;
  assert.equal(c.state().pendingSubmitted,false);
  assert.equal(c.close(),true,'confirmed save may dismiss safely');
  assert.equal(c.state().overlayActive,false);
});

test('uncertain save dismissal requires explicit warning; cancel keeps identical-key replay available',async()=>{
  const c=makeController();
  c.failNextPost();
  await c.submit();
  assert.equal(c.state().pendingSubmitted,true);
  const originalKey=c.posts[0].client_request_key;
  c.setConfirm(false);
  assert.equal(c.close(),false);
  assert.equal(c.confirmations(),1);
  assert.equal(c.state().pendingKey,originalKey);
  assert.equal(c.state().overlayActive,true);
  await c.submit();
  assert.equal(c.posts[1].client_request_key,originalKey);
  assert.equal(c.state().pendingSubmitted,false);
  assert.equal(c.close(),true);
});

test('explicit uncertain-save dismissal is possible but only after duplicate-warning confirmation',async()=>{
  const c=makeController();
  c.failNextPost();
  await c.submit();
  c.setConfirm(true);
  assert.equal(c.close(),true);
  assert.equal(c.confirmations(),1);
  assert.equal(c.state().overlayActive,false);
  assert.equal(c.state().pendingKey,null);
  assert.equal(c.state().pendingSubmitted,false);
  assert.equal(c.posts.length,1,'close never retries or creates receipts');
});

test('confirmed POST can close while auxiliary archive GET is slow; no second receipt is sent',async()=>{
  const c=makeController();
  const gate=c.holdNextArchive();
  const saving=c.submit();
  await gate.whenHeld;
  assert.equal(c.posts.length,1,'only the already-confirmed receipt was sent');
  assert.equal(c.state().pendingSubmitted,false,'POST acknowledgement has cleared uncertain state');
  assert.equal(c.state().saveInProgress,true,'archive refresh remains pending');
  assert.equal(c.close(),true,'archive latency must not trap operator after confirmed save');
  assert.equal(c.confirmations(),0);
  gate.release();
  await saving;
  assert.equal(c.posts.length,1);
});


// #856 — execute the literal asynchronous open and profile-change handlers.
// A changed account may not inherit a previously pending Merchant receipt panel.
const openStart=source.indexOf('  async function open(){');
const openEnd=source.indexOf('\n  function ensureButton(){',openStart);
assert.ok(openStart>=0&&openEnd>openStart,'literal shipped open controller must be present');
const openSource=source.slice(openStart,openEnd);
const invalidateStart=source.indexOf('  function invalidatePurchaseDocumentContext(){');
const invalidateEnd=source.indexOf("\n  document.addEventListener('abl:profile-state'",invalidateStart);
assert.ok(invalidateStart>=0&&invalidateEnd>invalidateStart,'profile invalidation must be defined');
assert.match(source,/document\.addEventListener\('abl:profile-state',invalidatePurchaseDocumentContext\)/);
const invalidateSource=source.slice(invalidateStart,invalidateEnd);

function makeOpeningController(){
  let calls=0,createCount=0,hold=false,release=null,notify=null,fail=false;
  const alerts=[];
  const api=async path=>{
    assert.equal(path,'/api/accounting/workspaces');
    calls++;
    if(hold){
      hold=false;
      await new Promise(resolve=>{release=resolve;notify?.()});
    }
    if(fail){fail=false;throw new Error('Old workspace error')}
    return {role:'merchant',active_business_id:14};
  };
  const factory=new Function('api','document','window','queueMicrotask','created',`
    let overlay=null,businessId=null,openAttempt=0,opening=false;
    let saveInProgress=false,pendingSubmitted=false,pendingKey=null,pendingPayload=null,
        chosenFile=null,previousOverflow='';
    const message=()=>{},injectCss=()=>{},linkable=async()=>{},archive=async()=>{},ensureButton=()=>{};
    const render=()=>{overlay={remove(){this.removed=true}};created()};
    ${closeSource}
    ${openSource}
    ${invalidateSource}
    return {open,close,invalidatePurchaseDocumentContext,
      state:()=>({overlay:!!overlay,businessId,openAttempt,opening})};
  `);
  const controller=factory(api,{body:{style:{overflow:''}}},{alert:v=>alerts.push(v)},
    callback=>callback(),()=>{createCount++});
  return {...controller,alerts,calls:()=>calls,created:()=>createCount,
    failNext:()=>{fail=true},
    holdNext:()=>{
      let started;
      const whenHeld=new Promise(resolve=>{started=resolve});
      hold=true;notify=started;
      return {whenHeld,release:()=>{assert.ok(release,'initial workspace GET must be held');release()}};
    }};
}

test('profile switch during initial workspace GET never resurrects stale private receipts',async()=>{
  const c=makeOpeningController(),gate=c.holdNext();
  const first=c.open();
  await gate.whenHeld;
  assert.equal(c.state().overlay,false);
  c.invalidatePurchaseDocumentContext();
  gate.release();
  await first;
  assert.equal(c.created(),0,'previous identity cannot reopen its private panel');
  assert.equal(c.state().overlay,false);
  assert.equal(c.alerts.length,0,'stale responses are ignored rather than shown to new identity');
  await c.open();
  assert.equal(c.created(),1,'fresh authorized open remains functional');
  assert.equal(c.state().businessId,14);
  assert.equal(c.close(),true);
});

test('double-click before workspace GET resolves is single-flight, not two dialogs',async()=>{
  const c=makeOpeningController(),gate=c.holdNext();
  const first=c.open();
  await gate.whenHeld;
  await c.open();
  assert.equal(c.calls(),1);
  assert.equal(c.created(),0);
  gate.release();
  await first;
  assert.equal(c.created(),1);
  assert.equal(c.state().overlay,true);
});

test('late failed workspace request after profile revocation does not alert replacement user',async()=>{
  const c=makeOpeningController(),gate=c.holdNext();
  c.failNext();
  const first=c.open();
  await gate.whenHeld;
  c.invalidatePurchaseDocumentContext();
  gate.release();
  await first;
  assert.equal(c.created(),0);
  assert.deepEqual(c.alerts,[]);
  assert.equal(c.state().opening,false);
});
