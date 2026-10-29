const express = require('express');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Parcel = require('../models/Parcel');
const DeliveryProof = require('../models/DeliveryProof');
const auth = require('../middleware/auth');
const { attachProofMetadata } = require('../utils/delivery-proofs');
const { createPrivateStorageProvider } = require('../providers/storage');
const { createMongoGridFsAdapter } = require('../providers/storage/mongodb-gridfs');
const { parsePagination } = require('../utils/pagination');

const privateStorage = () => createPrivateStorageProvider({ adapter: createMongoGridFsAdapter(mongoose.connection.db) });

const router = express.Router();

router.get('/parcels', auth(['rider']), async (req, res) => {
  const pagination = parsePagination(req.query, { defaultLimit: 30 });
  if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
  const { page, limit, skip } = pagination;
  const validStatuses = ['Processing', 'Booked', 'Picked Up', 'At Origin Hub', 'In Transit', 'At Destination Hub', 'Out for Delivery', 'Delivered', 'Delivery Failed'];
  if (req.query.status && !validStatuses.includes(req.query.status)) return res.status(400).json({ msg: 'Choose a valid rider parcel status' });
  const branchIds = (req.user.branchIds || []).filter(mongoose.isValidObjectId);
  const filter = {
    riderId: req.user.id,
    $or: [
      { status: { $in: ['Processing', 'Booked', 'Picked Up', 'At Origin Hub', 'In Transit'] }, originBranchId: { $in: branchIds } },
      { status: { $in: ['At Destination Hub', 'Out for Delivery', 'Delivered', 'Delivery Failed'] }, destinationBranchId: { $in: branchIds } }
    ]
  };
  if (req.query.status) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    Parcel.find(filter).select('-qrCode -coordinates').populate('originBranchId', 'code name city').populate('destinationBranchId', 'code name city').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Parcel.countDocuments(filter)
  ]);
  res.json({ items: await attachProofMetadata(items), page, limit, total, pages: Math.ceil(total / limit) });
});

const detectImageType = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
};

router.post('/parcels/:id/proofs', auth(['rider']), express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ msg: 'Invalid parcel ID' });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ msg: 'Choose a JPEG, PNG, or WebP delivery photo' });
  const actualType = detectImageType(req.body);
  if (!actualType || actualType !== req.headers['content-type']) return res.status(415).json({ msg: 'Photo content does not match an allowed image type' });
  let storedKey;
  try {
    const branchIds = (req.user.branchIds || []).filter(mongoose.isValidObjectId);
    const parcel = await Parcel.findOne({ _id: req.params.id, riderId: req.user.id, status: 'Delivered', destinationBranchId: { $in: branchIds } }).select('_id trackingCode');
    if (!parcel) return res.status(404).json({ msg: 'Delivered parcel not found in your assignments' });
    const storage = privateStorage();
    const stored = await storage.put({ ownerId: req.user.id, file: req.body, contentType: actualType, metadata: { parcelId: String(parcel._id) } });
    storedKey = stored.key;
    const [proof] = await DeliveryProof.create([{
      parcelId: parcel._id, fileId: storedKey, contentType: actualType, sizeBytes: req.body.length,
      sha256: crypto.createHash('sha256').update(req.body).digest('hex'), uploadedBy: req.user.id
    }]);
    return res.status(201).json({ proof: { _id: proof._id, parcelId: proof.parcelId, contentType: proof.contentType, sizeBytes: proof.sizeBytes, uploadedAt: proof.uploadedAt } });
  } catch (error) {
    if (storedKey) await privateStorage().remove({ key: storedKey }).catch(() => {});
    console.error('Private delivery proof upload failed:', error.message);
    return res.status(503).json({ msg: 'Unable to save delivery proof' });
  }
});

router.get('/proofs/:proofId', auth(['admin', 'operations', 'merchant', 'rider']), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.proofId)) return res.status(404).json({ msg: 'Proof not found' });
  try {
    const proof = await DeliveryProof.findById(req.params.proofId).lean();
    if (!proof) return res.status(404).json({ msg: 'Proof not found' });
    const parcel = await Parcel.findById(proof.parcelId).select('merchantId riderId originBranchId destinationBranchId').lean();
    if (!parcel) return res.status(404).json({ msg: 'Proof not found' });
    let allowed = req.user.role === 'admin' || (req.user.role === 'rider' && String(parcel.riderId) === req.user.id && (req.user.branchIds || []).some((branchId) => String(branchId) === String(parcel.destinationBranchId))) ||
      (req.user.role === 'merchant' && String(parcel.merchantId) === req.user.id);
    if (req.user.role === 'operations') {
      const visibleBranches = [parcel.originBranchId, parcel.destinationBranchId].filter(Boolean).map(String);
      allowed = req.user.branchIds.some((branchId) => visibleBranches.includes(branchId));
    }
    if (!allowed) return res.status(404).json({ msg: 'Proof not found' });
    res.set({ 'Content-Type': proof.contentType, 'Content-Length': String(proof.sizeBytes), 'Content-Disposition': 'attachment; filename="delivery-proof"', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    const download = await privateStorage().open({ key: String(proof.fileId), actor: req.user });
    download.on('error', (error) => { if (!res.headersSent) res.status(404).json({ msg: 'Proof file not found' }); else res.destroy(error); });
    download.pipe(res);
  } catch (error) {
    console.error('Private delivery proof lookup failed:', error.message);
    if (!res.headersSent) res.status(503).json({ msg: 'Unable to load delivery proof' });
  }
});

module.exports = router;
