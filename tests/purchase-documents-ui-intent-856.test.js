// #856/#883 — execute the literal Merchant purchase-document save controller with a
// minimal browser-form harness. All API calls are synthetic and have no live side effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/purchase-documents-ui.js',import.meta.url),'utf8');
const start=source.indexOf('  async function save(event){');
const end=source.indexOf('\n  function close(){',start);
assert.ok(start>=0&&end>start,'literal shipped save controller must be present');
const saveSource=source.slice(start,end);

function makeController(){
  const fields={document_kind:'purchase_receipt',issuer_name:'Market',issue_date:'2026-11-06',
    document_number:'',gross_amount:'30.00',note:''};
  const button={disabled:false};
  const form={elements:{issue_date:{value:''}},reset(){}};
  const receiptLabel={textContent:''};
  let selectedLinks=[];
  const panel={querySelectorAll:()=>selectedLinks.map(value=>({value}))};
  const messages=[],posts=[];
  let keys=0,workspaceIsMerchant=true,failPostOnce=false,failFileOnce=false;
  let workspaceChecks=0,changeDuringVerify=null,changeDuringRead=null;
  let failArchiveOnce=false,failLinkableOnce=false;
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
    if(failPostOnce){failPostOnce=false;throw new Error('Connection lost after submit');}
    return {already_saved:posts.length>1};
  };
  const FakeFormData=function(){this.get=name=>fields[name]??null};
  const fn=new Function('api','FormData','requestKey','today','message','archive','linkable','readFile',
    'form','button','receiptLabel','panel',
    `const ROOT='/api/procurement/purchase-documents';
      let overlay=panel,businessId=14,pendingKey=null,pendingPayload=null,
          pendingSubmitted=false,chosenFile=null,saveInProgress=false;
      const $=selector=>selector==='#mpdForm'?form:
        selector==='#mpdSave'?button:receiptLabel;
      ${saveSource}
      return {save,setFile:file=>{chosenFile=file},state:()=>({pendingKey,pendingPayload,pendingSubmitted})};`);
  const controller=fn(api,FakeFormData,()=>('purchase-intent-'+(++keys)),()=>fields.issue_date,
    (text,isError)=>messages.push({text,isError}),
    async()=>{if(failArchiveOnce){failArchiveOnce=false;throw new Error('Archive GET unavailable');}},
    async()=>{if(failLinkableOnce){failLinkableOnce=false;throw new Error('Purchase-link GET unavailable');}},
    async()=>{if(failFileOnce){failFileOnce=false;throw new Error('File read failed');}
      if(changeDuringRead){const change=changeDuringRead;changeDuringRead=null;await Promise.resolve();change();}
      return 'data:application/pdf;base64,JVBERi0xLjQK'},
    form,button,receiptLabel,panel);
  return{...controller,fields,posts,messages,
    failNextPost:()=>{failPostOnce=true},failNextFile:()=>{failFileOnce=true},
    failNextArchive:()=>{failArchiveOnce=true},failNextLinkable:()=>{failLinkableOnce=true},
    setWorkspaceRole:merchant=>{workspaceIsMerchant=merchant},keyCount:()=>keys,
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
  assert.equal(c.messages.at(-1).isError,false);
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
