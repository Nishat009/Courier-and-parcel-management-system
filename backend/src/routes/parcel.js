const express = require('express');
const Parcel = require('../models/Parcel');
const auth = require('../middleware/auth');

const router = express.Router();
const legacyWriteDisabled = (_req, res) => res.status(410).json({
  msg: 'Legacy customer and agent parcel workflows are retired. Apply for an approved merchant account or use the branch operations workflow.'
});

// Keep historical records readable for existing accounts, but direct all new
// bookings and operational changes through the validated merchant workflows.
router.post('/book', auth(['customer']), legacyWriteDisabled);
router.put('/accept/:id', auth(['admin']), legacyWriteDisabled);
router.put('/assign/:id', auth(['admin']), legacyWriteDisabled);
router.put('/status/:id', auth(['admin', 'agent']), legacyWriteDisabled);

router.get('/my-parcels', auth(['customer']), async (req, res) => {
  try {
    const parcels = await Parcel.find({ customerId: req.user.id }).select('-coordinates').sort({ createdAt: -1 });
    res.json(parcels);
  } catch (err) {
    console.error('Customer parcel lookup failed:', err);
    res.status(500).json({ msg: 'Unable to load parcels' });
  }
});

router.get('/assigned', auth(['agent']), async (req, res) => {
  try {
    const parcels = await Parcel.find({ agentId: req.user.id, status: { $ne: 'Processing' } }).select('-coordinates').sort({ createdAt: -1 });
    res.json(parcels);
  } catch (err) {
    console.error('Assigned parcel lookup failed:', err);
    res.status(500).json({ msg: 'Unable to load assigned parcels' });
  }
});

module.exports = router;
