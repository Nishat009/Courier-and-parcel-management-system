const authenticateToken = require('../utils/authenticateToken');
const { COOKIE_NAME, readCookie, resolveSession } = require('../utils/sessions');
const User = require('../models/User');

const authenticateSession = async (token) => {
  const session = await resolveSession(token);
  if (!session) {
    const error = new Error('Your session is invalid or expired. Please sign in again.');
    error.status = 401;
    throw error;
  }
  const user = await User.findById(session.userId).select('_id name email role accountStatus branchIds');
  if (!user || user.accountStatus !== 'active') {
    const error = new Error('This account is no longer available. Please sign in again.');
    error.status = 401;
    throw error;
  }
  return { id: String(user._id), name: user.name, email: user.email, role: user.role, accountStatus: user.accountStatus || 'active', branchIds: (user.branchIds || []).map(String) };
};

const auth = (roles = []) => {
  return async (req, res, next) => {
    try {
      const sessionToken = readCookie(req.headers?.cookie, COOKIE_NAME);
      const authorization = req.header('Authorization');
      const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (sessionToken) req.user = await authenticateSession(sessionToken);
      else if (bearerToken && (process.env.NODE_ENV !== 'production' || process.env.LEGACY_BEARER_AUTH === 'true')) req.user = await authenticateToken(bearerToken);
      else return res.status(401).json({ msg: 'Authentication required' });
      if (roles.length && !roles.includes(req.user.role)) {
        return res.status(403).json({ msg: 'Access denied' });
      }
      next();
    } catch (error) {
      res.status(error.status || 503).json({ msg: error.message });
    }
  };
};

module.exports = auth;
module.exports.authenticateSession = authenticateSession;
