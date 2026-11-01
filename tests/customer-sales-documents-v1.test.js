import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  commercialOrderDocument,orderDocumentDigest,salesDocumentMessage,salesDocumentPrintHtml,
  privateCustomerSalesDocumentResponse,registerCustomerSalesDocumentRoutes,customerSalesDocumentInternals
} from '../customer-sales-documents.js';

const read=x=>readFileSync(new URL('../'+x,import.meta.url),'utf8');
const makeOrder=()=>({
  id:123,business_id:44,customer_account_id:81,
  business_name:'Shop & Market',
  order_number:'BL-20261030-00123',
  order_status:'completed',payment_status:'paid',
  payment_method:'cash',currency_code:'PHP',
  created_at:'2026-10-30T06:00:00Z',subtotal:'130.00',delivery_fee:'15.00',
  total:'145.00',paid_amount:'145.00',outstanding_amount:'0',
  items:[{id:1,name_snapshot:'Bread & eggs',quantity:'2',unit_price_snapshot:'65.00',line_total:'130.00'}]
});

test('Merchant-recorded payment has separate commercial label, not automatic fiscal authority',()=>{
  const x=commercialOrderDocument(makeOrder(),new Date('2026-10-30T08:00:00Z'));
  assert.equal(x.document_class,'payment_record');
  assert.equal(x.official_tax_invoice,false);
  assert.equal(x.fiscal_status,'internal_evidence');
  assert.equal(x.merchant_recorded_payment,145);
  assert.equal(x.amount_due,0);
  assert.equal(x.items.length,1);
  assert.match(x.disclaimer,/not a BIR-issued/i);
  const msg=salesDocumentMessage(x);
  assert.equal(msg.total,'145.00');
  assert.match(msg.item_summary,/Bread & eggs/);
  assert.match(msg.document_disclaimer,/not a BIR tax invoice/);
});

test('Merchant completed an unpaid order: show order summary, never paid',()=>{
  const x=commercialOrderDocument({
    ...makeOrder(),payment_status:'unpaid',paid_amount:0,outstanding_amount:145
  });
  assert.equal(x.document_class,'order_summary');
  assert.equal(x.merchant_recorded_payment,0);
  assert.equal(x.amount_due,145);
});

test('Cannot issue purchase document for a cancelled order or unfinalized unpaid order',()=>{
  assert.throws(()=>commercialOrderDocument({...makeOrder(),order_status:'cancelled'}),/Cancelled orders/);
  assert.throws(()=>commercialOrderDocument({...makeOrder(),order_status:'awaiting_payment',paid_amount:0,outstanding_amount:145}),/after recorded payment or order completion/);
  assert.throws(()=>commercialOrderDocument({...makeOrder(),customer_account_id:null}),/Customer account/);
});

test('Economic snapshot digest stays constant across document generation timestamps',()=>{
  const a=commercialOrderDocument(makeOrder(),new Date('2026-10-30T09:00:00Z'));
  const b=commercialOrderDocument(makeOrder(),new Date('2026-10-30T10:00:00Z'));
  assert.equal(orderDocumentDigest(a),orderDocumentDigest(b));
  const c=commercialOrderDocument({...makeOrder(),paid_amount:120,outstanding_amount:25});
  assert.notEqual(orderDocumentDigest(a),orderDocumentDigest(c));
});

test('Printable order and record timestamps use Asia/Manila and preserve date rollover',()=>{
  const snapshot=commercialOrderDocument(makeOrder(),new Date('2026-10-30T08:00:00.000Z'));
  const html=salesDocumentPrintHtml(snapshot);
  assert.match(html,/Order date: 30 Oct 2026, 14:00 PHT \(UTC\+08:00\)/);
  assert.match(html,/Record date: 30 Oct 2026, 16:00 PHT \(UTC\+08:00\)/);
  assert.doesNotMatch(html,/2026-10-30T06:00:00Z/);
  assert.equal(snapshot.created_at,'2026-10-30T06:00:00Z','immutable source time stays UTC');
  const nextDay=commercialOrderDocument({...makeOrder(),created_at:'2026-12-31T20:00:00Z'},
    new Date('2026-12-31T20:30:00Z'));
  assert.match(salesDocumentPrintHtml(nextDay),/Order date: 01 Jan 2027, 04:00 PHT/);
  const invalid=salesDocumentPrintHtml({...snapshot,created_at:'<script>alert(1)</script>'});
  assert.match(invalid,/Order date: Date unavailable/);
  assert.doesNotMatch(invalid,/<script>/);
});

