const Parcel = require('../../models/Parcel');
const LedgerEntry = require('../../models/LedgerEntry');

const eligibleForPayout = (parcel) => Boolean(
  parcel &&
  parcel.status === 'Delivered' &&
  parcel.paymentType === 'COD' &&
  parcel.cod?.status === 'reconciled' &&
  Number.isSafeInteger(parcel.priceSnapshot?.merchantNetPoisha) &&
  parcel.priceSnapshot.merchantNetPoisha > 0
);

const findLedgerBackedEligibleParcels = async ({ merchantId, session }) => {
  const parcelQuery = Parcel.find({
    merchantId,
    status: 'Delivered',
    paymentType: 'COD',
    'cod.status': 'reconciled',
    'priceSnapshot.merchantNetPoisha': { $gt: 0 }
  }).select('_id merchantId paymentType status cod.status priceSnapshot.merchantNetPoisha');
  if (session) parcelQuery.session(session);
  const parcels = await parcelQuery.lean();
  if (!parcels.length) return [];

  const parcelIds = parcels.map((parcel) => parcel._id);
  const payableQuery = LedgerEntry.find({ merchantId, parcelId: { $in: parcelIds }, type: 'cod_payable' }).select('_id parcelId amountPoisha');
  if (session) payableQuery.session(session);
  const entries = await payableQuery.lean();
  if (!entries.length) return [];
  const entryIds = entries.map((entry) => entry._id);
  const reversalQuery = LedgerEntry.find({ reversesEntryId: { $in: entryIds } }).select('reversesEntryId');
  if (session) reversalQuery.session(session);
  const reversals = await reversalQuery.lean();
  const reversedIds = new Set(reversals.map((entry) => String(entry.reversesEntryId)));
  const entriesByParcel = new Map();
  for (const entry of entries) {
    const key = String(entry.parcelId);
    entriesByParcel.set(key, [...(entriesByParcel.get(key) || []), entry]);
  }
  return parcels.filter((parcel) => {
    if (!eligibleForPayout(parcel)) return false;
    const payableEntries = entriesByParcel.get(String(parcel._id)) || [];
    return payableEntries.length === 1 &&
      payableEntries[0].amountPoisha === parcel.priceSnapshot.merchantNetPoisha &&
      !reversedIds.has(String(payableEntries[0]._id));
  });
};

module.exports = { eligibleForPayout, findLedgerBackedEligibleParcels };
