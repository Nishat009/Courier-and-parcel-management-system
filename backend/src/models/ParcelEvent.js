const mongoose = require('mongoose');

const parcelEventSchema = new mongoose.Schema({
  parcelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', required: true, index: true },
  type: { type: String, required: true, trim: true },
  fromStatus: String,
  toStatus: String,
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorRole: { type: String, required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
  riderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  note: { type: String, maxlength: 1000 },
  proofRef: { type: String, select: false }
}, { timestamps: { createdAt: true, updatedAt: false }, strict: true });

parcelEventSchema.index({ parcelId: 1, createdAt: 1 });
parcelEventSchema.pre('save', function rejectMutation() { if (!this.isNew) throw new Error('Parcel events are append-only'); });
parcelEventSchema.pre('findOneAndUpdate', function rejectMutation() { throw new Error('Parcel events are append-only'); });
parcelEventSchema.pre('updateOne', function rejectMutation() { throw new Error('Parcel events are append-only'); });
parcelEventSchema.pre('deleteOne', function rejectMutation() { throw new Error('Parcel events are append-only'); });
parcelEventSchema.pre('updateMany', function rejectMutation() { throw new Error('Parcel events are append-only'); });
parcelEventSchema.pre('deleteMany', function rejectMutation() { throw new Error('Parcel events are append-only'); });
parcelEventSchema.pre('findOneAndDelete', function rejectMutation() { throw new Error('Parcel events are append-only'); });
parcelEventSchema.pre('replaceOne', function rejectMutation() { throw new Error('Parcel events are append-only'); });
parcelEventSchema.pre('findOneAndReplace', function rejectMutation() { throw new Error('Parcel events are append-only'); });
parcelEventSchema.pre('bulkWrite', function rejectBulkMutation() { throw new Error('Bulk writes cannot mutate append-only parcel events'); });

module.exports = mongoose.model('ParcelEvent', parcelEventSchema);
