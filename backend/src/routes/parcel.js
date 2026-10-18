const express = require('express');
const Parcel = require('../models/Parcel');
const User = require('../models/User');
const auth = require('../middleware/auth');
const sendEmail = require('../utils/sendEmail');
const QRCode = require('qrcode');

const router = express.Router(); // Initialize router
const allowedTransitions = {
  Processing: [],
  Booked: ['Picked Up', 'Failed'],
  'Picked Up': ['In Transit', 'Failed'],
  'In Transit': ['Delivered', 'Failed'],
  Delivered: [],
  Failed: []
};

router.post('/book', auth(['customer']), async (req, res) => {
  const { pickupAddress, deliveryAddress, parcelType, paymentType } = req.body || {};
  if (
    ![pickupAddress, deliveryAddress, parcelType].every((value) => typeof value === 'string' && value.trim()) ||
    !['COD', 'prepaid'].includes(paymentType)
  ) {
    return res.status(400).json({ msg: 'Pickup address, delivery address, parcel type, and a valid payment type are required' });
  }

  try {
    const parcel = new Parcel({
      customerId: req.user.id,
      pickupAddress: pickupAddress.trim(),
      deliveryAddress: deliveryAddress.trim(),
      parcelType: parcelType.trim(),
      paymentType,
      status: 'Processing'
    });
    await parcel.save();
    req.io.to('admins').emit('parcelRequested', { _id: parcel._id });
    res.status(201).json(parcel);
  } catch (err) {
    console.error('Parcel booking failed:', err);
    res.status(500).json({ msg: 'Unable to book parcel' });
  }
});

router.put('/accept/:id', auth(['admin']), async (req, res) => {
  if (!Parcel.base.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ msg: 'Invalid parcel ID' });
  }
  try {
    const qrCode = await QRCode.toDataURL(req.params.id);
    const parcel = await Parcel.findOneAndUpdate(
      { _id: req.params.id, status: 'Processing' },
      { $set: { status: 'Booked', acceptedAt: new Date(), acceptedBy: req.user.id, qrCode } },
      { new: true, runValidators: true }
    );
    if (!parcel) {
      const exists = await Parcel.exists({ _id: req.params.id });
      return res.status(exists ? 409 : 404).json({ msg: exists ? 'Only Processing requests can be accepted. This parcel may already have been accepted.' : 'Parcel not found' });
    }
    const update = { _id: parcel._id, status: parcel.status, acceptedAt: parcel.acceptedAt, qrCode: parcel.qrCode };
    req.io.to(`customer:${parcel.customerId}`).emit('statusUpdate', update);
    req.io.to('admins').emit('statusUpdate', update);
    res.json(parcel);
  } catch (err) {
    console.error('Parcel acceptance failed:', err);
    res.status(500).json({ msg: 'Unable to accept this booking request' });
  }
});

router.get('/my-parcels', auth(['customer']), async (req, res) => {
  try {
    const parcels = await Parcel.find({ customerId: req.user.id }).sort({ createdAt: -1 });
    res.json(parcels);
  } catch (err) {
    console.error('Customer parcel lookup failed:', err);
    res.status(500).json({ msg: 'Unable to load parcels' });
  }
});

router.get('/assigned', auth(['agent']), async (req, res) => {
  try {
    const parcels = await Parcel.find({ agentId: req.user.id, status: { $ne: 'Processing' } }).sort({ createdAt: -1 });
    res.json(parcels);
  } catch (err) {
    console.error('Assigned parcel lookup failed:', err);
    res.status(500).json({ msg: 'Unable to load assigned parcels' });
  }
});

router.put('/assign/:id', auth(['admin']), async (req, res) => {
  const { agentId } = req.body || {};
  if (!Parcel.base.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ msg: 'Invalid parcel ID' });
  }
  if (typeof agentId !== 'string' || !Parcel.base.Types.ObjectId.isValid(agentId)) {
    return res.status(400).json({ msg: 'A valid agent ID is required' });
  }

  try {
    const agent = await User.findOne({ _id: agentId, role: 'agent' }).select('_id');
    if (!agent) return res.status(400).json({ msg: 'Agent not found' });
    const parcel = await Parcel.findOneAndUpdate(
      { _id: req.params.id, status: { $ne: 'Processing' } },
      { agentId: agent._id },
      { new: true, runValidators: true }
    );
    if (!parcel) {
      const exists = await Parcel.exists({ _id: req.params.id });
      return res.status(exists ? 409 : 404).json({ msg: exists ? 'Accept this booking request before assigning an agent' : 'Parcel not found' });
    }
    req.io.to(`agent:${agent._id}`).emit('parcelAssigned', parcel);
    res.json(parcel);
  } catch (err) {
    console.error('Parcel assignment failed:', err);
    res.status(500).json({ msg: 'Unable to assign parcel' });
  }
});

router.put('/status/:id', auth(['admin', 'agent']), async (req, res) => {
  const { status, coordinates } = req.body || {};
  if (!Parcel.base.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ msg: 'Invalid parcel ID' });
  }
  const validStatuses = ['Picked Up', 'In Transit', 'Delivered', 'Failed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ msg: 'Invalid parcel status' });
  }
  if (
    coordinates &&
    (typeof coordinates.lat !== 'number' || coordinates.lat < -90 || coordinates.lat > 90 ||
      typeof coordinates.lng !== 'number' || coordinates.lng < -180 || coordinates.lng > 180)
  ) {
    return res.status(400).json({ msg: 'Coordinates must contain valid latitude and longitude values' });
  }

  try {
    const parcelQuery = req.user.role === 'admin'
      ? Parcel.findById(req.params.id)
      : Parcel.findOne({ _id: req.params.id, agentId: req.user.id });
    const parcel = await parcelQuery;
    if (!parcel) return res.status(404).json({ msg: 'Parcel not found or not assigned to you' });
    if (!(allowedTransitions[parcel.status] || []).includes(status)) {
      return res.status(400).json({ msg: `Cannot change parcel status from ${parcel.status} to ${status}` });
    }
    parcel.status = status;
    if (coordinates) parcel.coordinates = coordinates;
    await parcel.save();
    const update = { _id: parcel._id, status: parcel.status, coordinates: parcel.coordinates };
    req.io.to(`customer:${parcel.customerId}`).emit('statusUpdate', update);
    req.io.to('admins').emit('statusUpdate', update);
    if (req.user.role === 'agent') req.io.to(`agent:${req.user.id}`).emit('statusUpdate', update);

    if (process.env.NODEMAILER_EMAIL && process.env.NODEMAILER_PASS) {
      try {
        const customer = await User.findById(parcel.customerId).select('email');
        if (!customer) throw new Error(`Customer not found for parcel ${parcel._id}`);
        await sendEmail(customer.email, `Parcel Status Update: ${status}`, `Your parcel (ID: ${parcel._id}) is now ${status}.`);
      } catch (emailError) {
        console.error('Parcel status email failed:', emailError);
      }
    }
    res.json(parcel);
  } catch (err) {
    console.error('Parcel status update failed:', err);
    res.status(500).json({ msg: 'Unable to update parcel status' });
  }
});

module.exports = router; // Export the router
