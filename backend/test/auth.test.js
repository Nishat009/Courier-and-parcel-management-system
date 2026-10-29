const assert = require('node:assert/strict');
const { after, afterEach, test, mock } = require('node:test');
const jwt = require('jsonwebtoken');
const auth = require('../src/middleware/auth');
const User = require('../src/models/User');
const authenticateToken = require('../src/utils/authenticateToken');
const Session = require('../src/models/Session');
const crypto = require('node:crypto');

const accountId = '507f1f77bcf86cd799439011';
const mockAccount = (role) => mock.method(User, 'findById', () => ({ select: async () => role ? ({ _id: accountId, name: 'Test User', email: 'user@example.com', role }) : null }));

afterEach(() => mock.restoreAll());

const originalSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'test-secret';

after(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

const invokeAuth = async (middleware, authorization) => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  const request = { header: () => authorization };
  let nextCalled = false;

  await middleware(request, response, () => {
    nextCalled = true;
  });

  return { request, response, nextCalled };
};

test('rejects requests without a bearer token', async () => {
  const { response, nextCalled } = await invokeAuth(auth(), undefined);
  assert.equal(response.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('rejects a valid token when its role is not allowed', async () => {
  mockAccount('customer');
  const token = jwt.sign({ id: accountId, role: 'customer' }, process.env.JWT_SECRET);
  const { response, nextCalled } = await invokeAuth(auth(['admin']), `Bearer ${token}`);
  assert.equal(response.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('attaches the database account for an authorized role', async () => {
  mockAccount('agent');
  const token = jwt.sign({ id: accountId, role: 'agent' }, process.env.JWT_SECRET);
  const { request, response, nextCalled } = await invokeAuth(auth(['agent']), `Bearer ${token}`);
  assert.equal(response.statusCode, 200);
  assert.equal(request.user.id, accountId);
  assert.equal(nextCalled, true);
});

test('a demoted admin cannot use an older admin token', async () => {
  mockAccount('customer');
  const token = jwt.sign({ id: accountId, role: 'admin' }, process.env.JWT_SECRET);
  const { response, nextCalled } = await invokeAuth(auth(['admin']), `Bearer ${token}`);
  assert.equal(response.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('a promoted customer receives current admin permissions', async () => {
  mockAccount('admin');
  const token = jwt.sign({ id: accountId, role: 'customer' }, process.env.JWT_SECRET);
  const { request, nextCalled } = await invokeAuth(auth(['admin']), `Bearer ${token}`);
  assert.equal(nextCalled, true);
  assert.equal(request.user.role, 'admin');
});

test('deleted users cannot reuse their tokens, including for socket authentication', async () => {
  mockAccount(null);
  const token = jwt.sign({ id: accountId, role: 'admin' }, process.env.JWT_SECRET);
  await assert.rejects(authenticateToken(token), { status: 401 });
});

test('expired or incorrectly signed tokens are rejected before database lookup', async () => {
  const lookup = mockAccount('admin');
  for (const token of [
    jwt.sign({ id: accountId }, process.env.JWT_SECRET, { expiresIn: -1 }),
    jwt.sign({ id: accountId }, 'wrong-secret'),
    jwt.sign({ id: 'invalid-id' }, process.env.JWT_SECRET),
    jwt.sign({ id: accountId }, process.env.JWT_SECRET, { algorithm: 'HS384' }),
    'malformed-token'
  ]) {
    const { response, nextCalled } = await invokeAuth(auth(), `Bearer ${token}`);
    assert.equal(response.statusCode, 401);
    assert.equal(nextCalled, false);
  }
  assert.equal(lookup.mock.callCount(), 0);
});

test('database failures do not grant access or claim the password is wrong', async () => {
  mock.method(User, 'findById', () => ({ select: async () => { throw new Error('offline'); } }));
  const token = jwt.sign({ id: accountId, role: 'admin' }, process.env.JWT_SECRET);
  const { response, nextCalled } = await invokeAuth(auth(['admin']), `Bearer ${token}`);
  assert.equal(response.statusCode, 503);
  assert.equal(nextCalled, false);
});

test('HttpOnly session cookie resolves a server-side session and current database role', async () => {
  const rawSession = 'test-session-cookie-secret';
  const tokenHash = crypto.createHash('sha256').update(rawSession).digest('hex');
  const session = { userId: accountId, tokenHash, expiresAt: new Date(Date.now() + 60_000) };
  mock.method(Session, 'findOne', (filter) => {
    assert.equal(filter.tokenHash, tokenHash);
    const query = { select: () => query, lean: async () => session };
    return query;
  });
  mock.method(User, 'findById', () => ({ select: async () => ({ _id: accountId, name: 'Merchant', email: 'merchant@example.test', role: 'merchant', accountStatus: 'active', branchIds: [] }) }));
  const request = { headers: { cookie: `other=value; courier_session=${rawSession}` }, header: () => undefined };
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let nextCalled = false;
  await auth(['merchant'])(request, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(request.user.role, 'merchant');
  assert.equal(request.user.branchIds.length, 0);
});
