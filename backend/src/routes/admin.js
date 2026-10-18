const express = require('express');
const Parcel = require('../models/Parcel');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();

router.patch('/users/:id/role', auth(['admin']), async (req, res) => {
  const { role } = req.body || {};
  if (!User.base.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ msg: 'Invalid user ID' });
  }
  if (!['admin', 'customer'].includes(role)) {
    return res.status(400).json({ msg: 'Choose either the admin or customer role' });
  }
  if (req.params.id.toLowerCase() === req.user.id.toLowerCase()) {
    return res.status(400).json({ msg: 'You cannot change your own role' });
  }

  try {
    const user = await User.findById(req.params.id).select('_id name email role');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    if (user.role === 'agent') {
      return res.status(400).json({ msg: 'Delivery agent accounts cannot be changed to admin or customer here' });
    }
    if (user.role !== role) {
      user.role = role;
      await user.save();
      // Remove existing sockets from privileged rooms immediately.
      req.io.to(`user:${user._id}`).emit('roleChanged', { role });
      req.io.in(`user:${user._id}`).disconnectSockets(true);
    }
    res.json({ user: { id: String(user._id), name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('User role update failed:', err);
    res.status(500).json({ msg: 'Unable to update this user role' });
  }
});

router.get('/dashboard', auth(['admin']), async (req, res) => {
  try {
    const today = new Date(new Date().setHours(0, 0, 0, 0));
    const dailyBookings = await Parcel.countDocuments({
      status: { $ne: 'Processing' },
      $or: [
        { acceptedAt: { $gte: today } },
        { acceptedAt: { $exists: false }, createdAt: { $gte: today } }
      ]
    });
    const processingParcels = await Parcel.countDocuments({ status: 'Processing' });
    const failedDeliveries = await Parcel.countDocuments({ status: 'Failed' });
    const codAmounts = await Parcel.aggregate([
      { $match: { paymentType: 'COD', status: 'Delivered' } },
      { $group: { _id: null, total: { $sum: 1 } } }
    ]);
    res.json({ dailyBookings, processingParcels, failedDeliveries, codAmounts: codAmounts[0]?.total || 0 });
  } catch (err) {
    console.error('Admin dashboard lookup failed:', err);
    res.status(500).json({ msg: 'Unable to load dashboard metrics' });
  }
});

router.get('/users', auth(['admin']), async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    console.error('Admin user lookup failed:', err);
    res.status(500).json({ msg: 'Unable to load users' });
  }
});

router.get('/bookings', auth(['admin']), async (req, res) => {
  try {
    const bookings = await Parcel.find().sort({ createdAt: -1 }).populate('customerId', 'name email').populate('agentId', 'name email');
    res.json(bookings);
  } catch (err) {
    console.error('Admin booking lookup failed:', err);
    res.status(500).json({ msg: 'Unable to load bookings' });
  }
});

module.exports = router; // Ensure this export exists
