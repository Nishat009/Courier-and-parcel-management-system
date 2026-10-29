const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('../models/User');
const Branch = require('../models/Branch');
const Parcel = require('../models/Parcel');
const MerchantProfile = require('../models/MerchantProfile');
const ParcelEvent = require('../models/ParcelEvent');
const CashHandover = require('../models/CashHandover');
const CashHandoverReview = require('../models/CashHandoverReview');
const LedgerEntry = require('../models/LedgerEntry');

const historyByStatus = {
  Processing: [],
  Booked: ['Booked'],
  'Picked Up': ['Booked', 'Picked Up'],
  'At Origin Hub': ['Booked', 'Picked Up', 'At Origin Hub'],
  'In Transit': ['Booked', 'Picked Up', 'At Origin Hub', 'In Transit'],
  'At Destination Hub': ['Booked', 'Picked Up', 'At Origin Hub', 'In Transit', 'At Destination Hub'],
  'Out for Delivery': ['Booked', 'Picked Up', 'At Origin Hub', 'In Transit', 'At Destination Hub', 'Out for Delivery'],
  'Delivery Failed': ['Booked', 'Picked Up', 'At Origin Hub', 'In Transit', 'At Destination Hub', 'Out for Delivery', 'Delivery Failed'],
  Delivered: ['Booked', 'Picked Up', 'At Origin Hub', 'In Transit', 'At Destination Hub', 'Out for Delivery', 'Delivered'],
  Cancelled: ['Cancelled']
};

