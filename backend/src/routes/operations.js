const express = require('express');
const mongoose = require('mongoose');
const Parcel = require('../models/Parcel');
const ParcelEvent = require('../models/ParcelEvent');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { transitionParcel, assignRider } = require('../domain/parcels/service');
const { states } = require('../domain/parcels/state-machine');
const { attachProofMetadata } = require('../utils/delivery-proofs');
const { parsePagination } = require('../utils/pagination');
const { optionalQueryString, INVALID_QUERY_STRING } = require('../utils/query-string');

const router = express.Router();

router.get('/', auth(['admin', 'operations']), async (req, res) => {
  const pagination = parsePagination(req.query, { defaultLimit: 25 });
  if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
  const { page, limit, skip } = pagination;
  if (req.query.status && !states.includes(req.query.status)) return res.status(400).json({ msg: 'Choose a valid parcel status' });
  const filter = req.user.role === 'admin'
    ? { merchantId: { $exists: true }, originBranchId: { $exists: true, $ne: null }, destinationBranchId: { $exists: true, $ne: null } }
    : { merchantId: { $exists: true }, $or: [{ originBranchId: { $in: req.user.branchIds } }, { destinationBranchId: { $in: req.user.branchIds } }] };
  if (typeof req.query.status === 'string') filter.status = req.query.status;
  const trackingSearch = optionalQueryString(req.query.q, 40);
  if (trackingSearch === INVALID_QUERY_STRING) return res.status(400).json({ msg: 'Tracking-code search must be one value of at most 40 characters' });
  const normalizedTrackingSearch = trackingSearch.toUpperCase();
  if (normalizedTrackingSearch) filter.trackingCode = { $regex: `^${normalizedTrackingSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
  try {
    const [items, total] = await Promise.all([
      Parcel.find(filter).select('-qrCode -coordinates').populate('merchantId', 'name email').populate('riderId', 'name phone').populate('originBranchId', 'code name city').populate('destinationBranchId', 'code name city').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Parcel.countDocuments(filter)
    ]);
    res.json({ items: await attachProofMetadata(items), page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Operations parcel lookup failed:', error.message);
    res.status(503).json({ msg: 'Unable to load operations parcels' });
  }
});

router.get('/:id/events', auth(['admin', 'operations']), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ msg: 'Parcel not found' });
  try {
    const parcel = await Parcel.findOne({
      _id: req.params.id,
      merchantId: { $exists: true },
      originBranchId: { $exists: true, $ne: null },
      destinationBranchId: { $exists: true, $ne: null }
    }).select('_id originBranchId destinationBranchId').lean();
    if (!parcel) return res.status(404).json({ msg: 'Parcel not found' });
    if (req.user.role === 'operations') {
      const branchIds = new Set(req.user.branchIds || []);
      if (![parcel.originBranchId, parcel.destinationBranchId].some((branchId) => branchIds.has(String(branchId)))) {
        return res.status(404).json({ msg: 'Parcel not found' });
      }
    }
    const pagination = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });
    if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
    const { page, limit, skip } = pagination;
    const filter = { parcelId: parcel._id };
    const [items, total] = await Promise.all([
      ParcelEvent.find(filter).select('type fromStatus toStatus actorRole branchId note createdAt').populate('branchId', 'name city').sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      ParcelEvent.countDocuments(filter)
    ]);
    res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Operations parcel activity lookup failed:', error.message);
    res.status(503).json({ msg: 'Unable to load parcel activity' });
  }
});

router.get('/riders', auth(['admin', 'operations']), async (req, res) => {
  const filter = { role: 'rider', accountStatus: 'active' };
  if (req.user.role === 'operations') filter.branchIds = { $in: req.user.branchIds };
  const riders = await User.find(filter).select('_id name phone branchIds').sort({ name: 1 }).lean();
  res.json({ items: riders });
});

router.put('/:id/transition', auth(['admin', 'operations', 'rider']), async (req, res) => {
  if (!['Booked', 'Picked Up', 'At Origin Hub', 'In Transit', 'At Destination Hub', 'Out for Delivery', 'Delivered', 'Delivery Failed', 'Cancelled'].includes(req.body?.status)) return res.status(400).json({ msg: 'Choose a valid next operational status' });
  if (req.body.status === 'Delivered') return res.status(400).json({ msg: 'Record delivery through the delivery confirmation endpoint so COD is captured correctly' });
  try {
    const parcel = await transitionParcel({ parcelId: req.params.id, toStatus: req.body.status, actor: req.user, note: req.body.note, idempotencyKey: req.header('Idempotency-Key') });
    req.io.to(`merchant:${parcel.merchantId || parcel.customerId}`).emit('statusUpdate', { _id: parcel._id, status: parcel.status });
    req.io.to('admins').emit('statusUpdate', { _id: parcel._id, status: parcel.status });
    for (const branchId of [parcel.originBranchId, parcel.destinationBranchId].filter(Boolean)) req.io.to(`branch:${branchId}`).emit('parcelChanged', { _id: parcel._id, status: parcel.status });
    req.io.to('all-branches').emit('parcelChanged', { _id: parcel._id, status: parcel.status });
    res.json(parcel);
  } catch (error) {
    res.status(error.status || 503).json({ msg: error.message || 'Unable to update parcel', code: error.code });
  }
});

router.patch('/:id/rider', auth(['admin', 'operations']), async (req, res) => {
  try {
    const parcel = await assignRider({ parcelId: req.params.id, riderId: req.body?.riderId, actor: req.user, idempotencyKey: req.header('Idempotency-Key') });
    req.io.to(`rider:${parcel.riderId}`).emit('parcelAssigned', { _id: parcel._id });
    for (const branchId of [parcel.originBranchId, parcel.destinationBranchId].filter(Boolean)) req.io.to(`branch:${branchId}`).emit('parcelChanged', { _id: parcel._id, status: parcel.status });
    req.io.to('all-branches').emit('parcelChanged', { _id: parcel._id, status: parcel.status });
    res.json(parcel);
  } catch (error) {
    res.status(error.status || 503).json({ msg: error.message || 'Unable to assign rider', code: error.code });
  }
});

module.exports = router;
