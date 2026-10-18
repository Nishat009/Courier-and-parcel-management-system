const bcrypt = require('bcryptjs');
const User = require('../models/User');

const createAdmin = async ({ name = 'Administrator', email, password }) => {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new Error('A valid admin email is required');
  }
  if (typeof name !== 'string' || !name.trim()) throw new Error('An admin name is required');
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('The admin password must contain at least 12 characters');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    if (existing.role !== 'admin') {
      throw new Error('This email already belongs to a non-admin account. Use a different email or change its role from the admin dashboard.');
    }
    return { user: existing, created: false };
  }
  const user = await User.create({ name: name.trim(), email: normalizedEmail, password: await bcrypt.hash(password, 12), role: 'admin' });
  return { user, created: true };
};

module.exports = createAdmin;