const run = async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Synthetic seed is disabled in production');
  if (process.env.ALLOW_SYNTHETIC_SEED !== 'true') throw new Error('Set ALLOW_SYNTHETIC_SEED=true only after confirming MONGO_URI points to a disposable development database');
  if (!process.env.MONGO_URI) throw new Error('Configure MONGO_URI before seeding');
  await mongoose.connect(process.env.MONGO_URI);

  const password = process.env.SEED_PASSWORD || crypto.randomBytes(18).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);
  const definitions = [
    { key: 'admin', email: 'admin@example.test', name: 'Demo Admin', role: 'admin' },
    { key: 'ops', email: 'ops@example.test', name: 'Demo Operations', role: 'operations' },
    { key: 'accounts', email: 'accounts@example.test', name: 'Demo Accounts', role: 'accounts' },
    { key: 'merchant', email: 'merchant@example.test', name: 'Demo Merchant', role: 'merchant' },
    { key: 'pendingMerchant', email: 'pending-merchant@example.test', name: 'Demo Pending Merchant', role: 'merchant', accountStatus: 'pending' },
    { key: 'rider', email: 'rider@example.test', name: 'Demo Rider', role: 'rider' }
  ];
  const users = {};
  for (const definition of definitions) {
    const { key, ...userDefinition } = definition;
    users[key] = await User.findOneAndUpdate(
      { email: definition.email },
      { $set: { ...userDefinition, password: passwordHash, accountStatus: definition.accountStatus || 'active' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  const dhaka = await Branch.findOneAndUpdate({ code: 'DHK-CENTRAL' }, { $set: { name: 'Dhaka Central Hub', city: 'Dhaka', address: 'Motijheel, Dhaka', active: true } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const chattogram = await Branch.findOneAndUpdate({ code: 'CTG-CENTRAL' }, { $set: { name: 'Chattogram Central Hub', city: 'Chattogram', address: 'Agrabad, Chattogram', active: true } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await User.updateOne({ _id: users.ops._id }, { $set: { branchIds: [dhaka._id, chattogram._id] } });
  await User.updateOne({ _id: users.accounts._id }, { $set: { branchIds: [dhaka._id] } });
  await User.updateOne({ _id: users.rider._id }, { $set: { branchIds: [dhaka._id, chattogram._id] } });
  await MerchantProfile.findOneAndUpdate({ userId: users.merchant._id }, { $set: { businessName: 'Demo Dhaka Store', contactName: users.merchant.name, phone: '01700000000', pickupAddress: 'Mirpur 10, Dhaka', defaultBranchId: dhaka._id, status: 'approved' } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await MerchantProfile.findOneAndUpdate({ userId: users.pendingMerchant._id }, { $set: { businessName: 'Demo Pending Store', contactName: users.pendingMerchant.name, phone: '01800000000', pickupAddress: 'Uttara, Dhaka', status: 'pending', reviewHistory: [] }, $unset: { reviewedBy: '', reviewedAt: '', reviewNote: '', defaultBranchId: '' } }, { upsert: true, new: true, setDefaultsOnInsert: true });

  const cases = [
    { trackingCode: 'DEMO-PROCESSING-001', status: 'Processing', destinationBranchId: chattogram._id, codStatus: 'due', codAmountPoisha: 75000 },
    { trackingCode: 'DEMO-BOOKED-001', status: 'Booked', destinationBranchId: chattogram._id, codStatus: 'due', codAmountPoisha: 150000 },
    { trackingCode: 'DEMO-PICKED-001', status: 'Picked Up', destinationBranchId: chattogram._id, codStatus: 'due', codAmountPoisha: 220000 },
    { trackingCode: 'DEMO-HUB-001', status: 'At Origin Hub', destinationBranchId: chattogram._id, codStatus: 'due', codAmountPoisha: 220000 },
    { trackingCode: 'DEMO-TRANSIT-001', status: 'In Transit', destinationBranchId: chattogram._id, codStatus: 'due', codAmountPoisha: 89000 },
    { trackingCode: 'DEMO-DEST-HUB-001', status: 'At Destination Hub', destinationBranchId: chattogram._id, codStatus: 'due', codAmountPoisha: 100000 },
    { trackingCode: 'DEMO-OUT-001', status: 'Out for Delivery', destinationBranchId: dhaka._id, codStatus: 'due', codAmountPoisha: 125000 },
    { trackingCode: 'DEMO-FAILED-001', status: 'Delivery Failed', destinationBranchId: dhaka._id, codStatus: 'due', codAmountPoisha: 45000 },
    { trackingCode: 'DEMO-DELIVERED-001', status: 'Delivered', destinationBranchId: dhaka._id, codStatus: 'reconciled', codAmountPoisha: 300000 },
    { trackingCode: 'DEMO-CANCELLED-001', status: 'Cancelled', destinationBranchId: dhaka._id, codStatus: 'not_due', codAmountPoisha: 0, paymentType: 'prepaid' }
  ];
  for (const item of cases) {
    const priceSnapshot = { currency: 'BDT', deliveryFeePoisha: item.destinationBranchId.equals(dhaka._id) ? 6000 : 10000, codAmountPoisha: item.codAmountPoisha, codFeeBasisPoints: 100, codFeePoisha: Math.floor((item.codAmountPoisha + 50) / 100), merchantNetPoisha: Math.max(0, item.codAmountPoisha - (item.destinationBranchId.equals(dhaka._id) ? 6000 : 10000) - Math.floor((item.codAmountPoisha + 50) / 100)) };
    let parcel = await Parcel.findOne({ trackingCode: item.trackingCode });
    if (!parcel) parcel = await Parcel.create({
      merchantId: users.merchant._id, customerId: users.merchant._id, riderId: users.rider._id,
      originBranchId: dhaka._id, destinationBranchId: item.destinationBranchId,
      pickupAddress: 'Mirpur 10, Dhaka', deliveryAddress: item.destinationBranchId.equals(dhaka._id) ? 'Dhanmondi, Dhaka' : 'GEC, Chattogram',
      recipientName: 'Synthetic Receiver', recipientPhone: '+8801700000000',
      parcelType: 'Synthetic demo parcel', paymentType: item.paymentType || 'COD', status: item.status, priceSnapshot,
      cod: { status: item.codStatus, collectedAmountPoisha: item.codStatus === 'reconciled' ? item.codAmountPoisha : undefined, collectedAt: item.codStatus === 'reconciled' ? new Date() : undefined, collectedBy: item.codStatus === 'reconciled' ? users.rider._id : undefined, reconciledAt: item.codStatus === 'reconciled' ? new Date() : undefined },
      agentId: users.rider._id, trackingCode: item.trackingCode
    });
    await Parcel.updateOne({ _id: parcel._id }, { $set: { recipientName: 'Synthetic Receiver', recipientPhone: '+8801700000000' } });
    const bookingEvent = await ParcelEvent.findOne({ parcelId: parcel._id, type: 'booking_requested' });
    if (!bookingEvent) await ParcelEvent.create({ parcelId: parcel._id, type: 'booking_requested', toStatus: 'Processing', actorId: users.merchant._id, actorRole: 'merchant', branchId: dhaka._id });
    const transitionHistory = historyByStatus[item.status] || [];
    let fromStatus = 'Processing';
    for (const toStatus of transitionHistory) {
      const existingEvent = await ParcelEvent.findOne({ parcelId: parcel._id, type: 'status_transition', toStatus });
      if (!existingEvent) {
        const originHandling = ['Booked', 'Picked Up', 'At Origin Hub', 'In Transit'].includes(toStatus);
        const branchId = toStatus === 'Cancelled' ? dhaka._id : originHandling ? dhaka._id : item.destinationBranchId;
        const actorRole = ['Picked Up', 'Out for Delivery', 'Delivered', 'Delivery Failed'].includes(toStatus) ? 'rider' : 'operations';
        const actorId = actorRole === 'rider' ? users.rider._id : users.ops._id;
        const note = toStatus === 'Delivery Failed' ? 'Synthetic recipient unavailable for this demo delivery attempt' : undefined;
        await ParcelEvent.create({ parcelId: parcel._id, type: 'status_transition', fromStatus, toStatus, actorId, actorRole, branchId, riderId: actorRole === 'rider' ? users.rider._id : undefined, note });
      }
      fromStatus = toStatus;
    }
    if (item.status === 'Delivered' && item.codStatus === 'reconciled' && !await ParcelEvent.exists({ parcelId: parcel._id, type: 'cod_collected' })) {
      await ParcelEvent.create({ parcelId: parcel._id, type: 'cod_collected', actorId: users.rider._id, actorRole: 'rider', branchId: item.destinationBranchId, riderId: users.rider._id, note: 'Synthetic exact COD cash collection' });
    }
    if (item.codStatus === 'reconciled') {
      const handover = await CashHandover.findOneAndUpdate(
        { riderId: users.rider._id, idempotencyKey: 'seed-delivered-cash-001' },
        { $setOnInsert: { riderId: users.rider._id, branchId: dhaka._id, parcelIds: [parcel._id], expectedAmountPoisha: item.codAmountPoisha, declaredAmountPoisha: item.codAmountPoisha, verifiedAmountPoisha: item.codAmountPoisha, status: 'reconciled', verifiedBy: users.accounts._id, verifiedAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (!parcel.cod.handoverId) await Parcel.updateOne({ _id: parcel._id }, { $set: { 'cod.handoverId': handover._id } });
      if (!await CashHandoverReview.exists({ handoverId: handover._id, attemptNumber: 1 })) {
        await CashHandoverReview.create({
          handoverId: handover._id,
          attemptNumber: 1,
          expectedAmountPoisha: handover.expectedAmountPoisha,
          verifiedAmountPoisha: handover.verifiedAmountPoisha,
          outcome: 'matched',
          reviewedBy: users.accounts._id
        });
      }
      const payable = await LedgerEntry.findOne({ idempotencyKey: `cod-payable:${parcel._id}` });
      if (!payable) await LedgerEntry.create({ merchantId: users.merchant._id, parcelId: parcel._id, type: 'cod_payable', amountPoisha: priceSnapshot.merchantNetPoisha, idempotencyKey: `cod-payable:${parcel._id}`, createdBy: users.accounts._id });
      const handoverEvent = await ParcelEvent.findOne({ parcelId: parcel._id, type: 'cash_handover_reconciled' });
      if (!handoverEvent) await ParcelEvent.create({ parcelId: parcel._id, type: 'cash_handover_reconciled', actorId: users.accounts._id, actorRole: 'accounts', branchId: dhaka._id, riderId: users.rider._id, note: `Synthetic verified cash handover ${handover._id}` });
    }
  }

  console.log(`Synthetic development data is ready. Demo account password: ${password}`);
  console.log('Accounts: admin, operations, accounts, merchant, pending-merchant, rider @ example.test');
};

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message || 'Synthetic seed failed');
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}

module.exports = { run };
