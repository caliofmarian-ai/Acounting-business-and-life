import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePaymentTerms,
  dueDateForTerms,
  commercialPosition,
  returnCreditAmount
} from '../supplier-commercial-core.js';

test('Supplier terms support COD, standard net terms and bounded custom days',()=>{
  assert.deepEqual(normalizePaymentTerms({paymentTermCode:'NET_30',creditLimit:50000}),{
    payment_term_code:'net_30',custom_days:null,credit_limit:50000,currency_code:'PHP'
  });
  assert.equal(normalizePaymentTerms({paymentTermCode:'custom',customDays:21}).custom_days,21);
  assert.throws(()=>normalizePaymentTerms({paymentTermCode:'custom',customDays:400}),/between 0 and 365/);
});

test('due dates are deterministic from explicit terms',()=>{
  assert.equal(dueDateForTerms({issueDate:'2026-09-20',paymentTermCode:'net_30'}),'2026-10-20');
  assert.equal(dueDateForTerms({
    issueDate:'2026-09-20',receivedDate:'2026-09-22',paymentTermCode:'due_on_receipt'
  }),'2026-09-22');
  assert.equal(dueDateForTerms({issueDate:'2026-09-20',paymentTermCode:'custom',customDays:10}),'2026-09-30');
});

test('commercial position keeps PO, receiving, invoice, payment and credit separate',()=>{
  const p=commercialPosition({
    expectedTotal:1500,
    receivedTotal:1360,
    invoiceTotal:1360,
    paidAmount:500,
    confirmedCredits:160,
    earliestDueDate:'2026-09-15',
    asOfDate:'2026-09-20'
  });
  assert.equal(p.charge_basis_source,'invoice_evidence');
  assert.equal(p.net_liability,1200);
  assert.equal(p.outstanding,700);
  assert.equal(p.invoice_vs_received_variance,0);
  assert.equal(p.overdue,true);
});

test('commercial position falls back to physical receiving before PO commitment',()=>{
  const p=commercialPosition({expectedTotal:1500,receivedTotal:1200,paidAmount:200});
  assert.equal(p.charge_basis_source,'received_value');
  assert.equal(p.outstanding,1000);
});

test('overpayment after confirmed credit becomes supplier refund or credit due, not negative payable',()=>{
  const p=commercialPosition({
    receivedTotal:1000,invoiceTotal:1000,paidAmount:1000,confirmedCredits:200
  });
  assert.equal(p.outstanding,0);
  assert.equal(p.supplier_refund_or_credit_due,200);
});

test('return expected credit defaults to traceable cost evidence',()=>{
  assert.equal(returnCreditAmount({quantityBase:1000,unitCostBase:0.046}),46);
  assert.equal(returnCreditAmount({quantityBase:1000,unitCostBase:0.046,explicitExpectedCredit:50}),50);
});
