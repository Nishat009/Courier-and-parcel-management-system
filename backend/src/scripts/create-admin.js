const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { parseArgs } = require('node:util');
const mongoose = require('mongoose');
const createAdmin = require('../utils/createAdmin');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const main = async () => {
  const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
  const email = values.email || process.env.ADMIN_EMAIL;
  if (!email) throw new Error('Run: npm run create-admin -- --email admin@example.com [--name "Administrator"]');
  if (!process.env.MONGO_URI) throw new Error('Configure MONGO_URI in backend/.env first');

  const generatedPassword = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || randomBytes(18).toString('base64url');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  const { user, created } = await createAdmin({ email, name: values.name || process.env.ADMIN_NAME || 'Administrator', password });
  if (!created) {
    console.log(`Admin already exists: ${user.email}. Its password was not changed.`);
    return;
  }
  console.log(`Admin created: ${user.email}`);
  if (generatedPassword) console.log(`Password (save it now): ${password}`);
  else console.log('Use the ADMIN_PASSWORD you supplied to sign in.');
};

main().catch((error) => {
  // Database errors may include connection credentials. Keep CLI output private.
  console.error(error.name === 'Error' ? error.message : 'Could not create the admin. Check MONGO_URI and database availability. Existing accounts are never overwritten.');
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
