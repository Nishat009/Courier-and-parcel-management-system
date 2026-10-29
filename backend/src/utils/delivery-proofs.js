const DeliveryProof = require('../models/DeliveryProof');

const attachProofMetadata = async (parcels = []) => {
  if (!parcels.length) return parcels;
  const proofs = await DeliveryProof.find({ parcelId: { $in: parcels.map((parcel) => parcel._id) } })
    .select('parcelId contentType sizeBytes uploadedAt')
    .sort({ uploadedAt: 1 })
    .lean();
  const byParcel = new Map();
  for (const proof of proofs) {
    const key = String(proof.parcelId);
    byParcel.set(key, [...(byParcel.get(key) || []), proof]);
  }
  return parcels.map((parcel) => ({ ...parcel, proofs: byParcel.get(String(parcel._id)) || [] }));
};

module.exports = { attachProofMetadata };
