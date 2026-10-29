const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { after, before, test } = require('node:test');

const User = require('../src/models/User');
const Branch = require('../src/models/Branch');
const MerchantProfile = require('../src/models/MerchantProfile');
const Parcel = require('../src/models/Parcel');
const ParcelEvent = require('../src/models/ParcelEvent');
const LedgerEntry = require('../src/models/LedgerEntry');
const Payout = require('../src/models/Payout');
const Migration = require('../src/models/Migration');
const { run: runMigrations } = require('../src/scripts/migrate');
const { createMerchantBooking, transitionParcel, assignRider } = require('../src/domain/parcels/service');
const { recordDelivery, submitCashHandover, reconcileCashHandover, requestPayout, decidePayout, reverseCodPayable } = require('../src/domain/finance/settlements');

const testMongoUri = process.env.TEST_MONGO_URI;
const testDatabaseName = `courier_integration_test_${process.pid}_${crypto.randomBytes(5).toString('hex')}`;

before(async () => {
  if (!testMongoUri) throw new Error('Set TEST_MONGO_URI to a MongoDB replica set reserved for integration tests. The suite uses a unique temporary database and drops only that database.');

  await mongoose.connect(testMongoUri, { dbName: testDatabaseName });
  const legacyUserId = new mongoose.Types.ObjectId();
  const legacyParcelId = new mongoose.Types.ObjectId();
  await User.collection.insertOne({
    _id: legacyUserId, name: 'Legacy fixture', email: `legacy-${testDatabaseName}@example.test`,
    password: 'not-a-login-password', role: 'customer', createdAt: new Date()
  });
  await Parcel.collection.insertOne({
    _id: legacyParcelId, customerId: legacyUserId, pickupAddress: 'Old pickup',
    deliveryAddress: 'Old delivery', parcelType: 'Legacy document', paymentType: 'COD',
    status: 'Delivered', createdAt: new Date()
  });

  await mongoose.disconnect();
  await runMigrations({ mongoUri: testMongoUri, connectionOptions: { dbName: testDatabaseName } });
  globalThis.integrationLegacyFixture = { userId: legacyUserId, parcelId: legacyParcelId };
});

after(async () => {
  try {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db?.databaseName === testDatabaseName) {
      await mongoose.connection.dropDatabase();
    }
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    delete globalThis.integrationLegacyFixture;
  }
});

