const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authenticationError = (message, status = 401) => Object.assign(new Error(message), { status });

// Always read the current role. A signed token identifies an account; its cached
// role must not keep granting permissions after an administrator changes it.
const authenticateToken = async (token) => {
  if (!token) throw authenticationError('Authentication required');
  if (!process.env.JWT_SECRET) {
    throw authenticationError('Server authentication is not configured', 503);
  }

  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof claims.id !== 'string' || !/^[a-f\d]{24}$/i.test(claims.id)) {
      throw new Error('Invalid account ID');
    }
  } catch {
    throw authenticationError('Your session is invalid or expired. Please sign in again.');
  }

  let user;
  try {
    user = await User.findById(claims.id).select('_id name email role');
  } catch {
    throw authenticationError('Unable to verify your account. Please try again.', 503);
  }
  if (!user || !['admin', 'customer', 'agent'].includes(user.role)) {
    throw authenticationError('This account is no longer available. Please sign in again.');
  }
  return { id: String(user._id), name: user.name, email: user.email, role: user.role };
};

module.exports = authenticateToken;
