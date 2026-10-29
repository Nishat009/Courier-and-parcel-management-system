const crypto = require('node:crypto');
const Session = require('../models/Session');

const COOKIE_NAME = 'courier_session';
const SESSION_DAYS = 7;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const readCookie = (header, name) => {
  const part = (header || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  if (!part) return '';
  try { return decodeURIComponent(part.slice(name.length + 1)); } catch { return ''; }
};

const createSession = async (userId, databaseSession) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const record = { tokenHash: hashToken(token), userId, expiresAt };
  if (databaseSession) await Session.create([record], { session: databaseSession });
  else await Session.create(record);
  return { token, expiresAt };
};

const resolveSession = async (token) => {
  if (!token) return null;
  const session = await Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } }).select('+tokenHash').lean();
  return session || null;
};

const revokeSession = async (token) => token ? Session.deleteOne({ tokenHash: hashToken(token) }) : null;
const sessionCookieSameSite = () => process.env.NODE_ENV === 'production' ? 'None' : 'Lax';
const cookieOptions = () => `Path=/; HttpOnly; SameSite=${sessionCookieSameSite()}; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
const setSessionCookie = (res, token) => res.set('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieOptions()}`);
const clearSessionCookie = (res) => res.set('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${sessionCookieSameSite()}; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);

module.exports = { COOKIE_NAME, readCookie, createSession, resolveSession, revokeSession, setSessionCookie, clearSessionCookie };
