import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  normalizeInventoryCountScope,
  serializeInventoryCountSession
} from '../inventory-count-sessions.js';

const runtime=readFileSync(new URL('../inventory-count-sessions.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/inventory-count-ui.js',import.meta.url),'utf8');
const v03=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');

test('count scope supports full inventory and bounded cycle-count scopes',()=>{
  const types=new Set(['ingredient','packaging']);
  assert.deepEqual(normalizeInventoryCountScope({count_type:'full'},types),{
    count_type:'full',scope_type:'all',scope_value:''
  });
  assert.deepEqual(normalizeInventoryCountScope({
    count_type:'cycle',scope_type:'inventory_type',scope_value:'ingredient'
  },types),{
    count_type:'cycle',scope_type:'inventory_type',scope_value:'ingredient'
  });
  assert.throws(()=>normalizeInventoryCountScope({
    count_type:'cycle',scope_type:'inventory_type',scope_value:'unknown'
  },types),/valid Inventory category/);
});

test('blind in-progress session never exposes expected quantity or variance',()=>{
  const base={id:8,business_id:3,count_type:'full',scope_type:'all',scope_value:'',status:'in_progress'};
  const items=[{
    inventory_id:11,item:'Rice',inventory_type:'ingredient',storage_area_type:'pantry',
    storage_condition:'dry',storage_location_label:'',unit_snapshot:'g',
    expected_quantity:'1000',counted_quantity:'950'
  }];
  const hidden=serializeInventoryCountSession(base,items);
  assert.equal(hidden.reveal_expected,false);
  assert.equal(Object.hasOwn(hidden.items[0],'expected_quantity'),false);
  assert.equal(Object.hasOwn(hidden.items[0],'variance_quantity'),false);

  const reviewed=serializeInventoryCountSession({...base,status:'review'},items);
  assert.equal(reviewed.reveal_expected,true);
  assert.equal(reviewed.items[0].expected_quantity,1000);
  assert.equal(reviewed.items[0].variance_quantity,-50);
});

test('count sessions persist business actor time progress and adjustment evidence',()=>{
  assert.match(runtime,/CREATE TABLE IF NOT EXISTS inventory_count_sessions/);
  assert.match(runtime,/business_id BIGINT NOT NULL REFERENCES businesses/);
  assert.match(runtime,/actor_account_id BIGINT REFERENCES accounts/);
  assert.match(runtime,/reviewed_by_account_id BIGINT REFERENCES accounts/);
  assert.match(runtime,/posted_by_account_id BIGINT REFERENCES accounts/);
  assert.match(runtime,/started_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(runtime,/CREATE TABLE IF NOT EXISTS inventory_count_session_items/);
  assert.match(runtime,/posted_adjustment_id BIGINT REFERENCES inventory_adjustments/);
  assert.match(runtime,/inventory_count_sessions_one_active_per_business/);
});

test('saving physical counts is resumable and does not mutate Inventory',()=>{
  const start=runtime.indexOf("app.put('/api/inventory/count-sessions/:id/items/:inventoryId'");
  const end=runtime.indexOf("app.post('/api/inventory/count-sessions/:id/review'",start);
  assert.ok(start>=0&&end>start);
  const block=runtime.slice(start,end);
  assert.match(block,/SET counted_quantity=\$1,counted_by_account_id=\$2,counted_at=NOW\(\)/);
  assert.match(block,/status!=='in_progress'/);
  assert.doesNotMatch(block,/UPDATE inventory SET/);
  assert.doesNotMatch(block,/INSERT INTO inventory_adjustments/);
});

test('review reveals expected stock only after every item has been counted',()=>{
  const start=runtime.indexOf("app.post('/api/inventory/count-sessions/:id/review'");
  const end=runtime.indexOf("app.post('/api/inventory/count-sessions/:id/resume'",start);
  const block=runtime.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(block,/counted_quantity IS NULL/);
  assert.match(block,/Count every item before reviewing expected stock and variances/);
  assert.match(block,/SET status='review'/);
});

test('posting is idempotent, stale-safe and writes count corrections through lot reconciliation',()=>{
  const start=runtime.indexOf("app.post('/api/inventory/count-sessions/:id/post'");
  assert.ok(start>=0);
  const block=runtime.slice(start);
  assert.match(block,/status==='posted'/);
  assert.match(block,/idempotent:true/);
  assert.match(block,/current_quantity/);
  assert.match(block,/expected_quantity/);
  assert.match(block,/Inventory changed after this count started/);
  assert.match(block,/order_stock_reservations/);
  assert.match(block,/stock reserved for an active order/);
  assert.match(block,/Approve every variance or return to counting before posting/);
  assert.match(block,/planPhysicalStockReduction/);
  assert.match(block,/mode:'count'/);
  assert.match(block,/applyPhysicalLotReductions/);
  assert.match(block,/INSERT INTO inventory_adjustments/);
  assert.match(block,/'count_correction'/);
  assert.match(block,/inventory_adjustment_lot_allocations/);
  assert.match(block,/accounting_effect:'inventory_only_no_cash_movement'/);
  assert.doesNotMatch(block,/INSERT INTO transactions/);
});

test('accounting runtime initializes and registers count-session routes',()=>{
  assert.match(server,/ensureInventoryCountSessionSchema\(pool\)/);
  assert.match(server,/registerInventoryCountSessionRoutes\(app/);
  assert.match(server,/inventoryTypes:INVENTORY_TYPES/);
  assert.match(server,/planPhysicalStockReduction/);
});

test('Merchant Inventory exposes the mobile guided count flow',()=>{
  for(const id of [
    'guidedCountCard','countSessionType','countSessionScopeType','countSessionScopeValue',
    'countSessionItemPicker','countSessionQuantity','countSessionSaveItem',
    'countSessionReviewBtn','countSessionReviewList','countSessionResumeBtn','countSessionPostBtn'
  ])assert.match(html,new RegExp(`id=["']${id}["']`));
  assert.match(html,/Guided inventory count/);
  assert.match(html,/Expected stock stays hidden while you count/);
  assert.match(ui,/\/api\/inventory\/count-sessions\/active/);
  assert.match(ui,/Save item and continue|saveItem/);
  assert.match(ui,/Review every variance before posting/);
  assert.match(ui,/approved_inventory_ids/);
  assert.match(v03,/createInventoryCountUi/);
  assert.match(v03,/inventoryCountUi\.load\(\)/);
});
