const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Branch = require('../models/Branch');
const Parcel = require('../models/Parcel');
const ParcelEvent = require('../models/ParcelEvent');
const MerchantProfile = require('../models/MerchantProfile');
const PricingPolicy = require('../models/PricingPolicy');
const Payout = require('../models/Payout');
const LedgerEntry = require('../models/LedgerEntry');
const Session = require('../models/Session');
const IdempotencyRecord = require('../models/IdempotencyRecord');
const auth = require('../middleware/auth');
const { inTransaction } = require('../domain/shared/transaction');
const { createMerchantBooking, domainError } = require('../domain/parcels/service');
const { requestPayout } = require('../domain/finance/settlements');
const { findLedgerBackedEligibleParcels } = require('../domain/finance/payout-eligibility');
const { attachProofMetadata } = require('../utils/delivery-proofs');
const { hashRequest, validateIdempotencyKey } = require('../domain/shared/idempotency');
const { consumePublicRequestLimit } = require('../utils/login-rate-limit');
const { createEmailNotification } = require('../domain/notifications/outbox');
const { getPricingConfig, priceBooking } = require('../domain/finance/pricing');
const { states: parcelStatuses } = require('../domain/parcels/state-machine');
const { enumQuery, INVALID_ENUM_QUERY } = require('../utils/enum-query');
const { parsePagination } = require('../utils/pagination');
const { optionalQueryString, INVALID_QUERY_STRING } = require('../utils/query-string');

const router = express.Router();
const safeUser = (user) => ({ id: String(user._id), name: user.name, email: user.email, role: user.role });

