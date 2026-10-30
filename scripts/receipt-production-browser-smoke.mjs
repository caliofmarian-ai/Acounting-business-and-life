import assert from 'node:assert/strict';
import {chromium,request} from 'playwright';

const BASE='https://caliof.com';
const http=await request.newContext({ignoreHTTPSErrors:false,timeout:30000});
async function source(path,needle){
  const response=await http.get(BASE+path);
  assert.equal(response.status(),200,'Preview source HTTP 200: '+path);
  const data=await response.text();
  assert.ok(data.includes(needle),'Preview must serve receipt feature marker: '+needle);
  return data;
}
const vault=await source('/purchase-documents-ui.js','mpdFile');
const intelligence=await source('/receipt-intelligence-ui.js','receiptCountEvidenceButton');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const page=await context.newPage();
  page.on('pageerror',error=>{console.error('Browser page error:',error.message)});
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>'+
    '<body data-business-finance-role="merchant"><main id="viewStock"><h1>Inventory & purchases</h1></main>'+
    '<section id="countSessionReviewPane"><div id="countSessionReviewSummary">Reviewed count</div></section></body></html>');
  await page.evaluate(()=>{
    window.__requests=[];
    window.__documentRecords=[{id:1,issuer_name:'Test Market',issue_date:'2026-10-30',gross_amount:100,document_kind:'purchase_receipt',has_attachment:true}];
    window.fetch=async(url,options={})=>{
      const path=String(url),method=String(options.method||'GET').toUpperCase();
      window.__requests.push({method,path});
      const reply=(data,status=200)=>new Response(JSON.stringify(data),{
        status,headers:{'content-type':'application/json'}
      });
      if(path==='/api/accounting/workspaces')return reply({role:'merchant',active_business_id:5,businesses:[{id:5,name:'Synthetic Merchant'}]});
      if(path==='/api/procurement/purchase-documents/linkable-purchases?business_id=5')
        return reply({purchases:[]});
      if(path==='/api/procurement/purchase-documents?business_id=5')
        return reply({documents:window.__documentRecords});
      if(path==='/api/procurement/purchase-documents'&&method==='POST'){
        const payload=JSON.parse(options.body);
        window.__savedPayload=payload;
        const document={id:2,issuer_name:payload.issuer_name,issue_date:payload.issue_date,
          gross_amount:Number(payload.gross_amount),document_kind:payload.document_kind,has_attachment:true};
        window.__documentRecords=[...window.__documentRecords,document];
        return reply({document,already_saved:false},201);
      }
      if(path==='/api/procurement/receipt-intelligence/inventory?business_id=5')
        return reply({inventory:[{id:10,item:'Cooking oil',unit:'ml',sku:'OIL',barcode:''}]});
      if(path==='/api/procurement/receipt-intelligence/config?business_id=5')
        return reply({provider_available:false,manual_entry:true,stock_posting_enabled:false});
      if(path==='/api/procurement/purchase-documents/1/intelligence/duplicates?business_id=5')
        return reply({possible_duplicates:[]});
      if(path==='/api/procurement/purchase-documents/1/intelligence?business_id=5')
        return reply({error:'No saved draft yet'},404);
      if(path==='/api/procurement/purchase-documents/1/intelligence/manual'&&method==='POST'){
        const data=JSON.parse(options.body);
        const row=data.extraction.lines[0];
        return reply({draft:{
          id:77,version:1,status:'draft',
          extraction:{
            document_total:100,currency_code:'PHP',vendor_name:'Test Market',
            reconciliation:{status:'balanced',predicted_total:100},
            lines:[{line_index:0,description:row.description,raw_text:row.raw_text,
              quantity:1,unit:'L',line_total:100,confidence:null,flags:['LOW_CONFIDENCE']}],
            matches:[{line_index:0,suggested_inventory_id:10,needs_user_selection:true}]
          }
        }},201);
      }
      if(path==='/api/procurement/purchase-documents/1/intelligence/review'&&method==='POST'){
        window.__reviewRequest=JSON.parse(options.body);
        return reply({review:{status:'reviewed_pending_physical_receiving',stock_posted:false},already_saved:false});
      }
      if(path==='/api/procurement/purchase-documents/1/intelligence/receiving-readiness?business_id=5')
        return reply({preflight:{
          status:'ready_for_future_controlled_receiving',receipt_total:100,
          received_line_cost:100,issues:[],warnings:[],
          grouped_inventory_candidates:[{inventory_id:10,product_name:'Cooking oil',
            base_quantity:1000,base_unit:'ml',confirmed_line_cost:100}],can_post_stock:false,
          stock_posted:false
        }});
      if(path==='/api/inventory/count-sessions/active')
        return reply({id:123,business_id:5,status:'review'});
      if(path==='/api/procurement/receipt-intelligence/count-sessions/123/variance-evidence?business_id=5')
        return reply({count_session_id:123,session_status:'review',stock_posted:false,findings:[
          {inventory_id:10,name:'Cooking oil',unit:'ml',expected:2000,counted:1500,variance:-500,
            last_purchase:{id:101,quantity:1,unit:'L',total_cost:100,date:'2026-10-29'},
            receipt:{id:1,supplier:'Test Market',number:'R-1',date:'2026-10-30'}}
        ]});
      throw new Error('Unexpected synthetic receipt API route: '+method+' '+path);
    };
  });
  await page.addScriptTag({content:vault});
  await page.addScriptTag({content:intelligence});
  await page.locator('#merchantPurchaseDocumentsButton').waitFor();
  await page.locator('#receiptIntelligenceButton').waitFor();
  console.log('PASS mobile Merchant Inventory shows both action buttons at 390px');

  await page.locator('#merchantPurchaseDocumentsButton').click();
  await page.locator('#mpdFile').setInputFiles({
    name:'synthetic-receipt.png',mimeType:'image/png',
    buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64')
  });
  await page.locator('#mpdForm [name="issuer_name"]').fill('New Test Market');
  await page.locator('#mpdForm [name="gross_amount"]').fill('42.50');
  await page.locator('#mpdSave').click();
  await page.getByText('Purchase document saved securely.').waitFor();
  const payload=await page.evaluate(()=>window.__savedPayload);
  assert.equal(payload.business_id,5);
  assert.equal(payload.issuer_name,'New Test Market');
  assert.equal(payload.gross_amount,'42.50');
  assert.match(payload.data_url,/^data:image\/png;base64,/);
  assert.equal(payload.links.length,0);
  console.log('PASS Android-sized image selection + mocked Merchant archive POST; private original is a data URL only during upload');

  await page.locator('.mpdClose').click();
  await page.locator('#receiptIntelligenceButton').click();
  await page.locator('[data-ri-document="1"]').click();
  await page.locator('#riManual').waitFor();
  await page.locator('#riManual [name="vendor"]').fill('Test Market');
  await page.locator('#riManual [name="total"]').fill('100.00');
  await page.locator('.riManualLine [data-name]').fill('Cooking oil');
  await page.locator('.riManualLine [data-qty]').fill('1');
  await page.locator('.riManualLine [data-unit]').fill('L');
  await page.locator('.riManualLine [data-cost]').fill('100.00');
  await page.locator('#riManual [type="submit"]').click();
  await page.locator('#riReview').waitFor();
  await page.locator('[data-review-line="0"] [data-action]').selectOption('receive');
  await page.locator('[data-review-line="0"] [data-product]').selectOption('10');
  await page.locator('[data-review-line="0"] [data-physical]').fill('1');
  await page.locator('[data-review-line="0"] [data-verified-unit]').selectOption('L');
  await page.locator('[data-review-line="0"] [data-confirmed-cost]').fill('100.00');
  await page.locator('#riReview [type="submit"]').click();
  await page.getByText('Physical receiving preflight').waitFor();
  const decision=await page.evaluate(()=>window.__reviewRequest);
  assert.equal(decision.business_id,5);
  assert.equal(decision.decisions[0].inventory_id,10);
  assert.equal(decision.decisions[0].received_unit,'L');
  await page.getByText('Stock posting is disabled.',{exact:false}).waitFor();
  console.log('PASS editable manual transcription, explicit physical receiving review and non-posting preflight');

  await page.locator('.riClose').first().click();
  await page.locator('#receiptCountEvidenceButton').waitFor();
  await page.locator('#receiptCountEvidenceButton').click();
  await page.locator('#riEvidenceTitle').waitFor();
  await page.getByText('Count difference: -500 ml',{exact:false}).waitFor();
  const evidenceLink=await page.locator('#riEvidenceRows a').getAttribute('href');
  assert.equal(evidenceLink,'/api/procurement/purchase-documents/1/file?business_id=5');
  await page.locator('#countSessionReviewPane').evaluate(el=>el.classList.add('hidden'));
  await page.waitForFunction(()=>!document.querySelector('#riEvidenceTitle'));
  const requests=await page.evaluate(()=>window.__requests);
  assert.ok(!requests.some(x=>/\/api\/inventory\/purchase/.test(x.path)));
  assert.ok(!requests.some(x=>/\/api\/inventory\/count-sessions\/.*\/post/.test(x.path)));
  console.log('PASS count Review evidence only, hidden during counting, no Inventory/Accounting mutations');

  const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  assert.ok(width.scroll<=width.viewport+3,'Mobile page overflow '+JSON.stringify(width));
  console.log('PASS Android viewport no horizontal overflow in isolated receipt UI');

  await context.close();
}finally{
  await browser.close();
  await http.dispose();
}
