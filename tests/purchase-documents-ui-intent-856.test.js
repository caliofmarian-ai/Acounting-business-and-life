// #856/#883 — execute the literal Merchant purchase-document save controller with a
// minimal browser-form harness. All API calls are synthetic and have no live side effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/purchase-documents-ui.js',import.meta.url),'utf8');
const start=source.indexOf('  async function save(event){');
const end=source.indexOf('\n  function close(',start);
assert.ok(start>=0&&end>start,'literal shipped save controller must be present');
const helperStart=source.indexOf('  function acknowledgedDocumentMatches(result,payload){');
assert.ok(helperStart>=0&&helperStart<start,'literal shipped acknowledgement checker exists');
const saveSource=source.slice(helperStart,end);
const closeStart=source.indexOf('  function close(',end);
const closeEnd=source.indexOf('\n  async function open(){',closeStart);
assert.ok(closeStart>=0&&closeEnd>closeStart,'literal shipped close controller must be present');
const closeSource=source.slice(closeStart,closeEnd);

function makeController(){
  const fields={document_kind:'purchase_receipt',issuer_name:'Market',issue_date:'2026-11-06',
    document_number:'',gross_amount:'30.00',note:''};
  const button={disabled:false};
  let resetCount=0;
  const form={elements:{issue_date:{value:''}},reset(){resetCount++}};
  const receiptLabel={textContent:''};
  let selectedLinks=[];
  const panel={removed:false,remove(){this.removed=true},querySelectorAll:()=>selectedLinks.map(value=>({value}))};
  const messages=[],posts=[];
  let keys=0,workspaceIsMerchant=true,activeBusinessId=14,failPostOnce=false,failFileOnce=false;
  let nextPostResponse; const persisted=new Map();
  let workspaceChecks=0,changeDuringVerify=null,changeDuringRead=null;
  let failArchiveOnce=false,failLinkableOnce=false,confirmResult=false,confirmationCount=0;
  let linkableRefreshes=0;
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
      return {role:workspaceIsMerchant?'merchant':'customer',active_business_id:activeBusinessId};
    }
    assert.equal(path,'/api/procurement/purchase-documents');
    const payload=JSON.parse(options.body);
    posts.push(payload);
    const wasSaved=persisted.has(payload.client_request_key);
    if(!wasSaved)persisted.set(payload.client_request_key,100+persisted.size);
    const realShape={already_saved:wasSaved,document:{
      id:persisted.get(payload.client_request_key),business_id:payload.business_id,
      document_kind:payload.document_kind,issue_date:payload.issue_date,
      issuer_name:payload.issuer_name.trim(),document_number:payload.document_number.trim(),
      currency_code:payload.currency_code,note:payload.note.trim(),
      gross_amount:payload.gross_amount===''?null:Number(payload.gross_amount),
      has_attachment:Boolean(payload.data_url)
    }};
    if(holdPost){
      holdPost=false;
      await new Promise(resolve=>{releasePost=resolve;notifyPostHeld?.()});
    }
    if(failPostOnce){failPostOnce=false;throw new Error('Connection lost after submit');}
    const override=nextPostResponse; nextPostResponse=undefined;
    return override===undefined?realShape:
      typeof override==='function'?override(payload,realShape):override;
  };
  const FakeFormData=function(){this.get=name=>fields[name]??null};
  const fn=new Function('api','FormData','requestKey','today','message','archive','linkable','readFile','window','document',
    'form','button','receiptLabel','panel',
    `const ROOT='/api/procurement/purchase-documents';
      let overlay=panel,businessId=14,pendingKey=null,pendingPayload=null,
          pendingSubmitted=false,chosenFile=null,saveInProgress=false,openAttempt=0,opening=false,saveAttempt=0;
      const $=selector=>selector==='#mpdForm'?form:
        selector==='#mpdSave'?button:receiptLabel;
      let previousOverflow='';
      ${saveSource}
      ${closeSource}
      return {save,close,setFile:file=>{chosenFile=file},
        mountReplacement:()=>{if(overlay)throw new Error('Close old receipt panel before replacing');overlay={remove(){},querySelectorAll:panel.querySelectorAll};businessId=14},
        state:()=>({pendingKey,pendingPayload,pendingSubmitted,overlayActive:!!overlay,saveInProgress,buttonDisabled:button.disabled,chosenFile})};`);
  const controller=fn(api,FakeFormData,()=>('purchase-intent-'+(++keys)),()=>fields.issue_date,
    (text,isError)=>messages.push({text,isError}),
    async()=>{
      if(holdArchive){holdArchive=false;await new Promise(resolve=>{releaseArchive=resolve;notifyArchiveHeld?.()})}
      if(failArchiveOnce){failArchiveOnce=false;throw new Error('Archive GET unavailable');}
    },
    async()=>{if(failLinkableOnce){failLinkableOnce=false;throw new Error('Purchase-link GET unavailable');}
      linkableRefreshes++;selectedLinks=[];},
    async()=>{if(failFileOnce){failFileOnce=false;throw new Error('File read failed');}
      if(changeDuringRead){const change=changeDuringRead;changeDuringRead=null;await Promise.resolve();change();}
      return 'data:application/pdf;base64,JVBERi0xLjQK'},
    {confirm:()=>{confirmationCount++;return confirmResult}},
    {body:{style:{overflow:'hidden'}}},form,button,receiptLabel,panel);
  return{...controller,fields,posts,messages,
    failNextPost:()=>{failPostOnce=true},failNextFile:()=>{failFileOnce=true},
    replyNextPost:response=>{nextPostResponse=response},
    failNextArchive:()=>{failArchiveOnce=true},failNextLinkable:()=>{failLinkableOnce=true},
    setWorkspaceRole:merchant=>{workspaceIsMerchant=merchant},setActiveBusiness:id=>{activeBusinessId=id},keyCount:()=>keys,
    resetCount:()=>resetCount,linkableRefreshes:()=>linkableRefreshes,selectedLinks:()=>selectedLinks,
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

test('Merchant save preflight rejects coerced or noncanonical workspace IDs',async()=>{
  for(const id of [[14],' 14 ','1.4e1','014',true,{},9007199254740992,0,-14,null]){
    const c=makeController();
    c.setActiveBusiness(id);
    await c.submit();
    assert.equal(c.posts.length,0,'no POST for '+String(id));
    assert.equal(c.keyCount(),0,'no intent key for '+String(id));
    assert.match(c.messages.at(-1).text,/Merchant workspace changed/);
  }
  for(const id of [14,'14']){
    const c=makeController();
    c.setActiveBusiness(id);
    await c.submit();
    assert.equal(c.posts.length,1);
  }
});

test('final pre-POST check rejects coerced business identity without submitting',async()=>{
  const c=makeController();
  c.changeDuringConfirmation(()=>c.setActiveBusiness([14]));
  await c.submit();
  assert.equal(c.posts.length,0);
  assert.equal(c.keyCount(),0);
  assert.match(c.messages.at(-1).text,/Merchant workspace changed/);
});

test('post-ACK coercible workspace identity revokes the private dialog',async()=>{
  const c=makeController(),gate=c.holdNextPost();
  const saving=c.submit();
  await gate.whenHeld;
  c.setActiveBusiness(' 14 ');
  gate.release();
  await saving;
  assert.equal(c.posts.length,1);
  assert.equal(c.state().overlayActive,false);
  assert.equal(c.resetCount(),0);
  assert.equal(c.messages.some(m=>/saved securely|already saved/i.test(m.text)),false);
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

test('confirmed in-flight POST preserves newer typed details and a replacement camera file',async()=>{
  const c=makeController();
  const firstFile={name:'original.pdf'};
  const secondFile={name:'next-receipt.pdf'};
  c.setFile(firstFile);
  const gate=c.holdNextPost();
  const saving=c.submit();
  await gate.whenHeld;
  assert.equal(c.posts.length,1,'old receipt payload has already been sent');
  assert.equal(c.posts[0].file_name,'original.pdf');
  c.fields.issuer_name='Next supplier';
  c.fields.gross_amount='99.00';
  c.setLinks(['202']);
  c.setFile(secondFile);
  gate.release();
  await saving;
  assert.equal(c.resetCount(),0,'old POST must not reset a newer draft');
  assert.equal(c.linkableRefreshes(),0,'old POST must not re-render and erase new link checkboxes');
  assert.deepEqual(c.selectedLinks(),['202']);
  assert.equal(c.state().chosenFile,secondFile,'new camera/PDF selection must survive old save acknowledgement');
  assert.equal(c.fields.issuer_name,'Next supplier');
  assert.equal(c.fields.gross_amount,'99.00');
  assert.match(c.messages.at(-1).text,/newer unsaved edits are preserved/);
  assert.equal(c.state().pendingSubmitted,false,'old confirmed intent key is released');
  await c.submit();
  assert.equal(c.posts.length,2);
  assert.equal(c.posts[1].issuer_name,'Next supplier');
  assert.equal(c.posts[1].gross_amount,'99.00');
  assert.equal(c.posts[1].file_name,'next-receipt.pdf');
  assert.deepEqual(c.posts[1].links,[{kind:'inventory_purchase',id:202}]);
  assert.notEqual(c.posts[1].client_request_key,c.posts[0].client_request_key);
  assert.equal(c.resetCount(),1,'new fully submitted draft resets normally');
  assert.equal(c.linkableRefreshes(),1,'normal completed draft refreshes purchase-link choices');
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

test('silent Merchant A→B switch during POST cannot show A receipt or reset the replacement draft',async()=>{
  const c=makeController();
  const gate=c.holdNextPost();
  const posting=c.submit();
  await gate.whenHeld;
  assert.equal(c.posts.length,1,'the original A request was sent once');
  c.setActiveBusiness(15); // no profile event and cached dialog business stays 14
  gate.release();
  await posting;
  assert.equal(c.posts.length,1,'revoked response must never retry or create another receipt');
  assert.equal(c.state().overlayActive,false,'A private dialog is forcibly revoked for Merchant B');
  assert.equal(c.resetCount(),0,'old A acknowledgement must not clear B draft');
  assert.equal(c.state().pendingSubmitted,false);
  assert.equal(c.messages.some(entry=>/saved securely|already saved/i.test(entry.text)),false,
    'private A confirmation must not be reported as B');
});

test('Merchant role revoked during successful POST cannot leave prior receipt dialog open',async()=>{
  const c=makeController();
  const gate=c.holdNextPost();
  const posting=c.submit();
  await gate.whenHeld;
  c.setWorkspaceRole(false);
  gate.release();
  await posting;
  assert.equal(c.posts.length,1);
  assert.equal(c.state().overlayActive,false);
  assert.equal(c.resetCount(),0);
  assert.equal(c.messages.some(entry=>/saved securely|already saved/i.test(entry.text)),false);
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
  let activeBusiness=14;
  const alerts=[];
  const api=async path=>{
    assert.equal(path,'/api/accounting/workspaces');
    calls++;
    if(hold){
      hold=false;
      await new Promise(resolve=>{release=resolve;notify?.()});
    }
    if(fail){fail=false;throw new Error('Old workspace error')}
    return {role:'merchant',active_business_id:activeBusiness};
  };
  const factory=new Function('api','document','window','queueMicrotask','created',`
    let overlay=null,businessId=null,openAttempt=0,opening=false,saveAttempt=0;
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
    setActiveBusiness:value=>{activeBusiness=value},
    failNext:()=>{fail=true},
    holdNext:()=>{
      let started;
      const whenHeld=new Promise(resolve=>{started=resolve});
      hold=true;notify=started;
      return {whenHeld,release:()=>{assert.ok(release,'initial workspace GET must be held');release()}};
    }};
}

test('opening receipts rejects coercible Merchant workspace IDs and accepts canonical ones',async()=>{
  for(const id of [[14],' 14 ','1.4e1','014',true,{},9007199254740992,0,-14,null]){
    const c=makeOpeningController();
    c.setActiveBusiness(id);
    await c.open();
    assert.equal(c.created(),0,'no private panel for '+String(id));
    assert.equal(c.state().overlay,false);
    assert.match(c.alerts.at(-1),/Switch to your Merchant business/);
  }
  for(const id of [14,'14']){
    const c=makeOpeningController();
    c.setActiveBusiness(id);
    await c.open();
    assert.equal(c.created(),1);
    assert.equal(c.state().businessId,14);
    assert.equal(c.close(),true);
  }
});

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

// A previous Merchant dialog may finish an auxiliary archive request after a
// forced profile switch and a different dialog has started saving. Its finally
// must not unlock the new POST or permit a duplicate intent.
test('late old archive completion cannot unlock the replacement Merchant receipt save',async()=>{
  const c=makeController();
  const oldArchive=c.holdNextArchive();
  const oldSave=c.submit();
  await oldArchive.whenHeld;
  assert.equal(c.posts.length,1,'first POST was acknowledged before archive refresh');
  assert.equal(c.close(true),true,'profile change revokes old visible dialog');
  assert.equal(c.state().saveInProgress,false,'revoked dialog no longer holds global busy state');
  c.mountReplacement();
  c.fields.note='Fresh profile document';
  const newPost=c.holdNextPost();
  const newSave=c.submit();
  await newPost.whenHeld;
  assert.equal(c.posts.length,2);
  assert.equal(c.state().saveInProgress,true);
  assert.equal(c.state().buttonDisabled,true);
  oldArchive.release();
  await oldSave;
  assert.equal(c.state().saveInProgress,true,'old finally cannot release new dialog ownership');
  assert.equal(c.state().buttonDisabled,true,'old finally cannot enable replacement submit');
  await c.submit();
  assert.equal(c.posts.length,2,'second submit during replacement POST cannot allocate another intent');
  newPost.release();
  await newSave;
  assert.equal(c.state().saveInProgress,false);
  assert.equal(c.state().pendingSubmitted,false);
  assert.notEqual(c.posts[0].client_request_key,c.posts[1].client_request_key);
});


test('same-dialog stale archive and linked-purchase responses cannot overwrite the latest refresh',async()=>{
  // Execute the literal shipped functions with deferred responses; unlike a
  // profile-switch-only test, panel and business stay identical throughout.
  const begin=source.indexOf('  async function verifiedMerchantRead(');
  const end=source.indexOf('\n  function readFile(',begin);
  assert.ok(begin>=0&&end>begin,'literal archive and purchase-link controllers exist');
  const pending=[];
  const api=path=>path==='/api/accounting/workspaces'?Promise.resolve({role:'merchant',active_business_id:14}):new Promise((resolve,reject)=>pending.push({path,resolve,reject}));
  const boxes={'#mpdLinkable':{innerHTML:'Loading links'},'#mpdSaved':{innerHTML:'Loading archive'}};
  const panel={};
  const controller=new Function('api','escape','currency','panel','boxes',`
    const ROOT='/api/procurement/purchase-documents';
    let overlay=panel,businessId=14,linkableRequest=0,archiveRequest=0;
    const $=(selector,root)=>root===panel?boxes[selector]:null;
    ${source.slice(begin,end)}
    return {archive,linkable};
  `)(api,String,value=>String(value),panel,boxes);
  const oldArchive=controller.archive(),newArchive=controller.archive();
  assert.equal(pending.length,2);
  pending[1].resolve({documents:[{id:71,business_id:14,issuer_name:'Newest receipt',document_kind:'invoice',
    issue_date:'2026-11-07',gross_amount:27,currency_code:'PHP',has_attachment:false}]});
  await newArchive;
  assert.match(boxes['#mpdSaved'].innerHTML,/Newest receipt/);
  const latestArchive=boxes['#mpdSaved'].innerHTML;
  pending[0].resolve({documents:[]});
  await oldArchive;
  assert.equal(boxes['#mpdSaved'].innerHTML,latestArchive,
    'older initial GET must not erase the saved receipt after post-save refresh');

  const oldLinks=controller.linkable(),newLinks=controller.linkable();
  assert.equal(pending.length,4);
  pending[3].resolve({purchases:[{id:51,business_id:14,inventory_name:'Latest purchase',
    total_cost:45,created_at:'2026-11-07',purchase_quantity:2,purchase_unit:'kg'}]});
  await newLinks;
  assert.match(boxes['#mpdLinkable'].innerHTML,/Latest purchase/);
  const latestLinks=boxes['#mpdLinkable'].innerHTML;
  pending[2].resolve({purchases:[]});
  await oldLinks;
  assert.equal(boxes['#mpdLinkable'].innerHTML,latestLinks,
    'older purchase links must not replace current choices');

  const failingOld=controller.archive(),goodNew=controller.archive();
  pending[5].resolve({documents:[{id:72,business_id:14,issuer_name:'Confirmed again',document_kind:'purchase_receipt',
    issue_date:'2026-11-07',gross_amount:19,currency_code:'PHP',has_attachment:false}]});
  await goodNew;
  pending[4].reject(new Error('Obsolete archive GET failed'));
  await failingOld;
  assert.match(boxes['#mpdSaved'].innerHTML,/Confirmed again/,
    'superseded network failure cannot erase new content or alert after success');
});

test('late purchase-list GET cannot discard a checkbox selected for a new draft',async()=>{
  // Literal source test; overwriting DOM-like innerHTML clears live checkbox state.
  const begin=source.indexOf('  async function verifiedMerchantRead(');
  const end=source.indexOf('\n  async function archive(){',begin);
  assert.ok(begin>=0&&end>begin);
  let resolveRead,selected=[],writes=0,html='Existing choices';
  const box={
    querySelectorAll:selector=>{
      assert.equal(selector,'input[name="mpdLink"]:checked');
      return selected.map(value=>({value}));
    },
    get innerHTML(){return html},
    set innerHTML(value){html=value;selected=[];writes++}
  };
  const panel={};
  const api=path=>path==='/api/accounting/workspaces'?Promise.resolve({role:'merchant',active_business_id:14}):new Promise(resolve=>{assert.match(path,/linkable-purchases/);resolveRead=resolve});
  const {linkable}=new Function('api','panel','box','escape','currency',`
    const ROOT='/api/procurement/purchase-documents';
    let overlay=panel,businessId=14,linkableRequest=0,archiveRequest=0;
    const $=(selector,root)=>root===panel?box:null;
    ${source.slice(begin,end)}
    return {linkable};
  `)(api,panel,box,String,Number);
  const first=linkable();
  selected=['51'];
  resolveRead({purchases:[{id:51,business_id:14,inventory_name:'Stock',total_cost:10,
    created_at:'2026-11-07',purchase_quantity:1,purchase_unit:'kg'}]});
  await first;
  assert.deepEqual(selected,['51'],'the next receipt checkbox stays checked');
  assert.equal(writes,0,'in-flight old GET never resets the checked DOM');
  selected=[];
  const second=linkable();
  resolveRead({purchases:[{id:52,business_id:14,inventory_name:'Updated stock',total_cost:20,
    created_at:'2026-11-07',purchase_quantity:2,purchase_unit:'kg'}]});
  await second;
  assert.equal(writes,1,'ordinary unselected refresh still renders');
  assert.match(html,/Updated stock/);
});

test('clearing either native receipt picker revokes the previously selected private attachment',()=>{
  // Literal shipped handler. Both native camera and file inputs dispatch it.
  const begin=source.indexOf('  function selectFile(file){');
  const end=source.indexOf('\n  async function linkable(){',begin);
  assert.ok(begin>=0&&end>begin);
  assert.match(source,/mpdFile',overlay\)\.onchange=event=>selectFile\(event\.target\.files\?\.\[0\]\)/);
  assert.match(source,/mpdCamera',overlay\)\.onchange=event=>selectFile\(event\.target\.files\?\.\[0\]\)/);
  const display={textContent:''},messages=[];
  const controller=new Function('display','messages',`
    const MAX_FILE=6*1024*1024,overlay={};
    let chosenFile=null;
    const $=(selector,root)=>{
      if(selector!=='#mpdChosenFile'||root!==overlay)throw Error('Wrong display');
      return display;
    };
    const message=(text,error=false)=>messages.push({text,error});
    ${source.slice(begin,end)}
    return{selectFile,selected:()=>chosenFile};
  `)(display,messages);
  const oldReceipt={name:'old-receipt.pdf',size:1024,type:'application/pdf'};
  controller.selectFile(oldReceipt);
  assert.equal(controller.selected(),oldReceipt);
  assert.match(display.textContent,/old-receipt.pdf/);
  controller.selectFile(undefined); // native FileList became empty
  assert.equal(controller.selected(),null,
    'empty picker change must not preserve a stale private attachment');
  assert.equal(display.textContent,'No file selected.');
  assert.equal(messages.at(-1).text,'');
  controller.selectFile(oldReceipt);
  controller.selectFile({name:'unsupported.txt',size:2,type:'text/plain'});
  assert.equal(controller.selected(),null,'invalid replacement revokes old receipt');
  assert.match(messages.at(-1).text,/Only JPEG, PNG, WEBP and PDF/);
  controller.selectFile(oldReceipt);
  controller.selectFile({name:'oversized.pdf',size:6*1024*1024+1,type:'application/pdf'});
  assert.equal(controller.selected(),null,'oversize replacement revokes old receipt');
  const nextReceipt={name:'new-receipt.jpg',size:2048,type:'image/jpeg'};
  controller.selectFile(nextReceipt);
  assert.equal(controller.selected(),nextReceipt,'valid replacement still works');
  assert.match(display.textContent,/new-receipt.jpg/);
});

test('invalid 2xx receipt acknowledgements retain one original retry key and cannot erase draft',async()=>{
  const cases=[
    ()=>({}),(_p,g)=>({...g,document:undefined}),
    (_p,g)=>({...g,already_saved:'true'}),
    (_p,g)=>({...g,document:{...g.document,id:0}}),
    (_p,g)=>({...g,document:{...g.document,business_id:99}}),
    (_p,g)=>({...g,document:{...g.document,gross_amount:30.01}}),
    (_p,g)=>({...g,document:{...g.document,issuer_name:'Wrong shop'}}),
    (_p,g)=>({...g,document:{...g.document,issue_date:'2026-11-05'}}),
    (_p,g)=>({...g,document:{...g.document,has_attachment:true}}),
    (_p,g)=>({...g,document:{...g.document,currency_code:'USD'}})
  ];
  for(const bad of cases){
    const c=makeController();
    c.replyNextPost(bad);
    await c.submit();
    assert.equal(c.posts.length,1);
    assert.equal(c.state().pendingSubmitted,true);
    assert.equal(c.resetCount(),0);
    assert.match(c.messages.at(-1).text,/acknowledgement did not match/);
    const key=c.state().pendingKey;
    assert.equal(key,c.posts[0].client_request_key);
    c.fields.gross_amount='31.00'; await c.submit();
    assert.equal(c.posts.length,1,'edited draft cannot resubmit an uncertain original');
    c.fields.gross_amount='30.00'; await c.submit();
    assert.equal(c.posts[1].client_request_key,key,'manual retry uses original intent');
    assert.equal(c.state().pendingSubmitted,false);
    assert.equal(c.resetCount(),1);
  }
});

test('verified server-shape 201 and replay 200 accept unchanged PDF metadata and optional blank total',async()=>{
  const c=makeController();
  c.fields.issuer_name=' Market '; c.fields.document_number=' R-123 ';
  c.fields.note=' Scanned receipt '; c.fields.gross_amount='';
  c.setFile({name:'receipt.pdf'});
  await c.submit();
  assert.equal(c.posts.length,1);
  assert.equal(c.state().pendingSubmitted,false);
  assert.equal(c.resetCount(),1);
  const retry=makeController();
  retry.failNextPost(); retry.setFile({name:'receipt.pdf'});
  await retry.submit();
  const key=retry.state().pendingKey;
  await retry.submit();
  assert.equal(retry.posts[1].client_request_key,key);
  assert.equal(retry.state().pendingSubmitted,false);
});


// Archive client defense: execute the literal shipped archive renderer, not a
// copied mock. The server shape() returns numeric business_id and id for every
// private Merchant document. A malformed/mixed 200 must disclose none of it.
test('private receipt archive rejects foreign-business and malformed HTTP 200 rows before rendering',async()=>{
  const begin=source.indexOf('  async function verifiedMerchantRead(');
  const end=source.indexOf('\n  function readFile(',begin);
  assert.ok(begin>=0&&end>begin,'literal archive controller must be present');
  const archiveSource=source.slice(begin,end);
  const row={id:77,business_id:14,document_kind:'invoice',issuer_name:'My shop',
    document_number:'R-4',issue_date:'2026-11-07',gross_amount:15.50,
    currency_code:'PHP',has_attachment:true};
  const makeArchive=response=>{
    const box={innerHTML:'Loading Merchant receipts'},panel={};
    const archive=new Function('api','panel','box',`
      const ROOT='/api/procurement/purchase-documents';
      let overlay=panel,businessId=14,archiveRequest=0,linkableRequest=0;
      const $=(selector,root)=>selector==='#mpdSaved'&&root===panel?box:null;
      const escape=value=>String(value??'').replace(/[&<>"']/g,c=>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const currency=value=>String(value??'');
      ${archiveSource}
      return archive;
    `)(async path=>{
      if(path==='/api/accounting/workspaces')return{role:'merchant',active_business_id:14};
      assert.match(path,/business_id=14$/);
      return response;
    },panel,box);
    return{archive,box};
  };
  const permitted=makeArchive({documents:[row]});
  await permitted.archive();
  assert.match(permitted.box.innerHTML,/My shop/);
  assert.match(permitted.box.innerHTML,/\/77\/file\?business_id=14/);
  const empty=makeArchive({documents:[]});
  await empty.archive();
  assert.match(empty.box.innerHTML,/No purchase documents saved yet/);
  for(const response of [
    {documents:[{...row,business_id:15,issuer_name:'FOREIGN PRIVATE RECEIPT'}]},
    {documents:[row,{...row,id:78,business_id:15,issuer_name:'FOREIGN PRIVATE RECEIPT'}]},
    {documents:[{...row,id:'77'}]},
    {documents:[{...row,business_id:[14]}]},
    {documents:[{...row,document_kind:{toString:()=> 'invoice'}}]},
    {documents:[{...row,has_attachment:'true'}]},
    {documents:{length:1}},
    {}
  ]){
    const testArchive=makeArchive(response);
    await assert.rejects(testArchive.archive(),/business or document identity could not be verified/);
    assert.doesNotMatch(testArchive.box.innerHTML,/FOREIGN PRIVATE RECEIPT|\/77\/file|\/78\/file/);
    assert.match(testArchive.box.innerHTML,/Could not verify the Merchant purchase archive/);
  }
});

test('private linked purchases reject foreign or malformed HTTP rows before rendering',async()=>{
  const begin=source.indexOf('  async function verifiedMerchantRead(');
  const end=source.indexOf('\n  async function archive(){',begin);
  assert.ok(begin>=0&&end>begin);
  const literal=source.slice(begin,end);
  const base={id:51,business_id:14,inventory_name:'My Inventory',total_cost:15,
    created_at:'2026-11-07',purchase_quantity:1,purchase_unit:'kg'};
  const run=async response=>{
    const box={innerHTML:'Loading',querySelectorAll:()=>[]},panel={};
    const linkable=new Function('api','panel','box',`
      const ROOT='/api/procurement/purchase-documents';
      let overlay=panel,businessId=14,linkableRequest=0,archiveRequest=0;
      const $=(selector,root)=>selector==='#mpdLinkable'&&root===panel?box:null;
      const escape=value=>String(value??'');
      const currency=value=>String(value??'');
      ${literal}
      return linkable;
    `)(async path=>{if(path==='/api/accounting/workspaces')return{role:'merchant',active_business_id:14};assert.match(path,/business_id=14$/);return response},panel,box);
    let error=null;try{await linkable()}catch(e){error=e}
    return {error,html:box.innerHTML};
  };
  const valid=await run({purchases:[base]});
  assert.equal(valid.error,null);assert.match(valid.html,/My Inventory/);
  const empty=await run({purchases:[]});
  assert.equal(empty.error,null);assert.match(empty.html,/No recorded Inventory purchases/);
  for(const response of [
    {purchases:[{...base,business_id:15,inventory_name:'PRIVATE FOREIGN PURCHASE'}]},
    {purchases:[base,{...base,id:52,business_id:15,inventory_name:'PRIVATE FOREIGN PURCHASE'}]},
    {purchases:[{...base,business_id:undefined}]},
    {purchases:[{...base,business_id:'14'}]},
    {purchases:[{...base,business_id:[14]}]},
    {purchases:[{...base,id:'51'}]},
    {purchases:[{...base,id:0}]},
    {purchases:{length:1}},{}
  ]){
    const denied=await run(response);
    assert.match(denied.error?.message||'',/Linked purchases business or row identity/);
    assert.doesNotMatch(denied.html,/PRIVATE FOREIGN PURCHASE|value="51"/);
    assert.match(denied.html,/Could not verify the Merchant purchase list/);
  }
});

test('silent Merchant A to B switch during archive GET clears both private lists',async()=>{
  const begin=source.indexOf('  async function verifiedMerchantRead(');
  const end=source.indexOf('\n  function readFile(',begin);
  assert.ok(begin>=0&&end>begin);
  const boxes={'#mpdSaved':{innerHTML:'OLD A FILE LINK'},
    '#mpdLinkable':{innerHTML:'OLD A PURCHASE LIST'}},panel={};
  let selected=14,release,workspaceChecks=0;
  const api=path=>{
    if(path==='/api/accounting/workspaces'){
      workspaceChecks++;return Promise.resolve({role:'merchant',active_business_id:selected});
    }
    if(path==='/api/procurement/purchase-documents?business_id=14')
      return new Promise(resolve=>{release=resolve});
    throw Error('Unexpected private URL '+path);
  };
  const ui=new Function('api','panel','boxes',`
    const ROOT='/api/procurement/purchase-documents';
    let overlay=panel,businessId=14,archiveRequest=0,linkableRequest=0;
    const $=key=>boxes[key];const escape=v=>String(v);const currency=v=>String(v);
    ${source.slice(begin,end)}
    return{archive};
  `)(api,panel,boxes);
  const pending=ui.archive();
  selected=15; // The workspace switches without another loader/profile event.
  release({documents:[{id:71,business_id:14,document_kind:'invoice',issuer_name:'FOREIGN A RECEIPT',
    issue_date:'2026-11-07',gross_amount:10,currency_code:'PHP',has_attachment:true}]});
  await assert.rejects(pending,/workspace changed/);
  assert.equal(workspaceChecks,1);
  assert.doesNotMatch(boxes['#mpdSaved'].innerHTML,/FOREIGN A RECEIPT|OLD A FILE LINK|\/71\/file/);
  assert.doesNotMatch(boxes['#mpdLinkable'].innerHTML,/OLD A PURCHASE LIST/);
  assert.match(boxes['#mpdSaved'].innerHTML,/Close and reopen/);
});

test('silent Merchant A to B switch during linkable GET hides private purchase names',async()=>{
  const begin=source.indexOf('  async function verifiedMerchantRead(');
  const end=source.indexOf('\n  function readFile(',begin);
  const boxes={'#mpdSaved':{innerHTML:'OLD PRIVATE A RECEIPT'},
    '#mpdLinkable':{innerHTML:'OLD PRIVATE A STOCK',querySelectorAll:()=>[]}},panel={};
  let selected=14,release,checks=0;
  const api=path=>{
    if(path==='/api/accounting/workspaces'){
      checks++;return Promise.resolve({role:'merchant',active_business_id:selected});
    }
    if(path==='/api/procurement/purchase-documents/linkable-purchases?business_id=14')
      return new Promise(resolve=>{release=resolve});
    throw Error('Unexpected private URL '+path);
  };
  const ui=new Function('api','panel','boxes',`
    const ROOT='/api/procurement/purchase-documents';
    let overlay=panel,businessId=14,archiveRequest=0,linkableRequest=0;
    const $=key=>boxes[key];const escape=v=>String(v);const currency=v=>String(v);
    ${source.slice(begin,end)}
    return{linkable};
  `)(api,panel,boxes);
  const pending=ui.linkable();selected=15;
  release({purchases:[{id:51,business_id:14,inventory_name:'PRIVATE A ITEM',
    total_cost:10,created_at:'2026-11-07',purchase_quantity:2,purchase_unit:'kg'}]});
  await assert.rejects(pending,/workspace changed/);
  assert.equal(checks,1);
  assert.doesNotMatch(boxes['#mpdLinkable'].innerHTML,/PRIVATE A ITEM|OLD PRIVATE A STOCK/);
  assert.doesNotMatch(boxes['#mpdSaved'].innerHTML,/OLD PRIVATE A RECEIPT/);
  assert.match(boxes['#mpdLinkable'].innerHTML,/Close and reopen/);
});

test('legitimate selected Merchant can still render archive and linkable purchases',async()=>{
  const begin=source.indexOf('  async function verifiedMerchantRead(');
  const end=source.indexOf('\n  function readFile(',begin);
  const boxes={'#mpdSaved':{innerHTML:''},
    '#mpdLinkable':{innerHTML:'',querySelectorAll:()=>[]}},panel={};
  let checked=0;
  const api=async path=>{
    if(path==='/api/accounting/workspaces'){
      checked++;return{role:'merchant',active_business_id:'14'};
    }
    if(path.includes('/linkable-purchases?'))return{purchases:[{id:51,business_id:14,
      inventory_name:'My sugar',total_cost:10,created_at:'2026-11-07',
      purchase_quantity:2,purchase_unit:'kg'}]};
    return{documents:[{id:71,business_id:14,document_kind:'invoice',issuer_name:'My receipt',
      issue_date:'2026-11-07',gross_amount:10,currency_code:'PHP',has_attachment:true}]};
  };
  const ui=new Function('api','panel','boxes',`
    const ROOT='/api/procurement/purchase-documents';
    let overlay=panel,businessId=14,archiveRequest=0,linkableRequest=0;
    const $=key=>boxes[key];const escape=v=>String(v);const currency=v=>String(v);
    ${source.slice(begin,end)}
    return{archive,linkable};
  `)(api,panel,boxes);
  await Promise.all([ui.archive(),ui.linkable()]);
  assert.equal(checked,2);
  assert.match(boxes['#mpdSaved'].innerHTML,/My receipt/);
  assert.match(boxes['#mpdLinkable'].innerHTML,/My sugar/);
});
