const mongoose = require('mongoose');
const Parcel = require('../../models/Parcel');
const ParcelEvent = require('../../models/ParcelEvent');
const MerchantProfile = require('../../models/MerchantProfile');
const Branch = require('../../models/Branch');
const PricingPolicy = require('../../models/PricingPolicy');
const User = require('../../models/User');
const IdempotencyRecord = require('../../models/IdempotencyRecord');
const { priceBooking, getPricingConfig } = require('../finance/pricing');
const { assertPoisha } = require('../finance/money');
const { assertTransition } = require('./state-machine');
const { hashRequest, validateIdempotencyKey } = require('../shared/idempotency');
const { inTransaction } = require('../shared/transaction');

const domainError = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const assertBranchRoutedMerchantParcel = (parcel) => {
  if (!parcel.merchantId || !parcel.originBranchId || !parcel.destinationBranchId) {
    throw domainError('LEGACY_READ_ONLY', 'Legacy parcels without a merchant booking and branch route are read-only', 409);
  }
};
const lookupIdempotency = async ({ actorId, operation, key, requestHash, session }) => {
  const prior = await IdempotencyRecord.findOne({ actorId, operation, key }).session(session);
  if (!prior) return null;
  if (prior.requestHash !== requestHash) throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different request details', 409);
  return prior.resourceId;
};

const normalizeBangladeshPhone = (value) => {
  if (typeof value !== 'string') return null;
  const compact = value.trim().replace(/[\s().-]/g, '');
  if (/^01[3-9]\d{8}$/.test(compact)) return `+88${compact}`;
  if (/^8801[3-9]\d{8}$/.test(compact)) return `+${compact}`;
  if (/^\+8801[3-9]\d{8}$/.test(compact)) return compact;
  return null;
};

const branchForTransition = (parcel, toStatus, fromStatus = parcel.status) => {
  if (toStatus === 'Cancelled') return fromStatus === 'Delivery Failed' ? parcel.destinationBranchId : parcel.originBranchId;
  return ['Processing', 'Booked', 'Picked Up', 'At Origin Hub', 'In Transit'].includes(toStatus)
    ? parcel.originBranchId
    : parcel.destinationBranchId;
};

const checkBranchScope = (actor, parcel, toStatus, fromStatus = parcel.status) => {
  if (actor.role === 'admin') return;
  const branchIds = new Set(actor.branchIds || []);
  if (actor.role === 'operations') {
    const requiredBranch = branchForTransition(parcel, toStatus, fromStatus);
    if (!requiredBranch || !branchIds.has(String(requiredBranch))) throw domainError('FORBIDDEN_SCOPE', 'Parcel is outside your branch scope', 403);
    return;
  }
  if (actor.role === 'rider') {
    if (String(parcel.riderId || '') !== String(actor.id)) throw domainError('FORBIDDEN_SCOPE', 'Parcel is not assigned to you', 404);
    const requiredBranch = branchForTransition(parcel, toStatus, fromStatus);
    if (!requiredBranch || !branchIds.has(String(requiredBranch))) throw domainError('FORBIDDEN_SCOPE', 'Parcel is outside your assigned branch', 403);
    return;
  }
  throw domainError('FORBIDDEN_SCOPE', 'You cannot update parcel operations', 403);
};

