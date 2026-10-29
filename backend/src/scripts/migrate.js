const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Migration = require('../models/Migration');
// Register all schemas before connecting, then wait for their indexes before
// applying any data migration that assumes those unique constraints exist.
const modelNames = [
  '../models/User', '../models/Branch', '../models/MerchantProfile', '../models/Parcel',
  '../models/ParcelEvent', '../models/LedgerEntry', '../models/CashHandover',
  '../models/CashHandoverReview', '../models/Payout', '../models/IdempotencyRecord', '../models/Session',
  '../models/PricingPolicy', '../models/DeliveryProof', '../models/RateLimitBucket', '../models/NotificationOutbox'
];
const models = [Migration, ...modelNames.map((model) => require(model))];
const migrationDirectory = path.join(__dirname, '..', 'migrations');

const run = async ({ mongoUri = process.env.MONGO_URI, connectionOptions = {} } = {}) => {
  if (!mongoUri) throw new Error('Configure MONGO_URI before running migrations');
  await mongoose.connect(mongoUri, connectionOptions);
  await Promise.all(models.map((model) => model.init()));
  const files = fs.readdirSync(migrationDirectory).filter((file) => /^\d+.*\.js$/.test(file)).sort();
  for (const file of files) {
    const migration = require(path.join(migrationDirectory, file));
    const source = fs.readFileSync(path.join(migrationDirectory, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(source).digest('hex');
    const prior = await Migration.findOne({ name: migration.name });
    if (prior) {
      if (prior.checksum !== checksum) throw new Error(`Applied migration ${migration.name} was edited; create a new migration instead`);
      console.log(`Already applied: ${migration.name}`);
      continue;
    }
    await migration.up();
    await Migration.create({ name: migration.name, checksum });
    console.log(`Applied migration: ${migration.name}`);
  }
};

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message || 'Migration failed');
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}

module.exports = { run };
