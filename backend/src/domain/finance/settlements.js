const mongoose = require('mongoose');
const Parcel = require('../../models/Parcel');
const ParcelEvent = require('../../models/ParcelEvent');
const CashHandover = require('../../models/CashHandover');
const CashHandoverReview = require('../../models/CashHandoverReview');
const LedgerEntry = require('../../models/LedgerEntry');
const Payout = require('../../models/Payout');
const IdempotencyRecord = require('../../models/IdempotencyRecord');
const { inTransaction } = require('../shared/transaction');
const { hashRequest, validateIdempotencyKey } = require('../shared/idempotency');
const { assertPoisha } = require('./money');
const { findLedgerBackedEligibleParcels } = require('./payout-eligibility');
const { assertExactCollection, handoverMatches, assertPayoutAction, assertCodPayableReversal } = require('./settlement-rules');
const { domainError, assertBranchRoutedMerchantParcel, checkBranchScope } = require('../parcels/service');

const idempotentLookup = async ({ actorId, operation, key, requestHash, session }) => {
  const prior = await IdempotencyRecord.findOne({ actorId, operation, key }).session(session);
  if (!prior) return null;
  if (prior.requestHash !== requestHash) throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different details', 409);
  return prior.resourceId;
};

const requireKey = (key) => {
  if (!validateIdempotencyKey(key)) throw domainError('IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key header with 8 to 128 safe characters');
};

const assertDeliveryActor = (actor, parcel) => {
  if (!['admin', 'operations', 'rider'].includes(actor.role)) throw domainError('FORBIDDEN_SCOPE', 'You cannot record delivery', 403);
  if (actor.role === 'operations' && parcel.paymentType === 'COD') {
    throw domainError('FORBIDDEN_SCOPE', 'Only the assigned rider or an admin may record COD collection', 403);
  }
};

