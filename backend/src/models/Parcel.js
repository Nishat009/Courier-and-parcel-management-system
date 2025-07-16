const mongoose = require('mongoose');
const parcelSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  pickupAddress: { type: String, required: true },
  deliveryAddress: { type: String, required: true },
  parcelType: { type: String, required: true },
  paymentType: { type: String, enum: ['COD', 'prepaid'], required: true },
  status: { type: String, enum: ['Booked', 'Picked Up', 'In Transit', 'Delivered', 'Failed'], default: 'Booked' },
  qrCode: { type: String },
  coordinates: { lat: Number, lng: Number },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Parcel', parcelSchema);