test('Printable Customer document escapes untrusted Merchant and Inventory text',()=>{
  const x=commercialOrderDocument({
    ...makeOrder(),business_name:'<script>alert(1)</script>',
    items:[{...makeOrder().items[0],name_snapshot:'<img src=x onerror=alert(1)>'}]
  });
  const html=salesDocumentPrintHtml(x);
  assert.doesNotMatch(html,/<script>/);
  assert.doesNotMatch(html,/<img src=x/);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/&lt;img src=x/);
});

test('Merchant-only send and private Customer read must enforce order and business identity',()=>{
  const core=read('customer-sales-documents.js');
  const server=read('server-notifications.js');
  const notif=read('notification-core.js');
  assert.match(core,/profile_business_bindings b ON b.account_id=a.id AND b.role='merchant' AND b.status='active'/);
  assert.match(core,/JOIN business_memberships m/);
  assert.match(core,/a.active_role='merchant'/);
  assert.match(core,/Number\(document.customer_account_id\)===actor/);
  assert.match(core,/Number\(order.business_id\)!==businessId/);
  assert.match(core,/customer.rows\[0\].email_verified_at/);
  assert.match(core,/SELECT id FROM customer_sales_documents WHERE id=\$1 FOR UPDATE/);
  assert.match(core,/client_request_key/);
  assert.match(core,/queue_status='pending'/);
  assert.match(core,/queue_status='queued' AND created_at>NOW\(\)-INTERVAL '5 minutes'/);
  assert.match(core,/mandatory:true,emailDefault:true,pushDefault:false/);
  assert.match(core,/INSERT INTO customer_sales_documents/);
  assert.match(core,/not a BIR-issued/i);
  assert.match(server,/ensureCustomerSalesDocumentsSchema\(pool\)/);
  assert.match(server,/registerCustomerSalesDocumentRoutes/);
  assert.match(server,/order-sales-documents-ui.js/);
  assert.match(notif,/event_code==='order.billing_document'&&!account.rows\[0\]\?\.email_verified_at/);
});

