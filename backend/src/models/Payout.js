const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
  merchantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  parcelIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', required: true }],
  amountPoisha: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, enum: ['BDT'], default: 'BDT' },
  status: { type: String, enum: ['requested', 'approved', 'paid', 'reversed', 'rejected'], default: 'requested', index: true },
  idempotencyKey: { type: String, required: true },
  requestedAt: { type: Date, default: Date.now },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  reviewNote: { type: String, trim: true, maxlength: 1000 },
  paidAt: Date,
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  paymentReference: { type: String, trim: true },
  reversedAt: Date,
  reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reversalReference: { type: String, trim: true, maxlength: 120 },
  reversalNote: { type: String, maxlength: 1000 }
}, { timestamps: true });

payoutSchema.index({ merchantId: 1, idempotencyKey: 1 }, { unique: true });
payoutSchema.index({ merchantId: 1, createdAt: -1, _id: -1 });
payoutSchema.index({ status: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('Payout', payoutSchema);