const createMerchantBooking = async ({ actor, input, idempotencyKey }) => {
  if (!validateIdempotencyKey(idempotencyKey)) throw domainError('IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key header with 8 to 128 safe characters');
  const recipientName = typeof input.recipientName === 'string' ? input.recipientName.trim() : '';
  const recipientPhone = normalizeBangladeshPhone(input.recipientPhone);
  if (!recipientName || recipientName.length > 120 || !recipientPhone) throw domainError('INVALID_RECIPIENT', 'Provide the recipient name and a valid Bangladesh mobile number');
  const merchantEmail = typeof input.merchantEmail === 'string' ? input.merchantEmail.trim().toLowerCase() : '';
  if (actor.role !== 'merchant' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(merchantEmail)) {
    throw domainError('MERCHANT_EMAIL_REQUIRED', 'Enter the email address of an approved merchant', 400);
  }
  if (!['merchant', 'admin', 'operations'].includes(actor.role)) throw domainError('FORBIDDEN_SCOPE', 'You cannot create bookings', 403);
  const normalizedInput = { ...input, ...(actor.role === 'merchant' ? {} : { merchantEmail }), recipientName, recipientPhone };
  const requestHash = hashRequest(normalizedInput);
  const operation = 'merchant-booking';
  try {
    return await inTransaction(async (session) => {
      const prior = await IdempotencyRecord.findOne({ actorId: actor.id, operation, key: idempotencyKey }).session(session);
      if (prior) {
        if (prior.requestHash !== requestHash) throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different booking details', 409);
        return Parcel.findById(prior.resourceId).session(session);
      }
      const merchant = actor.role === 'merchant'
        ? await User.findOne({ _id: actor.id, role: 'merchant', accountStatus: 'active' }).select('_id').session(session)
        : await User.findOne({ email: merchantEmail, role: 'merchant', accountStatus: 'active' }).select('_id').session(session);
      const profile = merchant && await MerchantProfile.findOne({ userId: merchant._id, status: 'approved' }).session(session);
      if (!profile) throw domainError('MERCHANT_NOT_APPROVED', 'Merchant approval is required before booking', 403);
      if (![input.originBranchId, input.destinationBranchId].every(mongoose.isValidObjectId)) throw domainError('INVALID_BOOKING', 'Choose valid origin and destination branches');
      const origin = await Branch.findOne({ _id: input.originBranchId, active: true }).session(session);
      const destination = await Branch.findOne({ _id: input.destinationBranchId, active: true }).session(session);
      if (!origin || !destination) throw domainError('BRANCH_NOT_FOUND', 'Choose active origin and destination branches', 400);
      if (actor.role === 'operations' && !(actor.branchIds || []).includes(String(origin._id))) {
        throw domainError('FORBIDDEN_SCOPE', 'Bookings must start at a branch assigned to your account', 403);
      }
      for (const branchId of new Set([String(origin._id), String(destination._id)])) {
        const reserved = await Branch.updateOne({ _id: branchId, active: true }, { $inc: { bookingRevision: 1 } }, { session });
        if (reserved.modifiedCount !== 1) throw domainError('BRANCH_NOT_FOUND', 'A selected branch was deactivated during booking; choose an active branch', 409);
      }
      if (![input.pickupAddress, input.deliveryAddress, input.parcelType].every((item) => typeof item === 'string' && item.trim()) || input.pickupAddress.length > 500 || input.deliveryAddress.length > 500 || input.parcelType.length > 120) {
        throw domainError('INVALID_BOOKING', 'Pickup address, delivery address and parcel type are required');
      }
      const paymentType = input.paymentType || 'COD';
      if (!['COD', 'prepaid'].includes(paymentType)) throw domainError('INVALID_BOOKING', 'Payment type must be COD or prepaid');
      const codAmountPoisha = paymentType === 'COD' ? input.codAmountPoisha : 0;
      assertPoisha(codAmountPoisha);
      const storedPricing = await PricingPolicy.findById('default').session(session).lean();
      const configuredPricing = storedPricing || getPricingConfig();
      const priceSnapshot = priceBooking({ codAmountPoisha, isInterBranch: String(origin._id) !== String(destination._id), config: configuredPricing });
      const trackingCode = `BD${require('node:crypto').randomBytes(6).toString('hex').toUpperCase()}`;
      const [parcel] = await Parcel.create([{
        customerId: merchant._id,
        merchantId: merchant._id,
        originBranchId: origin._id,
        destinationBranchId: destination._id,
        pickupAddress: input.pickupAddress.trim(),
        deliveryAddress: input.deliveryAddress.trim(),
        recipientName,
        recipientPhone,
        parcelType: input.parcelType.trim(),
        paymentType,
        status: 'Processing',
        trackingCode,
        priceSnapshot,
        cod: { status: paymentType === 'COD' ? 'due' : 'not_due' }
      }], { session });
      await ParcelEvent.create([{
        parcelId: parcel._id, type: 'booking_requested', toStatus: 'Processing', actorId: actor.id,
        actorRole: actor.role, branchId: origin._id
      }], { session });
      await IdempotencyRecord.create([{
        actorId: actor.id, operation, key: idempotencyKey, requestHash, resourceId: parcel._id
      }], { session });
      return parcel;
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await IdempotencyRecord.findOne({ actorId: actor.id, operation, key: idempotencyKey });
      if (prior?.requestHash === requestHash) return Parcel.findById(prior.resourceId);
      if (prior) throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different booking details', 409);
    }
    throw error;
  }
};

const transitionParcel = async ({ parcelId, toStatus, actor, note, idempotencyKey }) => {
  if (!mongoose.isValidObjectId(parcelId)) throw domainError('INVALID_PARCEL_ID', 'Invalid parcel ID');
  if (toStatus === 'Delivered') throw domainError('DELIVERY_CONFIRMATION_REQUIRED', 'Use the delivery confirmation flow to capture COD safely', 409);
  const normalizedNote = typeof note === 'string' ? note.trim() : '';
  if (normalizedNote.length > 1000) throw domainError('INVALID_TRANSITION_NOTE', 'Transition notes cannot exceed 1000 characters');
  if (toStatus === 'Delivery Failed' && normalizedNote.length < 8) throw domainError('DELIVERY_FAILURE_REASON_REQUIRED', 'Record a delivery failure reason of at least 8 characters', 400);
  if (!validateIdempotencyKey(idempotencyKey)) throw domainError('IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key header with 8 to 128 safe characters');
  const operation = 'parcel-transition';
  const requestHash = hashRequest({ parcelId: String(parcelId), toStatus, note: normalizedNote });
  try {
    return await inTransaction(async (session) => {
    const prior = await IdempotencyRecord.findOne({ actorId: actor.id, operation, key: idempotencyKey }).session(session);
    if (prior) {
      if (prior.requestHash !== requestHash) throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different transition details', 409);
      const replayedParcel = await Parcel.findById(prior.resourceId).session(session);
      if (!replayedParcel) throw domainError('PARCEL_NOT_FOUND', 'Parcel not found', 404);
      assertBranchRoutedMerchantParcel(replayedParcel);
      const originalEvent = toStatus === 'Cancelled'
        ? await ParcelEvent.findOne({ parcelId: replayedParcel._id, type: 'status_transition', toStatus }).select('fromStatus').session(session).lean()
        : null;
      checkBranchScope(actor, replayedParcel, toStatus, originalEvent?.fromStatus || replayedParcel.status);
      return replayedParcel;
    }
    const parcel = await Parcel.findById(parcelId).session(session);
    if (!parcel) throw domainError('PARCEL_NOT_FOUND', 'Parcel not found', 404);
    assertBranchRoutedMerchantParcel(parcel);
    checkBranchScope(actor, parcel, toStatus);
    assertTransition({ from: parcel.status, to: toStatus, role: actor.role });
    if (parcel.status === 'Delivery Failed' && ['Out for Delivery', 'Cancelled'].includes(toStatus) && normalizedNote.length < 8) {
      throw domainError('DELIVERY_DECISION_REASON_REQUIRED', 'Record the reason for retrying or cancelling this failed delivery in at least 8 characters', 400);
    }
    const priorStatus = parcel.status;
    const statusUpdate = { status: toStatus };
    if (toStatus === 'Booked') {
      statusUpdate.acceptedAt = new Date();
      statusUpdate.acceptedBy = actor.id;
    }
    const updated = await Parcel.findOneAndUpdate(
      { _id: parcel._id, status: priorStatus, __v: parcel.__v },
      { $set: statusUpdate, $inc: { __v: 1 } },
      { new: true, runValidators: true, session }
    );
    if (!updated) throw domainError('PARCEL_CONFLICT', 'Parcel was updated by another request; refresh and retry', 409);
    await ParcelEvent.create([{
      parcelId: parcel._id, type: 'status_transition', fromStatus: priorStatus, toStatus,
      actorId: actor.id, actorRole: actor.role,
      branchId: branchForTransition(parcel, toStatus, priorStatus),
      riderId: parcel.riderId, note: normalizedNote || undefined
    }], { session });
    await IdempotencyRecord.create([{ actorId: actor.id, operation, key: idempotencyKey, requestHash, resourceId: parcel._id }], { session });
    return updated;
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await IdempotencyRecord.findOne({ actorId: actor.id, operation, key: idempotencyKey });
      if (prior) {
        if (prior.requestHash === requestHash) {
          const replayedParcel = await Parcel.findById(prior.resourceId);
          if (!replayedParcel) throw domainError('PARCEL_NOT_FOUND', 'Parcel not found', 404);
          assertBranchRoutedMerchantParcel(replayedParcel);
          const originalEvent = toStatus === 'Cancelled'
            ? await ParcelEvent.findOne({ parcelId: replayedParcel._id, type: 'status_transition', toStatus }).select('fromStatus').lean()
            : null;
          checkBranchScope(actor, replayedParcel, toStatus, originalEvent?.fromStatus || replayedParcel.status);
          return replayedParcel;
        }
        throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different transition details', 409);
      }
    }
    throw error;
  }
};

const assignRider = async ({ parcelId, riderId, actor, idempotencyKey }) => {
  if (!mongoose.isValidObjectId(parcelId) || !mongoose.isValidObjectId(riderId)) throw domainError('INVALID_ID', 'Valid parcel and rider IDs are required');
  if (!validateIdempotencyKey(idempotencyKey)) throw domainError('IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key header with 8 to 128 safe characters');
  const operation = 'rider-assignment';
  const requestHash = hashRequest({ parcelId: String(parcelId), riderId: String(riderId) });
  const User = require('../../models/User');
  try {
    return await inTransaction(async (session) => {
    const priorId = await lookupIdempotency({ actorId: actor.id, operation, key: idempotencyKey, requestHash, session });
    if (priorId) {
      const replayedParcel = await Parcel.findById(priorId).session(session);
      if (!replayedParcel) throw domainError('PARCEL_NOT_FOUND', 'Parcel not found', 404);
      assertBranchRoutedMerchantParcel(replayedParcel);
      if (actor.role === 'operations') checkBranchScope(actor, replayedParcel, replayedParcel.status);
      else if (actor.role !== 'admin') throw domainError('FORBIDDEN_SCOPE', 'You cannot assign riders', 403);
      return replayedParcel;
    }
    const parcel = await Parcel.findById(parcelId).session(session);
    if (!parcel) throw domainError('PARCEL_NOT_FOUND', 'Parcel not found', 404);
    assertBranchRoutedMerchantParcel(parcel);
    if (actor.role === 'operations') checkBranchScope(actor, parcel, parcel.status);
    else if (actor.role !== 'admin') throw domainError('FORBIDDEN_SCOPE', 'You cannot assign riders', 403);
    if (['Delivered', 'Cancelled', 'Failed'].includes(parcel.status)) throw domainError('PARCEL_CLOSED', 'Closed parcels cannot be assigned', 409);
    const rider = await User.findOne({ _id: riderId, role: 'rider', accountStatus: 'active' }).select('_id branchIds').session(session);
    if (!rider) throw domainError('RIDER_NOT_FOUND', 'Active rider not found', 404);
    const relevantBranch = ['Processing', 'Booked', 'Picked Up', 'At Origin Hub', 'In Transit'].includes(parcel.status) ? parcel.originBranchId : parcel.destinationBranchId;
    if (!relevantBranch) throw domainError('PARCEL_BRANCH_REQUIRED', 'Assign an origin and destination branch before assigning a rider', 409);
    if (!(rider.branchIds || []).some((branchId) => String(branchId) === String(relevantBranch))) throw domainError('RIDER_BRANCH_MISMATCH', 'Rider is not assigned to the parcel branch', 400);
    let updated = parcel;
    if (String(parcel.riderId || '') !== String(riderId)) {
      updated = await Parcel.findOneAndUpdate({ _id: parcelId, __v: parcel.__v, status: parcel.status }, { $set: { riderId, agentId: riderId }, $inc: { __v: 1 } }, { new: true, session, runValidators: true });
      if (!updated) throw domainError('PARCEL_CONFLICT', 'Parcel was updated by another request; refresh and retry', 409);
      await ParcelEvent.create([{ parcelId, type: 'rider_assigned', actorId: actor.id, actorRole: actor.role, branchId: relevantBranch, riderId }], { session });
    }
    await IdempotencyRecord.create([{ actorId: actor.id, operation, key: idempotencyKey, requestHash, resourceId: parcel._id }], { session });
    return updated;
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await IdempotencyRecord.findOne({ actorId: actor.id, operation, key: idempotencyKey });
      if (prior?.requestHash === requestHash) {
        const replayedParcel = await Parcel.findById(prior.resourceId);
        if (!replayedParcel) throw domainError('PARCEL_NOT_FOUND', 'Parcel not found', 404);
        if (actor.role === 'operations') checkBranchScope(actor, replayedParcel, replayedParcel.status);
        else if (actor.role !== 'admin') throw domainError('FORBIDDEN_SCOPE', 'You cannot assign riders', 403);
        return replayedParcel;
      }
      if (prior) throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different assignment details', 409);
    }
    throw error;
  }
};

module.exports = { createMerchantBooking, transitionParcel, assignRider, checkBranchScope, domainError, normalizeBangladeshPhone, assertBranchRoutedMerchantParcel };