test('Email is a notification event, not new sale/paid money',()=>{
  const core=read('customer-sales-documents.js');
  assert.doesNotMatch(core,/INSERT INTO (order_payments|transactions|orders)/);
  assert.doesNotMatch(core,/UPDATE orders SET/);
  const notifications=read('notification-core.js');
  assert.match(notifications,/\['order.billing_document','en-PH'/);
  assert.match(notifications,/\['order.billing_document','fil-PH'/);
});

test('Malformed economic evidence is rejected before snapshot, email, or print',()=>{
  const invalid=[null,undefined,true,NaN,Infinity,-Infinity,'','unavailable','Infinity','NaN',
    '0x10','1e3','0.001','145.005','-1','10000000000.00','01.00'];
  for(const field of ['paid_amount','outstanding_amount','total','subtotal','delivery_fee']){
    for(const value of invalid)
      assert.throws(()=>commercialOrderDocument({...makeOrder(),[field]:value}),
        /monetary evidence is invalid/,field+' = '+String(value));
  }
  for(const field of ['unit_price_snapshot','line_total']){
    for(const value of invalid)
      assert.throws(()=>commercialOrderDocument({...makeOrder(),
        items:[{...makeOrder().items[0],[field]:value}]}),
        /monetary evidence is invalid/,field+' = '+String(value));
  }
  assert.throws(()=>commercialOrderDocument({...makeOrder(),paid_amount:'145.01',outstanding_amount:'0'}),
    /monetary evidence is inconsistent/);
  assert.throws(()=>commercialOrderDocument({...makeOrder(),paid_amount:'120',outstanding_amount:'0'}),
    /monetary evidence is inconsistent/);
  const snapshot=commercialOrderDocument(makeOrder());
  for(const field of ['total','merchant_recorded_payment','amount_due','subtotal','delivery_fee']){
    const damaged={...snapshot,[field]:'not-a-number'};
    assert.throws(()=>salesDocumentPrintHtml(damaged),/monetary evidence is invalid/);
    if(['total','merchant_recorded_payment','amount_due'].includes(field))
      assert.throws(()=>salesDocumentMessage(damaged),/monetary evidence is invalid/);
  }
});

test('Exact-cent full, partial, unpaid and zero-cost completed orders remain non-fiscal',()=>{
  const unpaid=commercialOrderDocument({...makeOrder(),paid_amount:'0.00',
    outstanding_amount:'145.00',payment_status:'unpaid'});
  assert.equal(unpaid.document_class,'order_summary');
  const partial=commercialOrderDocument({...makeOrder(),paid_amount:'70.05',
    outstanding_amount:'74.95',payment_status:'partial'});
  assert.equal(partial.document_class,'payment_record');
  assert.equal(partial.merchant_recorded_payment,70.05);
  assert.equal(partial.amount_due,74.95);
  assert.equal(salesDocumentMessage(partial).paid,'70.05');
  assert.equal(commercialOrderDocument(makeOrder()).merchant_recorded_payment,145);
  const zero=commercialOrderDocument({...makeOrder(),subtotal:'0.00',delivery_fee:'0.00',
    total:'0.00',paid_amount:'0.00',outstanding_amount:'0.00',
    items:[{...makeOrder().items[0],unit_price_snapshot:'0.00',line_total:'0.00'}]});
  assert.equal(zero.document_class,'order_summary');
  assert.equal(zero.total,0);
});


test('Order item quantities preserve NUMERIC(12,3) values without coercion or precision loss',()=>{
  for(const valid of ['2','0.125',0.125,'999999999.999']){
    const snapshot=commercialOrderDocument({...makeOrder(),
      items:[{...makeOrder().items[0],quantity:valid}]});
    assert.equal(snapshot.items[0].quantity,Number(valid));
  }
  for(const invalid of [null,undefined,true,false,NaN,Infinity,'',' 2 ','0x10','1e3',
    '+2','01.000','0','0.000','0.0001','1.0000','1000000000','-1',[],{}]){
    assert.throws(()=>commercialOrderDocument({...makeOrder(),
      items:[{...makeOrder().items[0],quantity:invalid}]}),
    /Order quantity evidence is invalid/,'quantity = '+String(invalid));
  }
});

test('Receipt idempotency keys never truncate or coerce into an existing retry key',async()=>{
  let dbReads=0;
  const run=documentRouteHarness({
    identity:async()=>({account:{id:81}}),
    pool:{query:async()=>{dbReads++;throw Error('Merchant database gate reached')}}
  });
  for(const invalid of ['a'.repeat(101),'a'.repeat(100)+'b',123456789012345,{}]){
    const result=await run('/orders/123/send',{params:{id:'123'},
      body:{business_id:44,client_request_key:invalid}});
    assert.equal(result.error?.status,400);
    assert.match(result.error?.message||'',/client_request_key/);
    assert.equal(result.response,null);
  }
  assert.equal(dbReads,0,'invalid keys must not initiate business reads');
  const valid=await run('/orders/123/send',{params:{id:'123'},
    body:{business_id:44,client_request_key:'a'.repeat(100)}});
  assert.match(valid.error?.message||'',/Merchant database gate reached/);
  assert.equal(dbReads,1,'a valid 100-character key reaches authorization');
});

test('All signed-in document endpoints are no-store and conditional GETs cannot 304',()=>{
  const routes={use:[],get:[],post:[]};
  const app={
    use:(path,fn)=>routes.use.push({path,fn}),
    get:(path,...handlers)=>routes.get.push({path,handlers}),
    post:(path,...handlers)=>routes.post.push({path,handlers})
  };
  registerCustomerSalesDocumentRoutes({app,pool:{},body:()=>{},identity:()=>{}});
  assert.equal(routes.use.length,1);
  assert.equal(routes.use[0].path,'/api/notifications/order-sales-documents');
  assert.equal(routes.use[0].fn,privateCustomerSalesDocumentResponse);
  assert.equal(routes.get.length,5);
  assert.equal(routes.post.length,1);
  const headers={},vary=[];
  const req={headers:{'if-none-match':'W/"old-private-body"',
    'if-modified-since':'Fri, 30 Oct 2026 00:00:00 GMT'}};
  const res={set(obj){Object.assign(headers,obj);return this},
    vary(name){vary.push(name);return this}};
  let called=0;
  privateCustomerSalesDocumentResponse(req,res,()=>{called++});
  assert.equal(called,1);
  assert.equal(headers['Cache-Control'],'private, no-store, max-age=0');
  assert.equal(headers['Pragma'],'no-cache');
  assert.equal(headers['X-Content-Type-Options'],'nosniff');
  assert.deepEqual(vary,['Cookie','Authorization']);
  assert.equal(req.headers['if-none-match'],undefined);
  assert.equal(req.headers['if-modified-since'],undefined);
});

function documentRouteHarness({pool,identity}){
  const registered={};
  const app={
    use(){},
    get:(path,...handlers)=>{registered[path]=handlers.at(-1)},
    post:(path,...handlers)=>{registered[path]=handlers.at(-1)}
  };
  registerCustomerSalesDocumentRoutes({app,pool,identity,body:(_req,_res,next)=>next()});
  return async (path,req={})=>{
    let error=null,response=null;
    const res={
      json(v){response=v;return this},
      send(v){response=v;return this},
      set(){return this},
      status(){return this},
      type(){return this}
    };
    const base='/api/notifications/order-sales-documents';
    const route=path.endsWith('/print')?'/:id/print'
      :/^\/orders\/\d+\/send$/.test(path)?'/orders/:id/send':'/:id';
    const handler=registered[base+path]||registered[base+route];
    if(typeof handler!=='function')throw new Error('Missing document test route: '+path);
    await handler({headers:{},query:{},params:{id:'72'},...req},res,e=>{error=e});
    return{error,response};
  };
}
function heldQuery(){
  let started,release;
  return{
    started:new Promise(resolve=>{started=resolve}),
    wait:new Promise(resolve=>{release=resolve}),
    onRead:()=>started(),
    release:()=>release()
  };
}
test('Customer private list drops delayed data after account switch',async()=>{
  const hold=heldQuery();
  let identityCount=0;
  const run=documentRouteHarness({
    identity:async()=>({account:{id:++identityCount===1?81:82}}),
    pool:{query:async()=>{hold.onRead();await hold.wait;
      return{rows:[{id:72,order_id:123,business_id:44,customer_account_id:81,snapshot_json:{total:145}}]}}}
  });
  const pending=run('/my');
  await hold.started;
  hold.release();
  const result=await pending;
  assert.equal(result.error?.status,401);
  assert.equal(result.response,null);
  assert.equal(identityCount,2);
});
test('Merchant private lists reject permission revoked during database read',async()=>{
  for(const path of ['/business','/merchant-orders']){
    const hold=heldQuery();
    let permissionReads=0;
    const run=documentRouteHarness({
      identity:async()=>({account:{id:81}}),
      pool:{query:async sql=>{
        if(sql.includes('FROM accounts a')){
          return{rowCount:++permissionReads===1?1:0};
        }
        hold.onRead();await hold.wait;
        return{rows:[{id:72,order_id:123,business_id:44,customer_account_id:72,
          snapshot_json:{total:145}}]};
      }}
    });
    const pending=run(path,{query:{business_id:'44'}});
    await hold.started;
    hold.release();
    const result=await pending;
    assert.equal(result.error?.status,403,path);
    assert.equal(result.response,null,path);
    assert.equal(permissionReads,2,path);
  }
});
test('Document detail and printable view reject account changed mid read',async()=>{
  for(const path of ['/72','/72/print']){
    const hold=heldQuery();
    let identityCount=0;
    const run=documentRouteHarness({
      identity:async()=>({account:{id:++identityCount===1?81:82}}),
      pool:{query:async()=>{hold.onRead();await hold.wait;
        return{rowCount:1,rows:[{id:72,order_id:123,business_id:44,
          customer_account_id:81,snapshot_json:{order_number:'BL-123'}}]}}}
    });
    const pending=run(path);
    await hold.started;
    hold.release();
    const result=await pending;
    assert.equal(result.error?.status,401,path);
    assert.equal(result.response,null,path);
    assert.equal(identityCount,2,path);
  }
});
test('Merchant document detail/print recheck binding after slow private lookup',async()=>{
  for(const path of ['/72','/72/print']){
    let permissionReads=0;
    const run=documentRouteHarness({
      identity:async()=>({account:{id:81}}),
      pool:{query:async sql=>sql.includes('FROM accounts a')
        ?{rowCount:++permissionReads===1?1:0}
        :{rowCount:1,rows:[{id:72,order_id:123,business_id:44,
            customer_account_id:99,snapshot_json:{order_number:'BL-123'}}]}}
    });
    const result=await run(path);
    assert.equal(result.error?.status,403,path);
    assert.equal(result.response,null,path);
    assert.equal(permissionReads,2,path);
  }
});

function sendRevocationHarness({holdEmail=null,holdInsert=null,holdQueue=null,authorized=()=>true,account=()=>81,recipient=()=>({email:'verified@example.test',email_verified_at:'2026-10-30'})}={}){
  const state={permissions:0,identities:0,documentWrites:0,queueStarts:0,queuePendingMarks:0,recipientReads:0};
  const order=makeOrder(),snapshot=commercialOrderDocument(order);
  const pool={
    query:async sql=>{
      if(sql.includes('FROM accounts a'))
        return{rowCount:authorized(++state.permissions)?1:0};
      if(sql.includes('SELECT id FROM orders WHERE id='))
        return{rowCount:1,rows:[{id:order.id}]};
      if(sql.includes('SELECT o.*,b.name business_name'))
        return{rowCount:1,rows:[order]};
      if(sql.includes('FROM order_items'))
        return{rowCount:1,rows:order.items};
      if(sql.includes('FROM order_payments')||sql.includes('FROM order_status_events'))
        return{rowCount:0,rows:[]};
      if(sql.includes('SELECT email,email_verified_at FROM accounts')){
        if(holdEmail){holdEmail.onRead();await holdEmail.wait;}
        return{rowCount:1,rows:[recipient(++state.recipientReads)]};
      }
      if(sql.includes('INSERT INTO customer_sales_documents')){
        state.documentWrites++;
        if(holdInsert){holdInsert.onRead();await holdInsert.wait;}
        return{rowCount:1,rows:[{id:72,order_id:order.id,business_id:order.business_id,
          customer_account_id:order.customer_account_id,snapshot_json:snapshot}]};
      }
      if(sql.includes("UPDATE customer_sales_document_sends SET queue_status='queue_failed'")){
        state.queuePendingMarks++;
        return{rowCount:1};
      }
      throw Error('Unexpected SQL in send authorization test: '+sql.slice(0,100));
    },
    connect:async()=>{
      state.queueStarts++;
      if(!holdQueue)throw Error('Unauthorized email queue was reached');
      return{
        query:async sql=>{
          if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rowCount:0};
          if(sql.includes('FOR UPDATE')){
            holdQueue.onRead();await holdQueue.wait;
            return{rowCount:1,rows:[{id:72}]};
          }
          if(sql.includes('SELECT * FROM customer_sales_document_sends'))return{rowCount:0,rows:[]};
          if(sql.includes('SELECT id FROM customer_sales_document_sends'))return{rowCount:0,rows:[]};
          if(sql.includes('INSERT INTO customer_sales_document_sends'))return{
            rowCount:1,rows:[{id:501,sent_by_account_id:81,customer_account_id:81,
              queue_status:'pending',event_key:'test_event_501'}]
          };
          throw Error('Unexpected transactional SQL: '+sql.slice(0,100));
        },release(){}
      };
    }
  };
  const run=documentRouteHarness({pool,identity:async()=>({account:{id:account(++state.identities)}})});
  const send=()=>run('/orders/123/send',{params:{id:'123'},
    body:{business_id:44,client_request_key:'verified_send_12345'}});
  return{state,send};
}

test('Merchant receipt email revocation during verified-recipient read does not create or queue anything',async()=>{
  const hold=heldQuery();
  const {state,send}=sendRevocationHarness({holdEmail:hold,authorized:n=>n===1});
  const pending=send();
  await hold.started;
  hold.release();
  const result=await pending;
  assert.equal(result.error?.status,403);
  assert.equal(result.response,null);
  assert.equal(state.permissions,2);
  assert.equal(state.documentWrites,0);
  assert.equal(state.queueStarts,0);
});

test('Merchant receipt email account switch during recipient lookup refuses side effects',async()=>{
  const hold=heldQuery();
  const {state,send}=sendRevocationHarness({holdEmail:hold,account:n=>n===1?81:82});
  const pending=send();
  await hold.started;
  hold.release();
  const result=await pending;
  assert.equal(result.error?.status,401);
  assert.equal(result.response,null);
  assert.equal(state.identities,2);
  assert.equal(state.documentWrites,0);
  assert.equal(state.queueStarts,0);
});

test('Merchant receipt email revocation during document creation cannot enqueue mail',async()=>{
  const hold=heldQuery();
  const {state,send}=sendRevocationHarness({holdInsert:hold,authorized:n=>n<=2});
  const pending=send();
  await hold.started;
  hold.release();
  const result=await pending;
  assert.equal(result.error?.status,403);
  assert.equal(result.response,null);
  assert.equal(state.permissions,3);
  assert.equal(state.documentWrites,1);
  assert.equal(state.queueStarts,0);
});


test('Merchant revocation during locked email queue wait rejects dispatch and clears newly pending attempt',async()=>{
  const hold=heldQuery();
  let allowed=true;
  const {state,send}=sendRevocationHarness({holdQueue:hold,authorized:()=>allowed});
  const pending=send();
  await hold.started;
  allowed=false;
  hold.release();
  const result=await pending;
  assert.equal(result.error?.status,403);
  assert.equal(result.response,null);
  assert.equal(state.permissions,4);
  assert.equal(state.queueStarts,1);
  assert.equal(state.queuePendingMarks,1);
});

test('Account switch during locked send queue wait fails before emitting Customer email',async()=>{
  const hold=heldQuery();
  const {state,send}=sendRevocationHarness({holdQueue:hold,account:n=>n<=3?81:82});
  const pending=send();
  await hold.started;
  hold.release();
  const result=await pending;
  assert.equal(result.error?.status,401);
  assert.equal(result.response,null);
  assert.equal(state.identities,4);
  assert.equal(state.queueStarts,1);
  assert.equal(state.queuePendingMarks,1);
});

test('Recipient verification revoked during email queue row lock prevents dispatch',async()=>{
  const hold=heldQuery();
  let verified=true;
  const {state,send}=sendRevocationHarness({
    holdQueue:hold,
    recipient:()=>({email:'verified@example.test',email_verified_at:verified?'2026-10-30':null})
  });
  const pending=send();
  await hold.started;
  verified=false;
  hold.release();
  const result=await pending;
  assert.equal(result.error?.status,409);
  assert.match(result.error.message,/verified email changed/);
  assert.equal(result.response,null);
  assert.equal(state.recipientReads,4);
  assert.equal(state.queuePendingMarks,1);
});

test('Recipient email changed to another verified address during row lock prevents dispatch',async()=>{
  const hold=heldQuery();
  let email='verified@example.test';
  const {state,send}=sendRevocationHarness({
    holdQueue:hold,
    recipient:()=>({email,email_verified_at:'2026-10-30'})
  });
  const pending=send();
  await hold.started;
  email='new-verified@example.test';
  hold.release();
  const result=await pending;
  assert.equal(result.error?.status,409);
  assert.equal(result.response,null);
  assert.equal(state.recipientReads,4);
  assert.equal(state.queuePendingMarks,1);
});

test('Queued idempotency key cannot be replayed by another Merchant operator',async()=>{
  let emitted=0,rollbacks=0;
  const client={query:async sql=>{
    if(sql==='ROLLBACK'){rollbacks++;return{rowCount:0};}
    if(sql==='BEGIN'||sql==='COMMIT'||sql.includes('FOR UPDATE'))return{rowCount:0};
    if(sql.includes('SELECT * FROM customer_sales_document_sends'))return{
      rowCount:1,rows:[{id:501,sent_by_account_id:999,queue_status:'queued'}]
    };
    throw Error('Unexpected SQL: '+sql);
  },release(){}};
  const pool={connect:async()=>client};
  await assert.rejects(customerSalesDocumentInternals.queueDocument(pool,{
    document:{id:72,customer_account_id:81},actor:81,
    requestKey:'safe_replay_12345',authorize:async()=>{},emit:async()=>{emitted++;return 1;}
  }),e=>e.status===409&&/another Merchant operator/.test(e.message));
  assert.equal(emitted,0);
  assert.equal(rollbacks,1);
});

test('Already queued replay still requires fresh authorization after database lock',async()=>{
  let emitted=0,releaseCount=0;
  const client={query:async sql=>{
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.includes('FOR UPDATE'))return{rowCount:0};
    if(sql.includes('SELECT * FROM customer_sales_document_sends'))return{
      rowCount:1,rows:[{id:501,sent_by_account_id:81,queue_status:'queued'}]
    };
    throw Error('Unexpected SQL: '+sql);
  },release(){releaseCount++;}};
  const pool={connect:async()=>client};
  await assert.rejects(customerSalesDocumentInternals.queueDocument(pool,{
    document:{id:72,customer_account_id:81},actor:81,
    requestKey:'safe_replay_12345',
    authorize:async()=>{throw Object.assign(new Error('Merchant revoked'),{status:403})},
    emit:async()=>{emitted++;return 1;}
  }),e=>e.status===403);
  assert.equal(emitted,0);
  assert.equal(releaseCount,1);
});

