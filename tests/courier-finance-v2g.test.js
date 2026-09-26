import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const moneyCore=read('profile-money-core.js');
const financeCore=read('profile-finance-core.js');
const server=read('server-payments.js');
const ui=read('public/profile-money-ui.js');

test('Courier work-expense primitive is profile-scoped, delivery-linkable and reversible',()=>{
  assert.match(financeCore,/courier:\['fuel','maintenance','parking_toll','vehicle_insurance','mobile_data','equipment','other_work','adjustment'\]/);
  assert.match(financeCore,/source_types:r==='courier'\?\['manual','delivery'\]/);
  assert.match(financeCore,/FROM deliveries WHERE id=\$1 AND courier_account_id=\$2/);
  assert.match(financeCore,/evidence_reference TEXT NOT NULL DEFAULT ''/);
  assert.match(financeCore,/occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(financeCore,/profile_money_entry_reversed/);
  assert.match(financeCore,/UPDATE profile_money_entries SET status='reversed'/);
  assert.doesNotMatch(financeCore,/DELETE FROM profile_money_entries/);
});

test('Courier delivery rows derive compensation only from courier_net allocation evidence',()=>{
  const start=moneyCore.indexOf('export async function courierMoneySnapshot');
  const end=moneyCore.indexOf('async function serviceProviderPaymentEvidence',start);
  const block=moneyCore.slice(start,end);
  assert.match(block,/pa\.component_code='courier_net'/);
  assert.match(block,/pa\.economic_party_id=\$2/);
  assert.match(block,/`,\[Number\(accountId\),String\(accountId\)\]\)/);
  assert.match(block,/pa\.rule_snapshot->>'delivery_id'=d\.id::text/);
  assert.match(block,/pi\.source_type='order'/);
  assert.match(block,/pi\.source_id=d\.order_id/);
  assert.match(block,/pa\.settlement_status<>'reversed'/);
  assert.match(block,/courier_compensation/);
  assert.match(block,/courier_paid/);
  assert.match(block,/courier_eligible/);
});

test('Courier full Money response exposes only Courier-origin payout and withdrawal history',()=>{
  assert.match(server,/listProfileMoneyMovements\(pool,me\.account\.id\)/);
  assert.match(server,/role==='courier'/);
  assert.match(server,/m\.source_profile_role==='courier'/);
  assert.match(server,/\['payout','withdrawal'\]\.includes\(m\.movement_type\)/);
  assert.match(server,/payout_history:payoutHistory/);
});

test('Courier primary finance separates explicit compensation from recorded work expenses',()=>{
  assert.match(ui,/function courierTrackedGross/);
  assert.match(ui,/Gross compensation/);
  assert.match(ui,/Recorded courier_net allocations/);
  assert.match(ui,/Work expenses/);
  assert.match(ui,/ledger\.recorded_money_out/);
  assert.match(ui,/Net after recorded expenses/);
  assert.match(ui,/not provider balance/);
  assert.match(ui,/Customer charges — not earnings/);
  assert.match(ui,/No courier_net allocation yet/);
});

test('each Delivery keeps Customer charge context separate from Courier compensation evidence',()=>{
  const start=ui.indexOf('function courierRows');
  const end=ui.indexOf('function renderServices',start);
  const block=ui.slice(start,end);
  assert.match(block,/courier_allocation_count/);
  assert.match(block,/courier_compensation/);
  assert.match(block,/Customer delivery charge/);
  assert.match(block,/context only/);
  assert.match(block,/courier_net/);
  assert.match(block,/No courier_net evidence/);
});

test('Courier payout history is evidence-backed and never converts a pending provider request into paid cash',()=>{
  const start=ui.indexOf('function courierPayoutHistory');
  const end=ui.indexOf('function renderCourier',start);
  const block=ui.slice(start,end);
  assert.match(block,/payout_history/);
  assert.match(block,/x\.status==='succeeded'\?'Provider-confirmed':'Provider execution not confirmed'/);
  assert.match(block,/hold_code/);
  assert.match(block,/provider_reference/);
  assert.match(block,/Payout history/);
  assert.doesNotMatch(block,/pending_provider[^\n]{0,120}Provider-confirmed/);
});

test('provider-neutral payout requests remain HOLD until an execution adapter supplies evidence',()=>{
  assert.match(financeCore,/status TEXT NOT NULL DEFAULT 'pending_provider'/);
  assert.match(financeCore,/hold_code TEXT NOT NULL DEFAULT 'PROVIDER_MONEY_MOVEMENT_ADAPTER_NOT_CONNECTED'/);
  assert.match(financeCore,/provider_reference TEXT NOT NULL DEFAULT ''/);
  assert.match(financeCore,/evidence_reference TEXT NOT NULL DEFAULT ''/);
  assert.match(financeCore,/provider_money_moved:false/);
  assert.match(ui,/No payout or withdrawal requests yet/);
  assert.match(ui,/Money & Banking/);
});
