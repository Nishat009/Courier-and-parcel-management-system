const express = require('express');
const mongoose = require('mongoose');
const CashHandover = require('../models/CashHandover');
const CashHandoverReview = require('../models/CashHandoverReview');
const Payout = require('../models/Payout');
const LedgerEntry = require('../models/LedgerEntry');
const auth = require('../middleware/auth');
const { recordDelivery, submitCashHandover, reconcileCashHandover, decidePayout, reverseCodPayable } = require('../domain/finance/settlements');
const { enumQuery, INVALID_ENUM_QUERY } = require('../utils/enum-query');
const { parsePagination } = require('../utils/pagination');

const router = express.Router();

router.post('/deliveries/:parcelId/confirm', auth(['admin', 'operations', 'rider']), async (req, res) => {
  try {
    const parcel = await recordDelivery({ parcelId: req.params.parcelId, amountPoisha: req.body?.collectedAmountPoisha, actor: req.user, idempotencyKey: req.header('Idempotency-Key') });
    req.io.to(`merchant:${parcel.merchantId || parcel.customerId}`).emit('statusUpdate', { _id: parcel._id, status: parcel.status });
    req.io.to(`admins`).emit('statusUpdate', { _id: parcel._id, status: parcel.status });
    req.io.to(`branch:${parcel.destinationBranchId}`).emit('parcelChanged', { _id: parcel._id, status: parcel.status });
    req.io.to('all-branches').emit('parcelChanged', { _id: parcel._id, status: parcel.status });
    res.json({ parcel, collection: parcel.paymentType === 'COD' ? { status: 'collected', amountPoisha: parcel.cod.collectedAmountPoisha } : { status: 'not_due', amountPoisha: 0 } });
  } catch (error) {
    res.status(error.status || 503).json({ msg: error.message || 'Unable to record delivery', code: error.code });
  }
});

router.post('/cash-handovers', auth(['rider']), async (req, res) => {
  try {
    const handover = await submitCashHandover({ actor: req.user, branchId: req.body?.branchId, parcelIds: req.body?.parcelIds, declaredAmountPoisha: req.body?.declaredAmountPoisha, idempotencyKey: req.header('Idempotency-Key') });
    req.io.to(`branch:${handover.branchId}`).emit('cashHandoverChanged', { _id: handover._id, status: handover.status });
    req.io.to('all-branches').emit('cashHandoverChanged', { _id: handover._id, status: handover.status });
    res.status(201).json(handover);
  } catch (error) {
    res.status(error.status || 503).json({ msg: error.message || 'Unable to submit cash handover', code: error.code });
  }
});

router.get('/cash-handovers/mine', auth(['rider']), async (req, res) => {
  const pagination = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });
  if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
  const { page, limit, skip } = pagination;
  const status = enumQuery(req.query.status, ['submitted', 'reconciled', 'disputed']);
  if (status === INVALID_ENUM_QUERY) return res.status(400).json({ msg: 'Choose a valid handover status' });
  const filter = { riderId: req.user.id };
  if (status) filter.status = status;
  const [items, total] = await Promise.all([
    CashHandover.find(filter).select('branchId expectedAmountPoisha declaredAmountPoisha verifiedAmountPoisha status submittedAt verifiedAt').populate('branchId', 'name city').sort({ submittedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    CashHandover.countDocuments(filter)
  ]);
  const reviews = items.length ? await CashHandoverReview.find({ handoverId: { $in: items.map((item) => item._id) } }).select('handoverId attemptNumber expectedAmountPoisha verifiedAmountPoisha outcome reviewedBy createdAt').populate('reviewedBy', 'name').sort({ createdAt: 1 }).lean() : [];
  const reviewsByHandover = new Map();
  for (const review of reviews) {
    const key = String(review.handoverId);
    reviewsByHandover.set(key, [...(reviewsByHandover.get(key) || []), review]);
  }
  res.json({ items: items.map((item) => ({ ...item, reviewAttempts: reviewsByHandover.get(String(item._id)) || [] })), page, limit, total, pages: Math.ceil(total / limit) });
});

router.get('/cash-handovers', auth(['admin', 'accounts']), async (req, res) => {
  const pagination = parsePagination(req.query, { defaultLimit: 20 });
  if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
  const { page, limit, skip } = pagination;
  const status = enumQuery(req.query.status, ['submitted', 'reconciled', 'disputed']);
  if (status === INVALID_ENUM_QUERY) return res.status(400).json({ msg: 'Choose a valid handover status' });
  const filter = req.user.role === 'admin' ? {} : { branchId: { $in: req.user.branchIds } };
  if (status) filter.status = status;
  const [items, total] = await Promise.all([
    CashHandover.find(filter).populate('riderId', 'name phone').populate('branchId', 'name city').populate('parcelIds', 'trackingCode status priceSnapshot.codAmountPoisha cod.collectedAmountPoisha').sort({ submittedAt: -1 }).skip(skip).limit(limit).lean(),
    CashHandover.countDocuments(filter)
  ]);
  const reviews = items.length ? await CashHandoverReview.find({ handoverId: { $in: items.map((item) => item._id) } }).populate('reviewedBy', 'name').sort({ createdAt: 1 }).lean() : [];
  const reviewsByHandover = new Map();
  for (const review of reviews) {
    const key = String(review.handoverId);
    reviewsByHandover.set(key, [...(reviewsByHandover.get(key) || []), review]);
  }
  res.json({ items: items.map((item) => ({ ...item, reviewAttempts: reviewsByHandover.get(String(item._id)) || [] })), page, limit, total, pages: Math.ceil(total / limit) });
});