function ambiguousDocumentQueue({failure}={}){
  const snapshot=commercialOrderDocument(makeOrder());
  const state={attempt:null,events:new Map(),downgrades:0,emissions:0};
  let auditFails=failure==='audit',emitFails=failure==='emit';
  const client={async query(sql,p=[]){
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rowCount:0};
    if(sql.includes('FOR UPDATE'))return{rowCount:1,rows:[{id:72}]};
    if(sql.includes('SELECT * FROM customer_sales_document_sends')){
      const found=state.attempt?.client_request_key===p[1];
      return{rowCount:found?1:0,rows:found?[{...state.attempt}]:[]};
    }
    if(sql.includes('SELECT id FROM customer_sales_document_sends')){
      assert.match(sql,/queue_status='pending'/);
      assert.match(sql,/queue_status='queued' AND created_at>NOW\(\)-INTERVAL '5 minutes'/);
      const age=Date.now()-Date.parse(state.attempt?.created_at||new Date().toISOString());
      const pending=state.attempt&&(state.attempt.queue_status==='pending'||
        (state.attempt.queue_status==='queued'&&age<5*60*1000));
      return{rowCount:pending?1:0,rows:pending?[{id:501}]:[]};
    }
    if(sql.includes('INSERT INTO customer_sales_document_sends')){
      state.attempt={id:501,sent_by_account_id:81,customer_account_id:81,
        client_request_key:p[3],event_key:p[4],queue_status:'pending',
        created_at:new Date().toISOString()};
      return{rowCount:1,rows:[{...state.attempt}]};
    }
    throw Error('Unexpected transaction SQL: '+sql.slice(0,90));
  },release(){}};
  const pool={connect:async()=>client,async query(sql,p=[]){
    if(sql.includes('SET queue_status=$1')){
      if(auditFails){auditFails=false;throw Error('audit UPDATE failed after event COMMIT')}
      state.attempt.queue_status=p[0];state.attempt.notification_event_id=p[1];
      return{rowCount:1};
    }
    if(sql.includes("SET queue_status='queue_failed'")){
      state.downgrades++;state.attempt.queue_status='queue_failed';
      return{rowCount:1};
    }
    throw Error('Unexpected audit SQL: '+sql.slice(0,90));
  }};
  const send=key=>customerSalesDocumentInternals.queueDocument(pool,{
    document:{id:72,order_id:123,customer_account_id:81,snapshot_json:snapshot},
    actor:81,requestKey:key,authorize:async()=>{},
    emit:async(_pool,{eventKey})=>{
      state.emissions++;
      const id=state.events.get(eventKey)??901;
      state.events.set(eventKey,id); // committed event simulated
      if(emitFails){emitFails=false;throw Error('lost connection after event COMMIT')}
      return id;
    }
  });
  return{state,send};
}

