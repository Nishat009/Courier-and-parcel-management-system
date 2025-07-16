const express = require('express');
const Parcel = require('../models/Parcel');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();

router.get('/dashboard', auth(['admin']), async (req, res) => {
  try {
    const dailyBookings = await Parcel.countDocuments({ createdAt: { $gte: new Date().setHours(0, 0, 0, 0) } });
    const failedDeliveries = await Parcel.countDocuments({ status: 'Failed' });
    const codAmounts = await Parcel.aggregate([
      { $match: { paymentType: 'COD', status: 'Delivered' } },
      { $group: { _id: null, total: { $sum: 1 } } }
    ]);
    res.json({ dailyBookings, failedDeliveries, codAmounts: codAmounts[0]?.total || 0 });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

router.get('/users', auth(['admin']), async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

router.get('/bookings', auth(['admin']), async (req, res) => {
  try {
    const bookings = await Parcel.find().populate('customerId agentId');
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router; // Ensure this export exists