router.patch('/cash-handovers/:id/reconcile', auth(['admin', 'accounts']), async (req, res) => {
  try {
    const handover = await reconcileCashHandover({ handoverId: req.params.id, verifiedAmountPoisha: req.body?.verifiedAmountPoisha, actor: req.user, idempotencyKey: req.header('Idempotency-Key') });
    req.io.to(`branch:${handover.branchId}`).emit('cashHandoverChanged', { _id: handover._id, status: handover.status });
    req.io.to('all-branches').emit('cashHandoverChanged', { _id: handover._id, status: handover.status });
    req.io.to(`rider:${handover.riderId}`).emit('cashHandoverChanged', { _id: handover._id, status: handover.status });
    res.json(handover);
  } catch (error) {
    res.status(error.status || 503).json({ msg: error.message || 'Unable to reconcile cash', code: error.code });
  }
});

router.get('/payouts', auth(['admin', 'accounts']), async (req, res) => {
  const pagination = parsePagination(req.query, { defaultLimit: 20 });
  if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
  const { page, limit, skip } = pagination;
  const status = enumQuery(req.query.status, ['requested', 'approved', 'paid', 'reversed', 'rejected']);
  if (status === INVALID_ENUM_QUERY) return res.status(400).json({ msg: 'Choose a valid payout status' });
  const filter = {};
  if (status) filter.status = status;
  const [items, total] = await Promise.all([
    Payout.find(filter).populate('merchantId', 'name email').populate('reviewedBy', 'name').populate('paidBy', 'name').populate('reversedBy', 'name').populate('parcelIds', 'trackingCode status priceSnapshot.merchantNetPoisha cod.status').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Payout.countDocuments(filter)
  ]);
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
});

router.get('/ledger', auth(['admin', 'accounts']), async (req, res) => {
  const pagination = parsePagination(req.query, { defaultLimit: 25 });
  if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
  const { page, limit, skip } = pagination;
  const type = enumQuery(req.query.type, ['cod_payable', 'payout_paid', 'reversal', 'adjustment']);
  if (type === INVALID_ENUM_QUERY) return res.status(400).json({ msg: 'Choose a valid ledger entry type' });
  if (req.query.merchantId !== undefined && (typeof req.query.merchantId !== 'string' || !mongoose.isValidObjectId(req.query.merchantId))) {
    return res.status(400).json({ msg: 'Provide a valid merchant ID' });
  }
  const filter = {};
  if (req.query.merchantId !== undefined) filter.merchantId = req.query.merchantId;
  if (type) filter.type = type;
  const [items, total] = await Promise.all([
    LedgerEntry.find(filter).populate('merchantId', 'name email').sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    LedgerEntry.countDocuments(filter)
  ]);
  const reversibleIds = items.filter((item) => ['cod_payable', 'payout_paid'].includes(item.type)).map((item) => item._id);
  const reversals = reversibleIds.length ? await LedgerEntry.find({ reversesEntryId: { $in: reversibleIds } }).select('_id reversesEntryId amountPoisha note externalReference createdAt').lean() : [];
  const reversalByEntryId = new Map(reversals.map((item) => [String(item.reversesEntryId), item]));
  res.json({ items: items.map((item) => {
    const reversal = reversalByEntryId.get(String(item._id));
    return { ...item, reversed: Boolean(reversal), reversal: reversal ? { _id: reversal._id, amountPoisha: reversal.amountPoisha, note: reversal.note, externalReference: reversal.externalReference, createdAt: reversal.createdAt } : null };
  }), page, limit, total, pages: Math.ceil(total / limit) });
});

router.patch('/payouts/:id', auth(['admin', 'accounts']), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ msg: 'Invalid payout ID' });
  const { action, paymentReference, note } = req.body || {};
  try {
    const payout = await decidePayout({ payoutId: req.params.id, action, actor: req.user, paymentReference, note, idempotencyKey: req.header('Idempotency-Key') });
    req.io.to('finance').emit('payoutChanged', { _id: payout._id, status: payout.status });
    req.io.to(`merchant:${payout.merchantId}`).emit('payoutChanged', { _id: payout._id, status: payout.status });
    res.json(payout);
  } catch (error) {
    res.status(error.status || 503).json({ msg: error.message || 'Unable to update payout', code: error.code });
  }
});

router.post('/ledger/:entryId/reverse', auth(['admin']), async (req, res) => {
  try {
    const entry = await reverseCodPayable({ entryId: req.params.entryId, actor: req.user, note: req.body?.note, idempotencyKey: req.header('Idempotency-Key') });
    res.status(201).json({ entry });
  } catch (error) {
    res.status(error.status || 503).json({ msg: error.message || 'Unable to reverse ledger entry', code: error.code });
  }
});

module.exports = router;