router.post('/apply', async (req, res) => {
  try {
    const limit = await consumePublicRequestLimit({ ip: req.ip || req.socket.remoteAddress || 'unknown', endpoint: 'merchant-application', maximum: 8, windowMs: 60 * 60 * 1000 });
    if (!limit.allowed) {
      res.set('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({ msg: 'Too many merchant applications from this network. Try again later.' });
    }
  } catch (error) {
    console.error('Merchant application rate-limit lookup failed:', error.message);
    return res.status(503).json({ msg: 'Unable to verify application limit' });
  }
  const { name, email, password, businessName, phone, pickupAddress } = req.body || {};
  if (![name, businessName, phone, pickupAddress].every((value) => typeof value === 'string' && value.trim()) ||
      name.trim().length > 120 || businessName.trim().length > 160 || phone.trim().length > 32 || pickupAddress.trim().length > 500 ||
      typeof email !== 'string' || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ msg: 'Name, valid email, business name, phone, pickup address, and a password of at least 12 characters are required' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (await User.exists({ email: normalizedEmail })) return res.status(409).json({ msg: 'An account already exists for this email' });
  try {
    const result = await inTransaction(async (session) => {
      const [user] = await User.create([{
        name: name.trim(), email: normalizedEmail, password: await bcrypt.hash(password, 12),
        role: 'merchant', accountStatus: 'pending', phone: phone.trim()
      }], { session });
      const [profile] = await MerchantProfile.create([{
        userId: user._id, businessName: businessName.trim(), contactName: name.trim(),
        phone: phone.trim(), pickupAddress: pickupAddress.trim(), status: 'pending'
      }], { session });
      await createEmailNotification({
        notificationKey: `merchant-application-received:${profile._id}`,
        recipient: user.email,
        template: 'merchant_application_received',
        payload: { name: user.name, businessName: profile.businessName },
        session
      });
      return { user, profile };
    });
    return res.status(202).json({ status: 'pending', merchant: { ...safeUser(result.user), businessName: result.profile.businessName } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ msg: 'An account already exists for this email' });
    console.error('Merchant application failed:', error.message);
    return res.status(503).json({ msg: 'Unable to submit the application. Please try again.' });
  }
});

router.post('/bookings', auth(['merchant']), async (req, res) => {
  try {
    const parcel = await createMerchantBooking({ actor: req.user, input: req.body || {}, idempotencyKey: req.header('Idempotency-Key') });
    req.io.to('admins').emit('parcelRequested', { _id: parcel._id });
    req.io.to(`branch:${parcel.originBranchId}`).emit('parcelChanged', { _id: parcel._id, status: parcel.status });
    req.io.to('all-branches').emit('parcelChanged', { _id: parcel._id, status: parcel.status });
    res.status(201).json(parcel);
  } catch (error) {
    res.status(error.status || 503).json({ msg: error.message || 'Unable to create booking', code: error.code });
  }
});

router.get('/branches', auth(['merchant']), async (req, res) => {
  const branches = await Branch.find({ active: true }).select('code name city address').sort({ city: 1, name: 1 }).lean();
  res.json({ items: branches });
});

router.post('/booking-quote', auth(['merchant']), async (req, res) => {
  const { originBranchId, destinationBranchId, codAmountPoisha = 0 } = req.body || {};
  if (![originBranchId, destinationBranchId].every((id) => mongoose.isValidObjectId(id))) return res.status(400).json({ msg: 'Choose valid pickup and destination branches' });
  if (!Number.isSafeInteger(codAmountPoisha) || codAmountPoisha < 0) return res.status(400).json({ msg: 'COD amount must be a non-negative integer number of poisha' });
  try {
    const [origin, destination, storedPricing] = await Promise.all([
      Branch.findOne({ _id: originBranchId, active: true }).select('_id').lean(),
      Branch.findOne({ _id: destinationBranchId, active: true }).select('_id').lean(),
      PricingPolicy.findById('default').lean()
    ]);
    if (!origin || !destination) return res.status(400).json({ msg: 'Choose active pickup and destination branches' });
    const priceSnapshot = priceBooking({ codAmountPoisha, isInterBranch: String(origin._id) !== String(destination._id), config: storedPricing || getPricingConfig() });
    return res.json({ priceSnapshot });
  } catch (error) {
    return res.status(400).json({ msg: error.message || 'Unable to calculate this booking estimate' });
  }
});

router.get('/parcels', auth(['merchant']), async (req, res) => {
  const pagination = parsePagination(req.query, { defaultLimit: 20 });
  if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
  const { page, limit, skip } = pagination;
  const status = enumQuery(req.query.status, parcelStatuses);
  if (status === INVALID_ENUM_QUERY) return res.status(400).json({ msg: 'Choose a valid parcel status' });
  const filter = { merchantId: req.user.id };
  if (status) filter.status = status;
  const trackingPrefix = optionalQueryString(req.query.q, 40);
  if (trackingPrefix === INVALID_QUERY_STRING) return res.status(400).json({ msg: 'Tracking-code search must be one value of at most 40 characters' });
  const normalizedTrackingPrefix = trackingPrefix.toUpperCase();
  if (normalizedTrackingPrefix) filter.trackingCode = { $regex: `^${normalizedTrackingPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
  try {
    const [items, total] = await Promise.all([
      Parcel.find(filter).select('-qrCode -coordinates').sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      Parcel.countDocuments(filter)
    ]);
    res.json({ items: await attachProofMetadata(items), page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Merchant parcel lookup failed:', error.message);
    res.status(503).json({ msg: 'Unable to load merchant parcels' });
  }
});

router.get('/payout-eligibility', auth(['merchant']), async (req, res) => {
  try {
    const parcels = await findLedgerBackedEligibleParcels({ merchantId: req.user.id });
    const amountPoisha = parcels.reduce((sum, parcel) => sum + parcel.priceSnapshot.merchantNetPoisha, 0);
    if (!Number.isSafeInteger(amountPoisha)) return res.status(503).json({ msg: 'Eligible payout total is outside the supported BDT range' });
    res.json({ parcelCount: parcels.length, amountPoisha });
  } catch (error) {
    console.error('Merchant payout eligibility lookup failed:', error.message);
    res.status(503).json({ msg: 'Unable to load payout eligibility' });
  }
});

router.get('/parcels/:id/events', auth(['merchant']), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ msg: 'Invalid parcel ID' });
  const parcel = await Parcel.exists({ _id: req.params.id, merchantId: req.user.id });
  if (!parcel) return res.status(404).json({ msg: 'Parcel not found' });
  const events = await ParcelEvent.find({ parcelId: req.params.id }).select('type fromStatus toStatus actorRole branchId note createdAt').sort({ createdAt: 1 }).lean();
  res.json({ events });
});

router.post('/payouts', auth(['merchant']), async (req, res) => {
  try {
    const payout = await requestPayout({ actor: req.user, parcelIds: req.body?.parcelIds, allEligible: req.body?.allEligible, idempotencyKey: req.header('Idempotency-Key') });
    req.io.to('finance').emit('payoutChanged', { _id: payout._id, status: payout.status });
    res.status(201).json(payout);
  } catch (error) {
    res.status(error.status || 503).json({ msg: error.message || 'Unable to request payout', code: error.code });
  }
});

router.get('/payouts', auth(['merchant']), async (req, res) => {
  const pagination = parsePagination(req.query, { defaultLimit: 20 });
  if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
  const { page, limit, skip } = pagination;
  const status = enumQuery(req.query.status, ['requested', 'approved', 'paid', 'reversed', 'rejected']);
  if (status === INVALID_ENUM_QUERY) return res.status(400).json({ msg: 'Choose a valid payout status' });
  const filter = { merchantId: req.user.id };
  if (status) filter.status = status;
  const [items, total] = await Promise.all([
    Payout.find(filter).populate('parcelIds', 'trackingCode status priceSnapshot.merchantNetPoisha cod.status').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Payout.countDocuments(filter)
  ]);
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
});

router.get('/ledger', auth(['merchant']), async (req, res) => {
  const pagination = parsePagination(req.query, { defaultLimit: 25 });
  if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
  const { page, limit, skip } = pagination;
  const filter = { merchantId: req.user.id };
  const [items, total, totals] = await Promise.all([
    LedgerEntry.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    LedgerEntry.countDocuments(filter),
    LedgerEntry.aggregate([{ $match: filter }, { $group: { _id: null, balancePoisha: { $sum: '$amountPoisha' } } }])
  ]);
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit), balancePoisha: totals[0]?.balancePoisha || 0 });
});

router.get('/track/:trackingCode', async (req, res) => {
  try {
    const limit = await consumePublicRequestLimit({ ip: req.ip || req.socket.remoteAddress || 'unknown', endpoint: 'public-tracking', maximum: 120, windowMs: 60 * 60 * 1000 });
    if (!limit.allowed) {
      res.set('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({ msg: 'Too many tracking lookups from this network. Try again later.' });
    }
  } catch (error) {
    console.error('Public tracking rate-limit lookup failed:', error.message);
    return res.status(503).json({ msg: 'Unable to verify tracking lookup limit' });
  }
  const trackingCode = String(req.params.trackingCode || '').toUpperCase();
  const generatedCode = /^BD[A-F0-9]{12}$/.test(trackingCode);
  const runtimeEnvironment = process.env.NODE_ENV || 'development';
  const developmentFixtureCode = ['development', 'test'].includes(runtimeEnvironment) && /^DEMO-[A-Z0-9-]{1,40}$/.test(trackingCode);
  if (!generatedCode && !developmentFixtureCode) return res.status(404).json({ msg: 'Tracking code not found' });
  const parcel = await Parcel.findOne({ trackingCode }).select('trackingCode status createdAt destinationBranchId').lean();
  if (!parcel) return res.status(404).json({ msg: 'Tracking code not found' });
  const [events, destination] = await Promise.all([
    ParcelEvent.find({ parcelId: parcel._id, type: { $in: ['booking_requested', 'status_transition'] } }).select('type fromStatus toStatus branchId createdAt').populate('branchId', 'name city').sort({ createdAt: 1 }).lean(),
    Branch.findById(parcel.destinationBranchId).select('name city').lean()
  ]);
  res.set('Cache-Control', 'no-store').json({ trackingCode, status: parcel.status, createdAt: parcel.createdAt, destination: destination ? { branch: destination.name, city: destination.city } : null, events });
});

router.get('/applications', auth(['admin']), async (req, res) => {
  const status = enumQuery(req.query.status, ['pending', 'approved', 'rejected', 'suspended'], 'pending');
  if (status === INVALID_ENUM_QUERY) return res.status(400).json({ msg: 'Choose a valid merchant application status' });
  const pagination = parsePagination(req.query, { defaultLimit: 20 });
  if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
  const { page, limit, skip } = pagination;
  const filter = { status };
  const [items, total] = await Promise.all([
    MerchantProfile.find(filter).populate('userId', 'name email phone accountStatus').sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    MerchantProfile.countDocuments(filter)
  ]);
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
});

router.patch('/applications/:id/review', auth(['admin']), async (req, res) => {
  const { decision, note } = req.body || {};
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ msg: 'Invalid application ID' });
  if (!['approved', 'rejected', 'suspended'].includes(decision)) return res.status(400).json({ msg: 'Choose approve, reject, or suspend' });
  if (decision === 'suspended' && (typeof note !== 'string' || note.trim().length < 8)) return res.status(400).json({ msg: 'Provide a suspension reason of at least 8 characters' });
  const idempotencyKey = req.header('Idempotency-Key');
  if (!validateIdempotencyKey(idempotencyKey)) return res.status(400).json({ msg: 'Provide an Idempotency-Key header with 8 to 128 safe characters' });
  const operation = 'merchant-review';
  const requestHash = hashRequest({ applicationId: req.params.id, decision, note: typeof note === 'string' ? note.trim().slice(0, 500) : '' });
  try {
    const result = await inTransaction(async (session) => {
      const prior = await IdempotencyRecord.findOne({ actorId: req.user.id, operation, key: idempotencyKey }).session(session);
      if (prior) {
        if (prior.requestHash !== requestHash) throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different review details', 409);
        const profile = await MerchantProfile.findById(prior.resourceId).session(session);
        if (!profile) throw domainError('APPLICATION_NOT_FOUND', 'Merchant application not found', 404);
        return { profile, userId: profile.userId, replayed: true };
      }
      const allowedStatuses = decision === 'suspended' ? ['approved'] : decision === 'approved' ? ['pending', 'suspended'] : ['pending'];
      const changedAt = new Date();
      const reviewNote = typeof note === 'string' ? note.trim().slice(0, 500) : '';
      const profileUpdate = {
        $set: { status: decision, reviewedBy: req.user.id, reviewedAt: changedAt },
        $push: { reviewHistory: { status: decision, changedBy: req.user.id, note: reviewNote, changedAt } }
      };
      if (reviewNote) profileUpdate.$set.reviewNote = reviewNote;
      const reviewed = await MerchantProfile.findOneAndUpdate(
        { _id: req.params.id, status: { $in: allowedStatuses } },
        profileUpdate,
        { new: true, runValidators: true, session }
      );
      if (!reviewed) throw domainError('APPLICATION_CONFLICT', 'Application is missing or has already been reviewed', 409);
      const allowedAccountStatuses = decision === 'approved' ? ['pending', 'suspended'] : decision === 'suspended' ? ['active'] : ['pending'];
      const accountStatus = decision === 'approved' ? 'active' : decision === 'suspended' ? 'suspended' : 'rejected';
      const updatedUser = await User.updateOne({ _id: reviewed.userId, role: 'merchant', accountStatus: { $in: allowedAccountStatuses } }, { $set: { accountStatus } }, { session });
      if (updatedUser.modifiedCount !== 1) throw domainError('APPLICATION_CONFLICT', 'Merchant account state changed while reviewing this application', 409);
      const reviewedUser = await User.findById(reviewed.userId).select('name email').session(session).lean();
      await createEmailNotification({
        notificationKey: `merchant-application-review:${req.user.id}:${idempotencyKey}`,
        recipient: reviewedUser.email,
        template: `merchant_application_${decision}`,
        payload: { name: reviewedUser.name, businessName: reviewed.businessName },
        session
      });
      if (decision === 'suspended') await Session.deleteMany({ userId: reviewed.userId }, { session });
      await IdempotencyRecord.create([{ actorId: req.user.id, operation, key: idempotencyKey, requestHash, resourceId: reviewed._id }], { session });
      return { profile: reviewed, userId: reviewed.userId };
    });
    if (decision === 'suspended' && !result.replayed) {
      req.io.to(`user:${result.userId}`).emit('roleChanged', { accountStatus: 'suspended' });
      req.io.in(`user:${result.userId}`).disconnectSockets(true);
    }
    res.json({ application: result.profile });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await IdempotencyRecord.findOne({ actorId: req.user.id, operation, key: idempotencyKey });
      if (prior?.requestHash === requestHash) {
        const profile = await MerchantProfile.findById(prior.resourceId);
        if (profile) return res.json({ application: profile });
      }
      if (prior) return res.status(409).json({ msg: 'This idempotency key was already used with different review details', code: 'IDEMPOTENCY_CONFLICT' });
    }
    res.status(error.status || 503).json({ msg: error.message || 'Unable to review application' });
  }
});

module.exports = router;