test('Committed email event survives failed audit UPDATE without duplicate dispatch',async()=>{
  const {state,send}=ambiguousDocumentQueue({failure:'audit'});
  await assert.rejects(send('audit_retry_key_12345'),e=>e.status===503&&/same request key/.test(e.message));
  assert.equal(state.attempt.queue_status,'pending');
  assert.equal(state.downgrades,0);
  state.attempt.created_at=new Date(Date.now()-10*60*1000).toISOString();
  await assert.rejects(send('different_key_12345'),e=>e.status===429);
  assert.equal(state.events.size,1);
  const retry=await send('audit_retry_key_12345');
  assert.equal(retry.attempt.queue_status,'queued');
  assert.equal(state.events.size,1);
  assert.equal(state.downgrades,0);
});

test('Unknown emitter COMMIT result retains pending status for idempotent retry',async()=>{
  const {state,send}=ambiguousDocumentQueue({failure:'emit'});
  await assert.rejects(send('commit_retry_key_12345'),e=>e.status===503&&/same request key/.test(e.message));
  assert.equal(state.attempt.queue_status,'pending');
  assert.equal(state.downgrades,0);
  assert.equal(state.events.size,1);
  const retry=await send('commit_retry_key_12345');
  assert.equal(retry.attempt.queue_status,'queued');
  assert.equal(state.events.size,1);
  assert.equal(state.emissions,2);
});


