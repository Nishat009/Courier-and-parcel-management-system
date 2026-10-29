const mongoose = require('mongoose');

const merchantProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  businessName: { type: String, required: true, trim: true },
  contactName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  pickupAddress: { type: String, required: true, trim: true },
  defaultBranchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'suspended'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  reviewNote: { type: String, maxlength: 500 },
  reviewHistory: [{
    status: { type: String, enum: ['approved', 'rejected', 'suspended'], required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, maxlength: 500, default: '' },
    changedAt: { type: Date, required: true }
  }]
}, { timestamps: true });

merchantProfileSchema.index({ status: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('MerchantProfile', merchantProfileSchema);
