const assert = require('node:assert/strict');
const { test } = require('node:test');
const { canTransition, assertTransition } = require('../src/domain/parcels/state-machine');
const { priceBooking, getPricingConfig } = require('../src/domain/finance/pricing');
const { assertPoisha, formatBdt } = require('../src/domain/finance/money');
const { eligibleForPayout } = require('../src/domain/finance/payout-eligibility');
const { hashRequest, validateIdempotencyKey } = require('../src/domain/shared/idempotency');
const { dhakaDayStart } = require('../src/domain/shared/datetime');
const { assertExactCollection, handoverMatches, assertPayoutAction, assertCodPayableReversal } = require('../src/domain/finance/settlement-rules');
const { checkBranchScope } = require('../src/domain/parcels/service');

test('parcel state machine allows only valid role-specific forward transitions', () => {
  assert.equal(canTransition({ from: 'Processing', to: 'Booked', role: 'operations' }), true);
  assert.equal(canTransition({ from: 'Booked', to: 'Picked Up', role: 'rider' }), true);
  assert.equal(canTransition({ from: 'Picked Up', to: 'In Transit', role: 'rider' }), false);
  assert.equal(canTransition({ from: 'Delivered', to: 'Out for Delivery', role: 'admin' }), false);
  assert.throws(() => assertTransition({ from: 'Processing', to: 'In Transit', role: 'admin' }), { code: 'INVALID_TRANSITION' });
});

test('booking pricing snapshots are deterministic integer poisha', () => {
  const config = getPricingConfig({ DELIVERY_FEE_SAME_BRANCH_POISHA: '6000', DELIVERY_FEE_INTER_BRANCH_POISHA: '10000', COD_FEE_BASIS_POINTS: '100' });
  assert.deepEqual(priceBooking({ codAmountPoisha: 100000, isInterBranch: true, config }), {
    currency: 'BDT', deliveryFeePoisha: 10000, codAmountPoisha: 100000,
    codFeeBasisPoints: 100, codFeePoisha: 1000, merchantNetPoisha: 89000
  });
  assert.deepEqual(priceBooking({ codAmountPoisha: 0, isInterBranch: false, config }), {
    currency: 'BDT', deliveryFeePoisha: 6000, codAmountPoisha: 0,
    codFeeBasisPoints: 100, codFeePoisha: 0, merchantNetPoisha: 0
  });
  assert.throws(() => priceBooking({ codAmountPoisha: -1, isInterBranch: false, config }), { code: 'INVALID_MONEY' });
  assert.throws(() => priceBooking({ codAmountPoisha: 1.25, isInterBranch: false, config }), { code: 'INVALID_MONEY' });
  assert.match(formatBdt(10000), /100/);
});

test('payout eligibility requires delivered COD and reconciled cash', () => {
  const parcel = { status: 'Delivered', paymentType: 'COD', cod: { status: 'reconciled' }, priceSnapshot: { merchantNetPoisha: 89000 } };
  assert.equal(eligibleForPayout(parcel), true);
  assert.equal(eligibleForPayout({ ...parcel, cod: { status: 'collected' } }), false);
  assert.equal(eligibleForPayout({ ...parcel, status: 'Out for Delivery' }), false);
  assert.equal(eligibleForPayout({ ...parcel, priceSnapshot: { merchantNetPoisha: 0 } }), false);
});

test('idempotency request hashes ignore object key order and keys are validated', () => {
  assert.equal(hashRequest({ a: 1, b: { c: 2 } }), hashRequest({ b: { c: 2 }, a: 1 }));
  assert.equal(validateIdempotencyKey('booking:request-0001'), true);
  assert.equal(validateIdempotencyKey('short'), false);
  assert.equal(validateIdempotencyKey('bad key with spaces'), false);
});

test('Dhaka day grouping begins at 18:00 UTC on the previous date', () => {
  assert.equal(dhakaDayStart(new Date('2026-10-28T20:00:00.000Z')).toISOString(), '2026-10-28T18:00:00.000Z');
  assert.equal(dhakaDayStart(new Date('2026-10-28T17:59:59.999Z')).toISOString(), '2026-10-27T18:00:00.000Z');
});

test('COD collection and cash reconciliation require exact verified amounts', () => {
  assert.equal(assertExactCollection(12500, 12500), true);
  assert.throws(() => assertExactCollection(12500, 12499), { code: 'COD_AMOUNT_MISMATCH' });
  assert.equal(handoverMatches(30000, 30000), true);
  assert.equal(handoverMatches(30000, 29999), false);
});

test('payout review and reversal require role, state, and external references', () => {
  assert.equal(assertPayoutAction({ action: 'approve', role: 'accounts', status: 'requested' }), true);
  assert.equal(assertPayoutAction({ action: 'mark-paid', role: 'accounts', status: 'approved', paymentReference: 'BANK-12345' }), true);
  assert.throws(() => assertPayoutAction({ action: 'mark-paid', role: 'accounts', status: 'approved' }), { code: 'PAYMENT_REFERENCE_REQUIRED' });
  assert.throws(() => assertPayoutAction({ action: 'reverse', role: 'accounts', status: 'paid', paymentReference: 'BANK-RET-9', note: 'Returned' }), { code: 'FORBIDDEN_SCOPE' });
  assert.throws(() => assertPayoutAction({ action: 'reverse', role: 'admin', status: 'paid', paymentReference: 'BANK-RET-9', note: 'Short' }), { code: 'REVERSAL_NOTE_REQUIRED' });
  assert.equal(assertPayoutAction({ action: 'reverse', role: 'admin', status: 'paid', paymentReference: 'BANK-RET-9', note: 'Returned funds confirmed' }), true);
});

test('operations and riders cannot cross their branch or assignment scope', () => {
  const parcel = { originBranchId: 'branch-a', destinationBranchId: 'branch-b', riderId: 'rider-1' };
  assert.doesNotThrow(() => checkBranchScope({ id: 'ops', role: 'operations', branchIds: ['branch-a'] }, parcel, 'In Transit'));
  assert.throws(() => checkBranchScope({ id: 'ops', role: 'operations', branchIds: ['branch-a'] }, parcel, 'At Destination Hub'), { code: 'FORBIDDEN_SCOPE' });
  assert.doesNotThrow(() => checkBranchScope({ id: 'rider-1', role: 'rider', branchIds: ['branch-a'] }, parcel, 'Picked Up'));
  assert.throws(() => checkBranchScope({ id: 'rider-2', role: 'rider', branchIds: ['branch-a'] }, parcel, 'Picked Up'), { code: 'FORBIDDEN_SCOPE' });
});

test('COD payable reversal requires admin reason and no active payout', () => {
  assert.equal(assertCodPayableReversal({ role: 'admin', entryType: 'cod_payable', note: 'Reconciliation correction confirmed', blockingPayout: false }), true);
  assert.throws(() => assertCodPayableReversal({ role: 'accounts', entryType: 'cod_payable', note: 'Correction recorded', blockingPayout: false }), { code: 'FORBIDDEN_SCOPE' });
  assert.throws(() => assertCodPayableReversal({ role: 'admin', entryType: 'payout_paid', note: 'Correction recorded', blockingPayout: false }), { code: 'INVALID_REVERSAL' });
  assert.throws(() => assertCodPayableReversal({ role: 'admin', entryType: 'cod_payable', note: 'Correction recorded', blockingPayout: true }), { code: 'PAYOUT_CONFLICT' });
});