const recordDelivery = async ({ parcelId, amountPoisha, actor, idempotencyKey }) => {
  requireKey(idempotencyKey);
  if (!mongoose.isValidObjectId(parcelId)) throw domainError('INVALID_PARCEL_ID', 'Invalid parcel ID');
  assertPoisha(amountPoisha);
  const operation = 'record-delivery';
  const requestHash = hashRequest({ parcelId, amountPoisha });
  try {
    return await inTransaction(async (session) => {
      const resourceId = await idempotentLookup({ actorId: actor.id, operation, key: idempotencyKey, requestHash, session });
      if (resourceId) {
        const replayedParcel = await Parcel.findById(resourceId).session(session);
        if (!replayedParcel) throw domainError('PARCEL_NOT_FOUND', 'Parcel not found', 404);
        assertBranchRoutedMerchantParcel(replayedParcel);
        checkBranchScope(actor, replayedParcel, 'Delivered');
        assertDeliveryActor(actor, replayedParcel);
        return replayedParcel;
      }
      const parcel = await Parcel.findById(parcelId).session(session);
      if (!parcel) throw domainError('PARCEL_NOT_FOUND', 'Parcel not found', 404);
      assertBranchRoutedMerchantParcel(parcel);
      checkBranchScope(actor, parcel, 'Delivered');
      assertDeliveryActor(actor, parcel);
      if (parcel.status !== 'Out for Delivery') throw domainError('INVALID_TRANSITION', 'Parcel must be Out for Delivery before delivery can be recorded', 409);
      const expected = parcel.paymentType === 'COD' ? parcel.priceSnapshot?.codAmountPoisha : 0;
      if (!Number.isSafeInteger(expected)) throw domainError('INVALID_BOOKING_SNAPSHOT', 'Booking COD amount is missing or invalid', 409);
      assertExactCollection(expected, amountPoisha);
      const now = new Date();
      const cod = parcel.paymentType === 'COD'
        ? { ...parcel.cod?.toObject?.(), status: 'collected', collectedAmountPoisha: amountPoisha, collectedAt: now, collectedBy: actor.id }
        : { status: 'not_due' };
      const updated = await Parcel.findOneAndUpdate(
        { _id: parcelId, status: 'Out for Delivery', __v: parcel.__v, ...(parcel.paymentType === 'COD' ? { 'cod.status': 'due' } : {}) },
        { $set: { status: 'Delivered', cod }, $inc: { __v: 1 } },
        { new: true, runValidators: true, session }
      );
      if (!updated) throw domainError('PARCEL_CONFLICT', 'Parcel was updated by another request; refresh and retry', 409);
      const events = [{ parcelId, type: 'status_transition', fromStatus: parcel.status, toStatus: 'Delivered', actorId: actor.id, actorRole: actor.role, branchId: parcel.destinationBranchId, riderId: parcel.riderId }];
      if (parcel.paymentType === 'COD') events.push({ parcelId, type: 'cod_collected', actorId: actor.id, actorRole: actor.role, branchId: parcel.destinationBranchId, riderId: parcel.riderId, note: `Recorded ${amountPoisha} poisha cash collection` });
      await Promise.all(events.map((event) => ParcelEvent.create([event], { session })));
      await IdempotencyRecord.create([{ actorId: actor.id, operation, key: idempotencyKey, requestHash, resourceId: parcel._id }], { session });
      return updated;
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await IdempotencyRecord.findOne({ actorId: actor.id, operation, key: idempotencyKey });
      if (prior?.requestHash === requestHash) {
        const replayedParcel = await Parcel.findById(prior.resourceId);
        if (!replayedParcel) throw domainError('PARCEL_NOT_FOUND', 'Parcel not found', 404);
        assertBranchRoutedMerchantParcel(replayedParcel);
        checkBranchScope(actor, replayedParcel, 'Delivered');
        assertDeliveryActor(actor, replayedParcel);
        return replayedParcel;
      }
      if (prior) throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different delivery details', 409);
    }
    throw error;
  }
};

const submitCashHandover = async ({ actor, branchId, parcelIds, declaredAmountPoisha, idempotencyKey }) => {
  requireKey(idempotencyKey);
  assertPoisha(declaredAmountPoisha);
  if (actor.role !== 'rider' || !mongoose.isValidObjectId(branchId) || !Array.isArray(parcelIds) || !parcelIds.length || parcelIds.length > 100 || parcelIds.some((id) => !mongoose.isValidObjectId(id))) {
    throw domainError('INVALID_HANDOVER', 'A rider, valid branch, and 1 to 100 parcel IDs are required');
  }
  if (!(actor.branchIds || []).includes(String(branchId))) throw domainError('FORBIDDEN_SCOPE', 'Branch is outside your assignment', 403);
  const normalizedIds = [...new Set(parcelIds.map(String))].sort();
  if (normalizedIds.length !== parcelIds.length) throw domainError('INVALID_HANDOVER', 'Duplicate parcel IDs are not allowed');
  const operation = 'cash-handover';
  const requestHash = hashRequest({ branchId, parcelIds: normalizedIds, declaredAmountPoisha });
  try {
    return await inTransaction(async (session) => {
      const priorId = await idempotentLookup({ actorId: actor.id, operation, key: idempotencyKey, requestHash, session });
      if (priorId) return CashHandover.findById(priorId).session(session);
      const parcels = await Parcel.find({ _id: { $in: normalizedIds }, riderId: actor.id, destinationBranchId: branchId, status: 'Delivered', 'cod.status': 'collected' }).session(session);
      if (parcels.length !== normalizedIds.length) throw domainError('HANDOVER_PARCEL_MISMATCH', 'Every parcel must be delivered, collected by you, and assigned to this branch', 409);
      const expectedAmountPoisha = parcels.reduce((sum, parcel) => sum + parcel.cod.collectedAmountPoisha, 0);
      assertPoisha(expectedAmountPoisha);
      const [handover] = await CashHandover.create([{
        riderId: actor.id, branchId, parcelIds: normalizedIds, expectedAmountPoisha,
        declaredAmountPoisha, idempotencyKey, status: 'submitted'
      }], { session });
      for (const parcel of parcels) {
        const changed = await Parcel.updateOne({ _id: parcel._id, 'cod.status': 'collected', 'cod.handoverId': { $exists: false } }, { $set: { 'cod.status': 'handed_over', 'cod.handoverId': handover._id } }, { session });
        if (changed.modifiedCount !== 1) throw domainError('PARCEL_CONFLICT', 'A parcel was included in another cash handover', 409);
        await ParcelEvent.create([{ parcelId: parcel._id, type: 'cash_handover_submitted', actorId: actor.id, actorRole: actor.role, branchId, riderId: actor.id, note: `Handover ${handover._id}` }], { session });
      }
      await IdempotencyRecord.create([{ actorId: actor.id, operation, key: idempotencyKey, requestHash, resourceId: handover._id }], { session });
      return handover;
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await IdempotencyRecord.findOne({ actorId: actor.id, operation, key: idempotencyKey });
      if (prior?.requestHash === requestHash) return CashHandover.findById(prior.resourceId);
      if (prior) throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different handover details', 409);
    }
    throw error;
  }
};

const reconcileCashHandover = async ({ handoverId, verifiedAmountPoisha, actor, idempotencyKey }) => {
  requireKey(idempotencyKey);
  assertPoisha(verifiedAmountPoisha);
  if (!mongoose.isValidObjectId(handoverId)) throw domainError('HANDOVER_NOT_FOUND', 'Cash handover not found', 404);
  if (!['admin', 'accounts'].includes(actor.role)) throw domainError('FORBIDDEN_SCOPE', 'Accounts permission is required to reconcile cash', 403);
  const operation = 'cash-handover-reconcile';
  const requestHash = hashRequest({ handoverId: String(handoverId), verifiedAmountPoisha });
  try {
    return await inTransaction(async (session) => {
    const priorId = await idempotentLookup({ actorId: actor.id, operation, key: idempotencyKey, requestHash, session });
    if (priorId) {
      const priorHandover = await CashHandover.findById(priorId).session(session);
      if (!priorHandover) throw domainError('HANDOVER_NOT_FOUND', 'Cash handover not found', 404);
      if (actor.role === 'accounts' && !(actor.branchIds || []).includes(String(priorHandover.branchId))) throw domainError('FORBIDDEN_SCOPE', 'Cash handover is outside your branch scope', 403);
      return priorHandover;
    }
    const handover = await CashHandover.findById(handoverId).session(session);
    if (!handover) throw domainError('HANDOVER_NOT_FOUND', 'Cash handover not found', 404);
    if (!['admin', 'accounts'].includes(actor.role)) throw domainError('FORBIDDEN_SCOPE', 'Accounts permission is required to reconcile cash', 403);
    if (actor.role === 'accounts' && !(actor.branchIds || []).includes(String(handover.branchId))) throw domainError('FORBIDDEN_SCOPE', 'Cash handover is outside your branch scope', 403);
    if (handover.status === 'reconciled') throw domainError('HANDOVER_ALREADY_RECONCILED', 'This cash handover is already reconciled', 409);
    const matches = handoverMatches(handover.expectedAmountPoisha, verifiedAmountPoisha);
    const attemptNumber = await CashHandoverReview.countDocuments({ handoverId: handover._id }).session(session) + 1;
    const updated = await CashHandover.findOneAndUpdate(
      { _id: handoverId, status: { $in: ['submitted', 'disputed'] }, __v: handover.__v },
      { $set: { status: matches ? 'reconciled' : 'disputed', verifiedAmountPoisha, verifiedBy: actor.id, verifiedAt: new Date() }, $inc: { __v: 1 } },
      { new: true, session, runValidators: true }
    );
    if (!updated) throw domainError('HANDOVER_CONFLICT', 'Handover changed while being reconciled; refresh and retry', 409);
    await CashHandoverReview.create([{
      handoverId: handover._id,
      attemptNumber,
      expectedAmountPoisha: handover.expectedAmountPoisha,
      verifiedAmountPoisha,
      outcome: matches ? 'matched' : 'disputed',
      reviewedBy: actor.id
    }], { session });
    if (!matches) {
      await ParcelEvent.create(handover.parcelIds.map((parcelId) => ({
        parcelId,
        type: 'cash_handover_disputed',
        actorId: actor.id,
        actorRole: actor.role,
        branchId: handover.branchId,
        riderId: handover.riderId,
        note: 'Cash handover did not match the physical count; accounts review is required before COD settlement.'
      })), { session });
      await IdempotencyRecord.create([{ actorId: actor.id, operation, key: idempotencyKey, requestHash, resourceId: handover._id }], { session });
      return updated;
    }
    const parcels = await Parcel.find({ _id: { $in: handover.parcelIds }, 'cod.status': 'handed_over', 'cod.handoverId': handover._id }).session(session);
    if (parcels.length !== handover.parcelIds.length) throw domainError('HANDOVER_PARCEL_MISMATCH', 'Handover parcels no longer match the submitted cash batch', 409);
    for (const parcel of parcels) {
      const changed = await Parcel.updateOne({ _id: parcel._id, 'cod.status': 'handed_over', 'cod.handoverId': handover._id }, { $set: { 'cod.status': 'reconciled', 'cod.reconciledAt': new Date() } }, { session });
      if (changed.modifiedCount !== 1) throw domainError('HANDOVER_CONFLICT', 'A parcel changed during reconciliation', 409);
      await ParcelEvent.create([{ parcelId: parcel._id, type: 'cash_handover_reconciled', actorId: actor.id, actorRole: actor.role, branchId: handover.branchId, riderId: handover.riderId, note: `Handover ${handover._id} reconciled` }], { session });
      const net = parcel.priceSnapshot?.merchantNetPoisha || 0;
      if (net > 0) await LedgerEntry.create([{ merchantId: parcel.merchantId, parcelId: parcel._id, type: 'cod_payable', amountPoisha: net, idempotencyKey: `cod-payable:${parcel._id}`, createdBy: actor.id }], { session });
    }
    await IdempotencyRecord.create([{ actorId: actor.id, operation, key: idempotencyKey, requestHash, resourceId: handover._id }], { session });
    return updated;
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await IdempotencyRecord.findOne({ actorId: actor.id, operation, key: idempotencyKey });
      if (prior?.requestHash === requestHash) {
        const replayed = await CashHandover.findById(prior.resourceId);
        if (!replayed) throw domainError('HANDOVER_NOT_FOUND', 'Cash handover not found', 404);
        if (actor.role === 'accounts' && !(actor.branchIds || []).includes(String(replayed.branchId))) throw domainError('FORBIDDEN_SCOPE', 'Cash handover is outside your branch scope', 403);
        return replayed;
      }
      if (prior) throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different reconciliation details', 409);
    }
    throw error;
  }
};

const requestPayout = async ({ actor, parcelIds, allEligible = false, idempotencyKey }) => {
  requireKey(idempotencyKey);
  if (allEligible !== true && (!Array.isArray(parcelIds) || !parcelIds.length || parcelIds.length > 100 || parcelIds.some((id) => !mongoose.isValidObjectId(id)))) throw domainError('INVALID_PAYOUT', 'Select all eligible parcels or 1 to 100 valid parcel IDs');
  const normalizedIds = allEligible ? null : [...new Set(parcelIds.map(String))].sort();
  if (normalizedIds && normalizedIds.length !== parcelIds.length) throw domainError('INVALID_PAYOUT', 'Duplicate parcel IDs are not allowed');
  const operation = 'merchant-payout';
  const requestHash = hashRequest(allEligible ? { allEligible: true } : { parcelIds: normalizedIds });
  try {
    return await inTransaction(async (session) => {
      const priorId = await idempotentLookup({ actorId: actor.id, operation, key: idempotencyKey, requestHash, session });
      if (priorId) return Payout.findById(priorId).session(session);
      const eligibleParcels = await findLedgerBackedEligibleParcels({ merchantId: actor.id, session });
      const eligibleById = new Map(eligibleParcels.map((parcel) => [String(parcel._id), parcel]));
      const parcels = allEligible ? eligibleParcels : normalizedIds.map((id) => eligibleById.get(id)).filter(Boolean);
      const payoutIds = parcels.map((parcel) => String(parcel._id)).sort();
      if (!parcels.length || (!allEligible && parcels.length !== normalizedIds.length)) throw domainError('PAYOUT_NOT_ELIGIBLE', 'Only your delivered parcels with reconciled COD are eligible for payout', 409);
      const amountPoisha = parcels.reduce((sum, parcel) => sum + (parcel.priceSnapshot?.merchantNetPoisha || 0), 0);
      if (!Number.isSafeInteger(amountPoisha) || amountPoisha <= 0) throw domainError('PAYOUT_NOT_ELIGIBLE', 'Selected parcels have no positive payable balance', 409);
      const [payout] = await Payout.create([{ merchantId: actor.id, parcelIds: payoutIds, amountPoisha, idempotencyKey }], { session });
      const changed = await Parcel.updateMany({ _id: { $in: payoutIds }, merchantId: actor.id, 'cod.status': 'reconciled' }, { $set: { 'cod.status': 'payable' } }, { session });
      if (changed.modifiedCount !== payoutIds.length) throw domainError('PAYOUT_CONFLICT', 'A parcel was reserved by another payout request', 409);
      await IdempotencyRecord.create([{ actorId: actor.id, operation, key: idempotencyKey, requestHash, resourceId: payout._id }], { session });
      return payout;
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await IdempotencyRecord.findOne({ actorId: actor.id, operation, key: idempotencyKey });
      if (prior?.requestHash === requestHash) return Payout.findById(prior.resourceId);
      if (prior) throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different payout details', 409);
    }
    throw error;
  }
};

const applyPayoutDecision = async ({ payoutId, action, actor, paymentReference, note, session }) => {
  const payout = await Payout.findById(payoutId).session(session);
  if (!payout) throw domainError('PAYOUT_NOT_FOUND', 'Payout not found', 404);
  assertPayoutAction({ action, role: actor.role, status: payout.status, paymentReference, note });
  if (action === 'approve') {
    const updated = await Payout.findOneAndUpdate({ _id: payoutId, status: 'requested', __v: payout.__v }, { $set: { status: 'approved', reviewedBy: actor.id, reviewedAt: new Date() }, $inc: { __v: 1 } }, { new: true, session });
    if (!updated) throw domainError('PAYOUT_CONFLICT', 'Payout is no longer awaiting approval', 409);
    return updated;
  }
  if (action === 'reject') {
    const updated = await Payout.findOneAndUpdate({ _id: payoutId, status: 'requested', __v: payout.__v }, { $set: { status: 'rejected', reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: note.trim() }, $inc: { __v: 1 } }, { new: true, session });
    if (!updated) throw domainError('PAYOUT_CONFLICT', 'Payout is no longer awaiting review', 409);
    const restored = await Parcel.updateMany({ _id: { $in: payout.parcelIds }, 'cod.status': 'payable' }, { $set: { 'cod.status': 'reconciled' } }, { session });
    if (restored.modifiedCount !== payout.parcelIds.length) throw domainError('PAYOUT_CONFLICT', 'Payout parcel balances changed; no changes were kept', 409);
    return updated;
  }
  if (action === 'mark-paid') {
    const updated = await Payout.findOneAndUpdate({ _id: payoutId, status: 'approved', __v: payout.__v }, { $set: { status: 'paid', paidAt: new Date(), paidBy: actor.id, paymentReference: paymentReference.trim() }, $inc: { __v: 1 } }, { new: true, session });
    if (!updated) throw domainError('PAYOUT_CONFLICT', 'Payout is no longer approved', 409);
    await LedgerEntry.create([{ merchantId: payout.merchantId, payoutId: payout._id, type: 'payout_paid', amountPoisha: -payout.amountPoisha, idempotencyKey: `payout-paid:${payout._id}`, externalReference: paymentReference.trim(), createdBy: actor.id }], { session });
    const markedPaid = await Parcel.updateMany({ _id: { $in: payout.parcelIds }, 'cod.status': 'payable' }, { $set: { 'cod.status': 'paid' } }, { session });
    if (markedPaid.modifiedCount !== payout.parcelIds.length) throw domainError('PAYOUT_CONFLICT', 'Payout parcel balances changed; no changes were kept', 409);
    return updated;
  }
  if (action === 'reverse') {
    const payment = await LedgerEntry.findOne({ payoutId: payout._id, type: 'payout_paid' }).session(session);
    if (!payment) throw domainError('LEDGER_ENTRY_NOT_FOUND', 'Payout ledger entry is missing; contact a system administrator', 409);
    const updated = await Payout.findOneAndUpdate({ _id: payoutId, status: 'paid', __v: payout.__v }, { $set: { status: 'reversed', reversedAt: new Date(), reversedBy: actor.id, reversalReference: paymentReference.trim(), reversalNote: typeof note === 'string' ? note.trim().slice(0, 1000) : '' }, $inc: { __v: 1 } }, { new: true, session });
    if (!updated) throw domainError('PAYOUT_CONFLICT', 'Payout changed while being reversed', 409);
    await LedgerEntry.create([{ merchantId: payout.merchantId, payoutId: payout._id, type: 'reversal', amountPoisha: payout.amountPoisha, idempotencyKey: `payout-reversal:${payout._id}`, reversesEntryId: payment._id, externalReference: paymentReference.trim(), createdBy: actor.id, note: updated.reversalNote }], { session });
    const restored = await Parcel.updateMany({ _id: { $in: payout.parcelIds }, 'cod.status': 'paid' }, { $set: { 'cod.status': 'reconciled' } }, { session });
    if (restored.modifiedCount !== payout.parcelIds.length) throw domainError('PAYOUT_CONFLICT', 'Payout parcel balances changed; no changes were kept', 409);
    return updated;
  }
  throw domainError('INVALID_PAYOUT_ACTION', 'Unknown payout action');
};

const decidePayout = async ({ payoutId, action, actor, paymentReference, note, idempotencyKey }) => {
  requireKey(idempotencyKey);
  if (!['admin', 'accounts'].includes(actor.role)) throw domainError('FORBIDDEN_SCOPE', 'Accounts permission is required', 403);
  const operation = 'payout-decision';
  const requestHash = hashRequest({ payoutId: String(payoutId), action, paymentReference: paymentReference || '', note: note || '' });
  try {
    return await inTransaction(async (session) => {
      const priorId = await idempotentLookup({ actorId: actor.id, operation, key: idempotencyKey, requestHash, session });
      if (priorId) {
        const priorPayout = await Payout.findById(priorId).session(session);
        if (!priorPayout) throw domainError('PAYOUT_NOT_FOUND', 'Payout not found', 404);
        return priorPayout;
      }
      const payout = await applyPayoutDecision({ payoutId, action, actor, paymentReference, note, session });
      await IdempotencyRecord.create([{ actorId: actor.id, operation, key: idempotencyKey, requestHash, resourceId: payout._id }], { session });
      return payout;
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await IdempotencyRecord.findOne({ actorId: actor.id, operation, key: idempotencyKey });
      if (prior?.requestHash === requestHash) return Payout.findById(prior.resourceId);
      if (prior) throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different payout details', 409);
    }
    throw error;
  }
};

const applyCodPayableReversal = async ({ entryId, actor, note, session }) => {
  if (!mongoose.isValidObjectId(entryId)) throw domainError('INVALID_LEDGER_ENTRY', 'Invalid ledger entry ID');
  const entry = await LedgerEntry.findById(entryId).session(session);
  if (!entry) throw domainError('LEDGER_ENTRY_NOT_FOUND', 'Ledger entry not found', 404);
  const priorReversal = await LedgerEntry.findOne({ reversesEntryId: entry._id }).session(session);
  if (priorReversal) throw domainError('LEDGER_ENTRY_REVERSED', 'This ledger entry has already been reversed', 409);
  const activePayout = entry.parcelId ? await Payout.exists({ parcelIds: entry.parcelId, status: { $in: ['requested', 'approved', 'paid'] } }).session(session) : null;
  assertCodPayableReversal({ role: actor.role, entryType: entry.type, note, blockingPayout: Boolean(activePayout) });
  const parcel = await Parcel.findById(entry.parcelId).session(session);
  if (!parcel || !['reconciled', 'payable'].includes(parcel.cod?.status)) throw domainError('PARCEL_CONFLICT', 'Parcel is not in a reversible COD payable state', 409);
  const reversal = await LedgerEntry.create([{
    merchantId: entry.merchantId, parcelId: entry.parcelId, type: 'reversal', amountPoisha: -entry.amountPoisha,
    idempotencyKey: `cod-payable-reversal:${entry._id}`, reversesEntryId: entry._id, createdBy: actor.id, note: note.trim().slice(0, 1000)
  }], { session });
  const changed = await Parcel.updateOne({ _id: parcel._id, 'cod.status': parcel.cod.status }, { $set: { 'cod.status': 'reversed', 'cod.reversedAt': new Date() } }, { session });
  if (changed.modifiedCount !== 1) throw domainError('PARCEL_CONFLICT', 'Parcel changed while reversing its payable balance', 409);
  await ParcelEvent.create([{ parcelId: parcel._id, type: 'cod_payable_reversed', actorId: actor.id, actorRole: actor.role, branchId: parcel.destinationBranchId, note: note.trim().slice(0, 1000) }], { session });
  return reversal[0];
};

const reverseCodPayable = async ({ entryId, actor, note, idempotencyKey }) => {
  requireKey(idempotencyKey);
  if (actor.role !== 'admin') throw domainError('FORBIDDEN_SCOPE', 'Only an admin can reverse a COD payable entry', 403);
  const operation = 'cod-payable-reversal';
  const requestHash = hashRequest({ entryId: String(entryId), note: note || '' });
  try {
    return await inTransaction(async (session) => {
      const priorId = await idempotentLookup({ actorId: actor.id, operation, key: idempotencyKey, requestHash, session });
      if (priorId) {
        const priorEntry = await LedgerEntry.findById(priorId).session(session);
        if (!priorEntry) throw domainError('LEDGER_ENTRY_NOT_FOUND', 'Ledger entry not found', 404);
        return priorEntry;
      }
      const entry = await applyCodPayableReversal({ entryId, actor, note, session });
      await IdempotencyRecord.create([{ actorId: actor.id, operation, key: idempotencyKey, requestHash, resourceId: entry._id }], { session });
      return entry;
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await IdempotencyRecord.findOne({ actorId: actor.id, operation, key: idempotencyKey });
      if (prior?.requestHash === requestHash) return LedgerEntry.findById(prior.resourceId);
      if (prior) throw domainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different reversal details', 409);
    }
    throw error;
  }
};

module.exports = { recordDelivery, submitCashHandover, reconcileCashHandover, requestPayout, decidePayout, reverseCodPayable };
