const express = require('express');
const Branch = require('../models/Branch');
const auth = require('../middleware/auth');
const { createMerchantBooking } = require('../domain/parcels/service');

const router = express.Router();

router.get('/options', auth(['admin', 'operations']), async (req, res) => {
  try {
    const [originBranches, destinationBranches] = await Promise.all([
      Branch.find({ active: true, ...(req.user.role === 'operations' ? { _id: { $in: req.user.branchIds } } : {}) })
        .select('code name city address').sort({ city: 1, name: 1 }).lean(),
      Branch.find({ active: true }).select('code name city address').sort({ city: 1, name: 1 }).lean()
    ]);
    res.json({ originBranches, destinationBranches });
  } catch (error) {
    console.error('Operations booking options lookup failed:', error.message);
    res.status(503).json({ msg: 'Unable to load booking branches' });
  }
});

router.post('/', auth(['admin', 'operations']), async (req, res) => {
  try {
    const parcel = await createMerchantBooking({ actor: req.user, input: req.body || {}, idempotencyKey: req.header('Idempotency-Key') });
    req.io.to(`merchant:${parcel.merchantId}`).emit('statusUpdate', { _id: parcel._id, status: parcel.status });
    req.io.to('admins').emit('parcelRequested', { _id: parcel._id });
    req.io.to(`branch:${parcel.originBranchId}`).emit('parcelChanged', { _id: parcel._id, status: parcel.status });
    req.io.to('all-branches').emit('parcelChanged', { _id: parcel._id, status: parcel.status });
    res.status(201).json(parcel);
  } catch (error) {
    res.status(error.status || 503).json({ msg: error.message || 'Unable to create booking', code: error.code });
  }
});

module.exports = router;
