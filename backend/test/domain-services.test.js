const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMerchantBooking, transitionParcel, assignRider } = require('../src/domain/parcels/service');

const validId = '507f1f77bcf86cd799439001';

test('merchant booking validates idempotency before opening a transaction', async () => {
  await assert.rejects(
    createMerchantBooking({ actor: { id: validId, role: 'merchant' }, input: {}, idempotencyKey: 'short' }),
    { code: 'IDEMPOTENCY_KEY_REQUIRED', status: 400 }
  );
});

test('merchant booking rejects an invalid Bangladesh recipient number before persistence', async () => {
  await assert.rejects(
    createMerchantBooking({
      actor: { id: validId, role: 'merchant' },
      input: { recipientName: 'Receiver', recipientPhone: '12345' },
      idempotencyKey: 'booking-input-0001'
    }),
    { code: 'INVALID_RECIPIENT', status: 400 }
  );
});

test('delivery confirmation cannot bypass COD capture through parcel transitions', async () => {
  await assert.rejects(
    transitionParcel({ parcelId: validId, toStatus: 'Delivered', actor: { id: validId, role: 'admin' }, idempotencyKey: 'delivery-path-0001' }),
    { code: 'DELIVERY_CONFIRMATION_REQUIRED', status: 409 }
  );
});

test('delivery failure requires an auditable reason before persistence', async () => {
  await assert.rejects(
    transitionParcel({
      parcelId: validId, toStatus: 'Delivery Failed', note: 'No call',
      actor: { id: validId, role: 'rider' }, idempotencyKey: 'delivery-failure-0001'
    }),
    { code: 'DELIVERY_FAILURE_REASON_REQUIRED', status: 400 }
  );
});

test('rider assignment rejects malformed identifiers before persistence', async () => {
  await assert.rejects(
    assignRider({ parcelId: 'invalid', riderId: validId, actor: { id: validId, role: 'admin' }, idempotencyKey: 'assign-invalid-0001' }),
    { code: 'INVALID_ID', status: 400 }
  );
});
