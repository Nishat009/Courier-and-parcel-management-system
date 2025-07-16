const express = require('express');
const Parcel = require('../models/Parcel');
const auth = require('../middleware/auth');
const sendEmail = require('../utils/sendEmail');

const router = express.Router(); // Initialize router

router.put('/status/:id', auth(['agent']), async (req, res) => {
  const { status, coordinates } = req.body;
  try {
    const parcel = await Parcel.findById(req.params.id).populate('customerId');
    if (!parcel) return res.status(404).json({ msg: 'Parcel not found' });
    parcel.status = status;
    if (coordinates) parcel.coordinates = coordinates;
    await parcel.save();
    req.io.emit('statusUpdate', parcel); // Requires io to be attached to req
    await sendEmail(
      parcel.customerId.email,
      `Parcel Status Update: ${status}`,
      `Your parcel (ID: ${parcel._id}) is now ${status}.`
    );
    res.json(parcel);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router; // Export the router