let emailRetryFixtureCounter=0;
function emailRetryUiHarness(storage,{account=81,business=44,failOnce=false,role='merchant'}={}){
  const src=read('public/order-sales-documents-ui.js');
  const first=src.indexOf('  const pendingEmailKeys=new Map();');
  const last=src.indexOf('  async function open(view){',first);
  assert.ok(first>=0&&last>first,'execute real document-email client retry/send functions');
  const chunk=src.slice(first,last);
  const messages=[],posts=[],panel={};
  const sessionStorage={
    getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),
    removeItem:k=>storage.delete(k)
  };
  const crypto={getRandomValues(bytes){
    const seq=++emailRetryFixtureCounter;
    bytes.fill(0);bytes[12]=(seq>>>24)&255;bytes[13]=(seq>>>16)&255;
    bytes[14]=(seq>>>8)&255;bytes[15]=seq&255;
    return bytes;
  }};
  const api=async(path,init={})=>{
    if(path==='/api/accounting/workspaces')return{role,active_business_id:business};
    if(path==='/api/me')return{account:{id:account}};
    assert.ok(path.endsWith('/orders/123/send'),'unexpected email endpoint');
    assert.equal(init.method,'POST');
    posts.push(JSON.parse(init.body));
    if(failOnce){failOnce=false;throw new Error('Email queue result uncertain; retry the same request key')}
    return{already_queued:false,delivery_status:'queued'};
  };
  const make=new Function('api','modal','activeBusiness','sessionStorage','crypto','setMessage','merchant',
    "const globalThis={crypto};const API='/api/notifications/order-sales-documents';"+chunk+';return send;');
  const send=make(api,panel,business,sessionStorage,crypto,(v,bad)=>messages.push({v,bad}),async()=>{});
  return{send:()=>send(123,{disabled:false}),posts,messages};
}
test('ambiguous email send reuses same key after UI reload, then clears only on acknowledged result',async()=>{
  const storage=new Map();
  const first=emailRetryUiHarness(storage,{failOnce:true});
  await first.send();
  assert.equal(first.posts.length,1);
  assert.equal(storage.size,1);
  const restored=emailRetryUiHarness(storage);
  await restored.send();
  assert.equal(restored.posts[0].client_request_key,first.posts[0].client_request_key);
  assert.equal(storage.size,0);
  assert.match(restored.messages.at(-1).v,/Email queued/);
});
test('a completed email queue request permits a distinct key for a later deliberate resend',async()=>{
  const storage=new Map(),h=emailRetryUiHarness(storage);
  await h.send();await h.send();
  assert.equal(h.posts.length,2);
  assert.notEqual(h.posts[0].client_request_key,h.posts[1].client_request_key);
  assert.equal(storage.size,0);
});
test('pending email retry identities are isolated across accounts/businesses',async()=>{
  const storage=new Map();
  const a=emailRetryUiHarness(storage,{account:81,business:44,failOnce:true});
  const b=emailRetryUiHarness(storage,{account:82,business:44,failOnce:true});
  const c=emailRetryUiHarness(storage,{account:81,business:45,failOnce:true});
  await a.send();await b.send();await c.send();
  assert.equal(storage.size,3);
  assert.equal(new Set([a,b,c].map(h=>h.posts[0].client_request_key)).size,3);
  const recovered=emailRetryUiHarness(storage,{account:81,business:44});
  await recovered.send();
  assert.equal(recovered.posts[0].client_request_key,a.posts[0].client_request_key);
  assert.equal(storage.size,2);
});
test('non-Merchant workspace cannot queue a document or create a retry key',async()=>{
  const storage=new Map(),h=emailRetryUiHarness(storage,{role:'customer'});
  await h.send();
  assert.equal(h.posts.length,0);
  assert.equal(storage.size,0);
  assert.match(h.messages.at(-1).v,/Merchant business changed/);
});