test('isolated replica set applies migrations and carries a merchant parcel through verified payout reversal', async () => {
  const migration = await Migration.findOne({ name: '001-domain-foundation' }).lean();
  assert.ok(migration, 'migration ledger should record the applied migration');
  const legacyUser = await User.findById(globalThis.integrationLegacyFixture.userId).lean();
  const legacyParcel = await Parcel.findById(globalThis.integrationLegacyFixture.parcelId).lean();
  assert.equal(legacyUser.accountStatus, 'active');
  assert.equal(String(legacyParcel.merchantId), String(legacyUser._id));
  assert.equal(legacyParcel.cod.status, 'not_due');

  const [merchant, operations, accounts, rider, admin] = await User.create([
    { name: 'Synthetic Merchant', email: `merchant-${testDatabaseName}@example.test`, password: 'integration-only', role: 'merchant', accountStatus: 'active' },
    { name: 'Synthetic Operations', email: `ops-${testDatabaseName}@example.test`, password: 'integration-only', role: 'operations', accountStatus: 'active' },
    { name: 'Synthetic Accounts', email: `accounts-${testDatabaseName}@example.test`, password: 'integration-only', role: 'accounts', accountStatus: 'active' },
    { name: 'Synthetic Rider', email: `rider-${testDatabaseName}@example.test`, password: 'integration-only', role: 'rider', accountStatus: 'active' },
    { name: 'Synthetic Admin', email: `admin-${testDatabaseName}@example.test`, password: 'integration-only', role: 'admin', accountStatus: 'active' }
  ]);
  const [origin, destination] = await Branch.create([
    { code: `IT-O-${process.pid}`, name: 'Integration Origin', city: 'Dhaka', address: 'Synthetic origin' },
    { code: `IT-D-${process.pid}`, name: 'Integration Destination', city: 'Chattogram', address: 'Synthetic destination' }
  ]);
  const branchIds = [String(origin._id), String(destination._id)];
  await Promise.all([
    User.updateOne({ _id: operations._id }, { $set: { branchIds } }),
    User.updateOne({ _id: accounts._id }, { $set: { branchIds: [destination._id] } }),
    User.updateOne({ _id: rider._id }, { $set: { branchIds } }),
    MerchantProfile.create({ userId: merchant._id, businessName: 'Synthetic Store', contactName: merchant.name, phone: '01700000000', pickupAddress: 'Dhaka', defaultBranchId: origin._id, status: 'approved' })
  ]);
  const actor = (user, role = user.role, scopes = []) => ({ id: String(user._id), role, branchIds: scopes });
  const merchantActor = actor(merchant);
  const operationsActor = actor(operations, 'operations', branchIds);
  const accountsActor = actor(accounts, 'accounts', [String(destination._id)]);
  const riderActor = actor(rider, 'rider', branchIds);
  const adminActor = actor(admin);
  const bookingInput = {
    originBranchId: String(origin._id), destinationBranchId: String(destination._id),
    pickupAddress: 'Mirpur 10, Dhaka', deliveryAddress: 'Agrabad, Chattogram',
    recipientName: 'Synthetic Receiver', recipientPhone: '01700000000',
    parcelType: 'Books', paymentType: 'COD', codAmountPoisha: 500000
  };

  const parcel = await createMerchantBooking({ actor: merchantActor, input: bookingInput, idempotencyKey: 'integration-booking-0001' });
  const replay = await createMerchantBooking({ actor: merchantActor, input: bookingInput, idempotencyKey: 'integration-booking-0001' });
  assert.equal(String(replay._id), String(parcel._id), 'booking retry must return the original parcel');
  await assert.rejects(createMerchantBooking({ actor: merchantActor, input: { ...bookingInput, codAmountPoisha: 500001 }, idempotencyKey: 'integration-booking-0001' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(parcel.priceSnapshot.deliveryFeePoisha, 10000);
  assert.equal(parcel.priceSnapshot.codFeePoisha, 5000);
  assert.equal(parcel.priceSnapshot.merchantNetPoisha, 485000);

  await assignRider({ parcelId: String(parcel._id), riderId: String(rider._id), actor: operationsActor, idempotencyKey: 'assign-rider-001' });
  await transitionParcel({ parcelId: String(parcel._id), toStatus: 'Booked', actor: operationsActor, idempotencyKey: 'integration-booked-0001' });
  const concurrentTransitions = await Promise.allSettled([
    transitionParcel({ parcelId: String(parcel._id), toStatus: 'Picked Up', actor: riderActor, idempotencyKey: 'integration-pickup-0001' }),
    transitionParcel({ parcelId: String(parcel._id), toStatus: 'Picked Up', actor: riderActor, idempotencyKey: 'integration-pickup-0002' })
  ]);
  assert.equal(concurrentTransitions.filter((result) => result.status === 'fulfilled').length, 1, 'only one competing transition should commit');
  assert.equal(await ParcelEvent.countDocuments({ parcelId: parcel._id, toStatus: 'Picked Up' }), 1);

  await transitionParcel({ parcelId: String(parcel._id), toStatus: 'At Origin Hub', actor: riderActor, idempotencyKey: 'integration-origin-0001' });
  await transitionParcel({ parcelId: String(parcel._id), toStatus: 'In Transit', actor: operationsActor, idempotencyKey: 'integration-transit-0001' });
  await transitionParcel({ parcelId: String(parcel._id), toStatus: 'At Destination Hub', actor: operationsActor, idempotencyKey: 'integration-dest-hub-0001' });
  await transitionParcel({ parcelId: String(parcel._id), toStatus: 'Out for Delivery', actor: riderActor, idempotencyKey: 'integration-out-for-delivery-0001' });
  await assert.rejects(recordDelivery({ parcelId: String(parcel._id), amountPoisha: 499999, actor: riderActor, idempotencyKey: 'integration-bad-cash-0001' }), { code: 'COD_AMOUNT_MISMATCH' });
  const delivered = await recordDelivery({ parcelId: String(parcel._id), amountPoisha: 500000, actor: riderActor, idempotencyKey: 'integration-delivery-0001' });
  assert.equal(delivered.status, 'Delivered');
  assert.equal(delivered.cod.status, 'collected');
  await assert.rejects(Parcel.updateOne({ _id: parcel._id }, { $set: { 'priceSnapshot.codAmountPoisha': 1 } }), /immutable/);

  const handover = await submitCashHandover({ actor: riderActor, branchId: String(destination._id), parcelIds: [String(parcel._id)], declaredAmountPoisha: 500000, idempotencyKey: 'integration-handover-0001' });
  const disputed = await reconcileCashHandover({ handoverId: String(handover._id), verifiedAmountPoisha: 499000, actor: accountsActor, idempotencyKey: 'reconcile-dispute-001' });
  assert.equal(disputed.status, 'disputed');
  await assert.rejects(requestPayout({ actor: merchantActor, parcelIds: [String(parcel._id)], idempotencyKey: 'integration-early-payout-0001' }), { code: 'PAYOUT_NOT_ELIGIBLE' });
  const reconciled = await reconcileCashHandover({ handoverId: String(handover._id), verifiedAmountPoisha: 500000, actor: accountsActor, idempotencyKey: 'reconcile-correct-001' });
  assert.equal(reconciled.status, 'reconciled');
  assert.equal((await Parcel.findById(parcel._id)).cod.status, 'reconciled');

  const payout = await requestPayout({ actor: merchantActor, parcelIds: [String(parcel._id)], idempotencyKey: 'integration-payout-0001' });
  const payoutReplay = await requestPayout({ actor: merchantActor, parcelIds: [String(parcel._id)], idempotencyKey: 'integration-payout-0001' });
  assert.equal(String(payoutReplay._id), String(payout._id));
  assert.equal(payout.amountPoisha, 485000);
  await decidePayout({ payoutId: String(payout._id), action: 'approve', actor: accountsActor, idempotencyKey: 'payout-approve-001' });
  await decidePayout({ payoutId: String(payout._id), action: 'mark-paid', actor: accountsActor, paymentReference: 'SYNTHETIC-BANK-001', idempotencyKey: 'payout-paid-001' });
  await decidePayout({ payoutId: String(payout._id), action: 'reverse', actor: adminActor, paymentReference: 'SYNTHETIC-RETURN-001', note: 'Synthetic return confirmed', idempotencyKey: 'payout-reverse-001' });
  assert.equal((await Payout.findById(payout._id)).status, 'reversed');
  assert.equal((await Parcel.findById(parcel._id)).cod.status, 'reconciled');
  const payable = await LedgerEntry.findOne({ parcelId: parcel._id, type: 'cod_payable' });
  await reverseCodPayable({ entryId: String(payable._id), actor: adminActor, note: 'Synthetic payable correction', idempotencyKey: 'cod-reversal-001' });
  assert.equal((await Parcel.findById(parcel._id)).cod.status, 'reversed');
  assert.equal(await LedgerEntry.countDocuments({ merchantId: merchant._id }), 4);
  await assert.rejects(LedgerEntry.updateOne({ _id: payable._id }, { $set: { amountPoisha: 0 } }), /immutable/);
});
