const authenticateToken = require('../utils/authenticateToken');

const auth = (roles = []) => {
  return async (req, res, next) => {
    const authorization = req.header('Authorization');
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });
    try {
      req.user = await authenticateToken(token);
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
