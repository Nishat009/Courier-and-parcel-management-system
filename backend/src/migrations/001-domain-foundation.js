const User = require('../models/User');
const Parcel = require('../models/Parcel');

module.exports = {
  name: '001-domain-foundation',
  checksum: '001-domain-foundation-v1',
  async up() {
    await User.updateMany({ accountStatus: { $exists: false } }, { $set: { accountStatus: 'active' } });
    await Parcel.updateMany({ merchantId: { $exists: false }, customerId: { $exists: true } }, [
      { $set: { merchantId: '$customerId' } }
    ]);
    await Parcel.updateMany({ cod: { $exists: false } }, { $set: { cod: { status: 'not_due' } } });
  }
};
