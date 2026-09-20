import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');

test('Supplier experience wave is registered on the isolated QA runner',()=>{
  assert.match(source,/SUPPLIER_ALIAS='dropi\.deliveries\+testsupplier@gmail\.com'/);
  assert.match(source,/SUPPLIER_EXPERIENCE_WAVE='supplier_experience_v1'/);
  assert.match(source,/runSupplierExperienceAcceptance/);
  assert.match(source,/config\.wave===SUPPLIER_EXPERIENCE_WAVE/);
});

test('Supplier acceptance uses invite-first governed onboarding',()=>{
  assert.match(source,/\/api\/governance\/admin\/invitations/);
  assert.match(source,/role:'supplier'/);
  assert.match(source,/\/api\/governance\/invitations\/\$\{invitationId\}\/accept/);
  assert.match(source,/Supplier application is not backed by an invitation/);
  assert.match(source,/\/api\/governance\/admin\/applications\/\$\{Number\(application\.id\)\}\/review/);
});

test('Supplier acceptance covers procurement, finance, notifications, Support and session recovery',()=>{
  for(const marker of [
    '/api/supplier/catalog',
    '/api/procurement/relationships/invite',
    '/api/supplier/relationships/',
    '/api/procurement/orders',
    '/api/supplier/orders/',
    '/api/accounting/finance-overview',
    '/api/settings/finance',
    'procurement.po_created',
    'procurement.po_updated',
    'procurement.payment_received',
    'supplier.relationship_invited',
    '/api/support/tickets',
    '/api/auth/logout'
  ]) assert.ok(source.includes(marker),'missing Supplier acceptance marker: '+marker);
  assert.match(source,/business_ledger_recorded_receipts/);
  assert.match(source,/account_level_po_paid_amount/);
  assert.match(source,/merchant_reconciliation:true/);
  assert.match(source,/live_online_payment:'HOLD_FOR_PAYMONGO_LIVE_GATE'/);
});
