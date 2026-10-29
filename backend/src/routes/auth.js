const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Session = require('../models/Session');
const auth = require('../middleware/auth');
const { COOKIE_NAME, readCookie, resolveSession, createSession, revokeSession, setSessionCookie, clearSessionCookie } = require('../utils/sessions');
const { inTransaction } = require('../domain/shared/transaction');
const { checkLoginLimit, recordLoginFailure, clearIdentityFailures } = require('../utils/login-rate-limit');
const router = express.Router();
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('courier-invalid-account-password', 12);

router.get('/me', auth(), (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: req.user });
});

router.post('/register', (_req, res) => res.status(410).json({
  msg: 'Customer self-registration is retired. Apply for a merchant account to submit parcel bookings.'
}));

router.post('/password', auth(), async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword || Buffer.byteLength(currentPassword, 'utf8') > 72 ||
      typeof newPassword !== 'string' || newPassword.length < 12 || Buffer.byteLength(newPassword, 'utf8') > 72) {
    return res.status(400).json({ msg: 'Enter your current password and a new password with at least 12 characters (maximum 72 bytes)' });
  }
  try {
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    const activeSession = await resolveSession(token);
    if (!activeSession || String(activeSession.userId) !== req.user.id) return res.status(401).json({ msg: 'Change password using an active browser session' });
    const user = await User.findById(req.user.id).select('_id password');
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) return res.status(403).json({ msg: 'Current password is incorrect' });
    if (await bcrypt.compare(newPassword, user.password)) return res.status(400).json({ msg: 'Choose a password different from your current one' });
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const replacementSession = await inTransaction(async (session) => {
      const stillActive = await Session.exists({ _id: activeSession._id, userId: user._id, expiresAt: { $gt: new Date() } }).session(session);
      if (!stillActive) throw Object.assign(new Error('Your session was revoked. Sign in again.'), { status: 401 });
      const changed = await User.updateOne({ _id: user._id, password: user.password }, { $set: { password: passwordHash } }, { session });
      if (changed.matchedCount !== 1) throw Object.assign(new Error('Password changed in another request. Sign in again.'), { status: 409 });
      await Session.deleteMany({ userId: user._id }, { session });
      return createSession(user._id, session);
    });
    setSessionCookie(res, replacementSession.token);
    res.json({ ok: true, sessionsRevoked: true });
  } catch (error) {
    res.status(error.status || 503).json({ msg: error.message || 'Unable to change password' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ msg: 'Email and password are required' });
  }
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not configured');
    return res.status(500).json({ msg: 'Server authentication is not configured' });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const limit = await checkLoginLimit({ ip: req.ip || req.socket.remoteAddress || 'unknown', email: normalizedEmail });
    if (!limit.allowed) {
      res.set('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({ msg: 'Too many login attempts. Try again later.' });
    }
    const user = await User.findOne({ email: normalizedEmail });
    const isMatch = await bcrypt.compare(password, user?.password || DUMMY_PASSWORD_HASH);
    if (!user || !isMatch) {
      await recordLoginFailure({ ip: req.ip || req.socket.remoteAddress || 'unknown', email: normalizedEmail });
      return res.status(401).json({ msg: 'Invalid credentials' });
    }
    await clearIdentityFailures({ ip: req.ip || req.socket.remoteAddress || 'unknown', email: normalizedEmail });
    if (user.accountStatus === 'pending') return res.status(403).json({ msg: 'Your account is awaiting approval.' });
    if (['rejected', 'suspended'].includes(user.accountStatus)) return res.status(403).json({ msg: 'This account is not active.' });
    const session = await createSession(user._id);
    setSessionCookie(res, session.token);
    res.json({ user: { id: String(user._id), name: user.name, email: user.email, role: user.role, accountStatus: user.accountStatus || 'active', branchIds: (user.branchIds || []).map(String) } });
  } catch (err) {
    console.error('Login failed:', err);
    res.status(500).json({ msg: 'Unable to log in' });
  }
});

router.post('/logout', async (req, res) => {
  await revokeSession(readCookie(req.headers.cookie, COOKIE_NAME));
  clearSessionCookie(res);
  res.json({ ok: true });
});

module.exports = router;
