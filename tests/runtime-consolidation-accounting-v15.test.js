import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const schema=read('accounting-base-schema.js');
const legacy=read('server-v03.js');
const accounting=read('server-business-accounting.js');
const auth=read('server-auth.js');
const qa=read('qa-acceptance.js');
const workflow=read('.github/workflows/admin-runtime.yml');
const pkg=JSON.parse(read('package.json'));

test('shared Accounting base schema owns table creation without owning HTTP',()=>{
  assert.match(schema,/export async function ensureLegacyAccountingBaseSchema\(pool\)/);
  for(const table of ['transactions','inventory','daily_openings','daily_closings','remittances','budgets','audit_events','products','recipes','product_sales','product_sale_ingredients']){
    assert.match(schema,new RegExp('CREATE TABLE IF NOT EXISTS '+table));
  }
  assert.doesNotMatch(schema,/express|app\.listen|createServer|http\.request/);
});

test('Multi-business Accounting bootstraps base schema before starting the lower runtime',()=>{
  assert.match(accounting,/ensureLegacyAccountingBaseSchema/);
  const schemaInit=accounting.indexOf('await ensureLegacyAccountingBaseSchema(pool)');
  const lowerStart=accounting.indexOf('profileGovernanceApp=await startEmbeddedProfileGovernance()');
  assert.ok(schemaInit>=0&&lowerStart>schemaInit,'Accounting base schema must exist before lower embedded modules start');
  assert.match(accounting,/await initAccountingTenancyDb\(\)/);
  for(const route of [
    "app.get('/api/summary'",
    "app.get('/api/transactions'",
    "app.post('/api/transactions'",
    "app.get('/api/inventory'",
    "app.post('/api/inventory'",
    "app.get('/api/products'",
    "app.post('/api/products'",
    "app.post('/api/product-sales'",
    "app.get('/api/export.csv'"
  ])assert.ok(accounting.includes(route),`missing canonical Accounting route: ${route}`);
});

test('Account/Auth no longer owns or starts a localhost Accounting boundary',()=>{
  assert.doesNotMatch(auth,/INTERNAL_ACCOUNTING_PORT/);
  assert.doesNotMatch(auth,/\|\|\s*3107/);
  assert.doesNotMatch(auth,/127\.0\.0\.1:3107/);
  assert.doesNotMatch(auth,/server-v03\.js/);
  assert.doesNotMatch(auth,/pipeToAccounting/);
  assert.doesNotMatch(auth,/accountingFetch/);
  assert.doesNotMatch(auth,/http\.request/);
  assert.doesNotMatch(auth,/spawn\(process\.execPath/);
  assert.doesNotMatch(auth,/const rawPayload=Buffer\.isBuffer\(req\.rawBody\)/);
  assert.match(auth,/legacy_accounting:'retired'/);
  assert.match(auth,/No Account\/Auth route owns this request/);
});

test('legacy V0.3 remains explicit standalone compatibility but shares schema ownership',()=>{
  assert.match(legacy,/ensureLegacyAccountingBaseSchema/);
  assert.match(legacy,/await ensureLegacyAccountingBaseSchema\(pool\)/);
  assert.match(legacy,/Accounting app v0\.3 listening on/);
  assert.doesNotMatch(auth,/server-v03\.js/);
});

test('Accounting Runtime V15 acceptance is wired into canonical QA',()=>{
  assert.match(qa,/ACCOUNTING_RUNTIME_V15_WAVE='accounting_runtime_v15'/);
  assert.match(qa,/runAccountingRuntimeV15Acceptance/);
  assert.match(qa,/config\.wave===ACCOUNTING_RUNTIME_V15_WAVE/);
  assert.match(qa,/legacy_port_3107_retired:true/);
  assert.match(qa,/transaction_audit:true/);
  assert.match(qa,/inventory_scope:true/);
  assert.match(qa,/product_recipe_sale:true/);
});

test('CI and Admin Runtime Contract watch the shared accounting schema',()=>{
  assert.match(pkg.scripts.check,/node --check accounting-base-schema\.js/);
  assert.equal((workflow.match(/- 'accounting-base-schema\.js'/g)||[]).length,2);
  assert.equal((workflow.match(/- 'server-business-accounting\.js'/g)||[]).length,2);
  assert.equal((workflow.match(/- 'server-auth\.js'/g)||[]).length,2);
});
