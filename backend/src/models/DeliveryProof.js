const mongoose = require('mongoose');

const deliveryProofSchema = new mongoose.Schema({
  parcelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', required: true, index: true },
  fileId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  contentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
  sizeBytes: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024 },
  sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedAt: { type: Date, default: Date.now }
}, { versionKey: false });

deliveryProofSchema.index({ parcelId: 1, uploadedAt: 1 });
module.exports = mongoose.model('DeliveryProof', deliveryProofSchema);
