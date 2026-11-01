import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  commercialOrderDocument,orderDocumentDigest,salesDocumentMessage,salesDocumentPrintHtml,
  privateCustomerSalesDocumentResponse,registerCustomerSalesDocumentRoutes
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
  assert.throws(()=>commercialOrderDocument({...makeOrder(),order_status:'awaiting_payment',paid_amount:0}),/after recorded payment or order completion/);
  assert.throws(()=>commercialOrderDocument({...makeOrder(),customer_account_id:null}),/Customer account/);
});

test('Economic snapshot digest stays constant across document generation timestamps',()=>{
  const a=commercialOrderDocument(makeOrder(),new Date('2026-10-30T09:00:00Z'));
  const b=commercialOrderDocument(makeOrder(),new Date('2026-10-30T10:00:00Z'));
  assert.equal(orderDocumentDigest(a),orderDocumentDigest(b));
  const c=commercialOrderDocument({...makeOrder(),paid_amount:120,outstanding_amount:25});
  assert.notEqual(orderDocumentDigest(a),orderDocumentDigest(c));
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
  assert.match(core,/created_at>NOW\(\)-INTERVAL '5 minutes'/);
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
