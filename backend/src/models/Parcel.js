const mongoose = require('mongoose');
const parcelSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  merchantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  riderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  originBranchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', index: true },
  destinationBranchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', index: true },
  trackingCode: { type: String, trim: true, uppercase: true },
  pickupAddress: { type: String, required: true },
  deliveryAddress: { type: String, required: true },
  recipientName: { type: String, trim: true, maxlength: 120 },
  recipientPhone: { type: String, trim: true, maxlength: 16 },
  parcelType: { type: String, required: true },
  paymentType: { type: String, enum: ['COD', 'prepaid'], required: true },
  status: { type: String, enum: ['Processing', 'Booked', 'Picked Up', 'At Origin Hub', 'In Transit', 'At Destination Hub', 'Out for Delivery', 'Delivered', 'Delivery Failed', 'Cancelled', 'Failed'], default: 'Processing', index: true },
  priceSnapshot: {
    currency: { type: String, enum: ['BDT'], default: 'BDT' },
    deliveryFeePoisha: { type: Number, min: 0, validate: Number.isSafeInteger },
    codAmountPoisha: { type: Number, min: 0, default: 0, validate: Number.isSafeInteger },
    codFeeBasisPoints: { type: Number, min: 0, max: 10000, validate: Number.isSafeInteger },
    codFeePoisha: { type: Number, min: 0, validate: Number.isSafeInteger },
    merchantNetPoisha: { type: Number, min: 0, validate: Number.isSafeInteger }
  },
  cod: {
    status: { type: String, enum: ['not_due', 'due', 'collected', 'handed_over', 'reconciled', 'payable', 'paid', 'reversed'], default: 'not_due', index: true },
    collectedAmountPoisha: { type: Number, min: 0, validate: Number.isSafeInteger },
    collectedAt: Date,
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    handoverId: { type: mongoose.Schema.Types.ObjectId, ref: 'CashHandover' },
    reconciledAt: Date,
    reversedAt: Date
  },
  acceptedAt: { type: Date },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  qrCode: { type: String },
  coordinates: { lat: Number, lng: Number },
  createdAt: { type: Date, default: Date.now }
});
parcelSchema.index({ trackingCode: 1 }, { unique: true, sparse: true });
parcelSchema.index({ merchantId: 1, createdAt: -1 });
parcelSchema.index({ riderId: 1, status: 1, createdAt: -1 });
parcelSchema.index({ status: 1, createdAt: -1, _id: -1 });
parcelSchema.pre('save', function protectPriceSnapshot() {
  if (!this.isNew && this.isModified('priceSnapshot')) throw new Error('Booking price snapshots are immutable');
});
const updateTouchesPriceSnapshot = (value) => {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => key === 'priceSnapshot' || key.startsWith('priceSnapshot.') || updateTouchesPriceSnapshot(child));
};
for (const hook of ['findOneAndUpdate', 'updateOne', 'updateMany', 'replaceOne', 'findOneAndReplace']) {
  parcelSchema.pre(hook, function protectPriceSnapshotUpdate() {
    if (updateTouchesPriceSnapshot(this.getUpdate())) throw new Error('Booking price snapshots are immutable');
  });
}
module.exports = mongoose.model('Parcel', parcelSchema);
