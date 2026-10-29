const assert = require('node:assert/strict');
const { before, after, beforeEach, afterEach, test, mock } = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');
const Parcel = require('../src/models/Parcel');
const Session = require('../src/models/Session');
const MerchantProfile = require('../src/models/MerchantProfile');
const LedgerEntry = require('../src/models/LedgerEntry');
const RateLimitBucket = require('../src/models/RateLimitBucket');
const DeliveryProof = require('../src/models/DeliveryProof');
const createAdmin = require('../src/utils/createAdmin');

const adminId = '507f1f77bcf86cd799439001';
const customerId = '507f1f77bcf86cd799439002';
const secondCustomerId = '507f1f77bcf86cd799439003';
const agentId = '507f1f77bcf86cd799439004';
const parcelId = '507f1f77bcf86cd799439005';
const originalSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'isolated-role-permission-test-secret';
let server, baseUrl, accounts, events;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.io = {
      to: (room) => ({ emit: (event, data) => events.push({ room, event, data }) }),
      in: (room) => ({ disconnectSockets: () => events.push({ room, disconnected: true }) })
    };
    next();
  });
  app.use('/api/auth', require('../src/routes/auth'));
  app.use('/api/admin', require('../src/routes/admin'));
  app.use('/api/parcel', require('../src/routes/parcel'));
  app.use('/api/merchants', require('../src/routes/merchants'));
  app.use('/api/finance', require('../src/routes/finance'));
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  accounts = new Map([
    [adminId, { _id: adminId, name: 'Admin', email: 'admin@example.com', role: 'admin' }],
    [customerId, { _id: customerId, name: 'Customer', email: 'customer@example.com', role: 'customer' }],
    [secondCustomerId, { _id: secondCustomerId, name: 'Other Customer', email: 'other@example.com', role: 'customer' }],
    [agentId, { _id: agentId, name: 'Agent', email: 'agent@example.com', role: 'agent' }]
  ]);
  for (const account of accounts.values()) account.save = async () => account;
  events = [];
  mock.method(User, 'findById', (id) => ({ select: async () => accounts.get(id) || null }));
});

afterEach(() => mock.restoreAll());
after(async () => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

const token = (id, role) => jwt.sign({ id, role: role || accounts.get(id)?.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
const request = async (route, { id, method = 'GET', body, bearer } = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(id || bearer ? { Authorization: `Bearer ${bearer || token(id)}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
};

test('every admin operation rejects signed-out users and customers', async () => {
  for (const route of ['/api/admin/dashboard', '/api/admin/users', '/api/admin/bookings']) {
    assert.equal((await request(route)).status, 401);
    assert.equal((await request(route, { id: customerId })).status, 403);
  }
  for (const [route, method, body] of [
    [`/api/admin/users/${secondCustomerId}/role`, 'PATCH', { role: 'admin' }],
    [`/api/parcel/assign/${parcelId}`, 'PUT', { agentId }],
    [`/api/parcel/accept/${parcelId}`, 'PUT', {}]
  ]) {
    assert.equal((await request(route, { method, body })).status, 401);
    assert.equal((await request(route, { id: customerId, method, body })).status, 403);
  }
});

test('admin can view metrics, users, and all bookings', async () => {
  mock.method(Parcel, 'countDocuments', async () => 2);
  mock.method(Parcel, 'aggregate', async () => [{ total: 1 }]);
  mock.method(User, 'countDocuments', async () => 4);
  const userQuery = { select: () => userQuery, populate: () => userQuery, sort: () => userQuery, skip: () => userQuery, limit: () => userQuery, lean: async () => [...accounts.values()].map(({ _id, name, email, role }) => ({ _id, name, email, role })) };
  mock.method(User, 'find', () => userQuery);
  const query = { sort: () => query, populate: () => query, skip: () => query, limit: () => query, lean: async () => [{ _id: parcelId }] };
  mock.method(Parcel, 'find', () => query);
  const proofQuery = { select: () => proofQuery, sort: () => proofQuery, lean: async () => [] };
  mock.method(DeliveryProof, 'find', () => proofQuery);
  assert.equal((await request('/api/admin/dashboard', { id: adminId })).status, 200);
  const users = await request('/api/admin/users', { id: adminId });
  assert.equal(users.status, 200);
  assert.equal(users.body.items.length, 4);
  assert.equal(users.body.total, 4);
  const bookings = await request('/api/admin/bookings', { id: adminId });
  assert.equal(bookings.status, 200);
  assert.equal(bookings.body.items.length, 1);
});

test('merchant application list applies admin status filter and pagination', async () => {
  let receivedFilter;
  const query = { populate: () => query, sort: () => query, skip: () => query, limit: () => query, lean: async () => [{ _id: parcelId, status: 'approved' }] };
  const lookup = mock.method(MerchantProfile, 'find', (filter) => { receivedFilter = filter; return query; });
  mock.method(MerchantProfile, 'countDocuments', async (filter) => { assert.deepEqual(filter, { status: 'approved' }); return 11; });
  const result = await request('/api/merchants/applications?page=3&limit=5&status=approved', { id: adminId });
  assert.equal(result.status, 200);
  assert.deepEqual(receivedFilter, { status: 'approved' });
  assert.equal(lookup.mock.callCount(), 1);
  assert.equal(result.body.page, 3);
  assert.equal(result.body.limit, 5);
  assert.equal(result.body.total, 11);
  assert.equal(result.body.pages, 3);
  assert.equal(result.body.items[0].status, 'approved');
});

test('admin user list filters by role and paginates without returning password hashes', async () => {
  let receivedFilter; let offset; let limit;
  const query = {
    select: () => query, populate: () => query, sort: () => query,
    skip: (value) => { offset = value; return query; },
    limit: (value) => { limit = value; return query; },
    lean: async () => [{ _id: customerId, role: 'customer' }]
  };
  mock.method(User, 'find', (filter) => { receivedFilter = filter; return query; });
  mock.method(User, 'countDocuments', async () => 31);
  const result = await request('/api/admin/users?page=2&limit=10&role=customer', { id: adminId });
  assert.equal(result.status, 200);
  assert.deepEqual(receivedFilter, { role: 'customer' });
  assert.equal(offset, 10);
  assert.equal(limit, 10);
  assert.equal(result.body.total, 31);
  assert.equal(result.body.pages, 4);
  assert.equal(result.body.items[0].password, undefined);
});

test('finance ledger marks COD payables already reversed without mutating ledger entries', async () => {
  const payableId = '507f1f77bcf86cd799439099';
  const payable = { _id: payableId, type: 'cod_payable', amountPoisha: 5000, merchantId: { _id: customerId, name: 'Merchant' } };
  const find = mock.method(LedgerEntry, 'find', (filter) => {
    if (filter.reversesEntryId) return { select: () => ({ lean: async () => [{ reversesEntryId: payableId }] }) };
    return { populate: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [payable] }) }) }) }) };
  });
  mock.method(LedgerEntry, 'countDocuments', async () => 1);
  const result = await request('/api/finance/ledger', { id: adminId });
  assert.equal(result.status, 200);
  assert.equal(result.body.items[0].reversed, true);
  assert.equal(find.mock.callCount(), 2);
});

test('customer parcel queries are scoped to their own identity, ignoring query overrides', async () => {
  const query = { select: () => query, sort: async () => [{ _id: parcelId, customerId }] };
  const lookup = mock.method(Parcel, 'find', () => query);
  const result = await request(`/api/parcel/my-parcels?customerId=${secondCustomerId}`, { id: customerId });
  assert.equal(result.status, 200);
  assert.deepEqual(lookup.mock.calls[0].arguments[0], { customerId });
  assert.equal((await request('/api/parcel/my-parcels', { id: adminId })).status, 403);
  assert.equal((await request('/api/parcel/assigned', { id: customerId })).status, 403);
  assert.equal((await request(`/api/parcel/status/${parcelId}`, { id: customerId, method: 'PUT', body: { status: 'Delivered' } })).status, 403);
});

test('legacy customer booking writes are retired and cannot inject parcel data', async () => {
  const saved = mock.method(Parcel.prototype, 'save', async function () { return this; });
  const body = { pickupAddress: 'Dhaka', deliveryAddress: 'Sylhet', parcelType: 'Books', paymentType: 'COD', customerId: secondCustomerId, status: 'Booked', acceptedBy: customerId, acceptedAt: new Date().toISOString(), qrCode: 'fake-confirmation' };
  const result = await request('/api/parcel/book', { id: customerId, method: 'POST', body });
  assert.equal(result.status, 410);
  assert.equal(saved.mock.callCount(), 0);
  assert.deepEqual(events, []);
  assert.equal((await request('/api/parcel/book', { id: adminId, method: 'POST', body })).status, 403);
});

test('legacy parcel acceptance writes are retired', async () => {
  const update = mock.method(Parcel, 'findOneAndUpdate', async () => null);
  assert.equal((await request(`/api/parcel/accept/${parcelId}`, { id: agentId, method: 'PUT' })).status, 403);
  assert.equal(update.mock.callCount(), 0);
  const result = await request(`/api/parcel/accept/${parcelId}`, { id: adminId, method: 'PUT', body: { status: 'Delivered', acceptedBy: customerId } });
  assert.equal(result.status, 410);
  assert.equal(update.mock.callCount(), 0);
  assert.deepEqual(events, []);
});

test('repeated legacy acceptance attempts do not mutate records', async () => {
  const update = mock.method(Parcel, 'findOneAndUpdate', async () => null);
  const results = await Promise.all([1, 2].map(() => request(`/api/parcel/accept/${parcelId}`, { id: adminId, method: 'PUT' })));
  assert.deepEqual(results.map(result => result.status), [410, 410]);
  assert.equal(events.length, 0);
  assert.equal(update.mock.callCount(), 0);
});

test('legacy acceptance rejects all IDs with a retirement response without database writes', async () => {
  const update = mock.method(Parcel, 'findOneAndUpdate', async () => null);
  for (const route of ['/api/parcel/accept/invalid', `/api/parcel/accept/${parcelId}`]) {
    assert.equal((await request(route, { id: adminId, method: 'PUT' })).status, 410);
  }
  assert.equal(update.mock.callCount(), 0);
  assert.equal(events.length, 0);
});

test('legacy customer-to-agent assignment writes are retired', async () => {
  const update = mock.method(Parcel, 'findOneAndUpdate', async () => null);
  assert.equal((await request(`/api/parcel/assign/${parcelId}`, { id: agentId, method: 'PUT', body: { agentId } })).status, 403);
  assert.equal((await request(`/api/parcel/assign/${parcelId}`, { id: adminId, method: 'PUT', body: { agentId } })).status, 410);
  assert.equal(update.mock.callCount(), 0);
  assert.deepEqual(events, []);
});

test('legacy agent status writes are retired while historical assignments stay readable', async () => {
  const update = mock.method(Parcel, 'findById', async () => null);
  for (const status of ['Booked', 'Picked Up', 'Failed']) {
    assert.equal((await request(`/api/parcel/status/${parcelId}`, { id: agentId, method: 'PUT', body: { status } })).status, 410);
  }
  const lookupQuery = { select: () => lookupQuery, sort: () => lookupQuery, lean: async () => [] };
  const lookup = mock.method(Parcel, 'find', () => lookupQuery);
  assert.equal((await request('/api/parcel/assigned', { id: agentId })).status, 200);
  assert.deepEqual(lookup.mock.calls[0].arguments[0], { agentId, status: { $ne: 'Processing' } });
  assert.equal(update.mock.callCount(), 0);
});

test('administrator cannot advance legacy parcel status through retired writes', async () => {
  const lookup = mock.method(Parcel, 'findById', async () => null);
  for (const status of ['Picked Up', 'In Transit', 'Delivered']) {
    assert.equal((await request(`/api/parcel/status/${parcelId}`, { id: adminId, method: 'PUT', body: { status } })).status, 410);
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.deepEqual(events, []);
});

test('dashboard counts Processing separately from confirmed daily bookings', async () => {
  mock.method(Parcel, 'countDocuments', async (filter) => {
    if (filter.status === 'Processing') return 3;
    if (filter.status === 'Delivery Failed') return 1;
    if (filter.$or) {
      assert.ok(filter.$or[0].acceptedAt.$gte instanceof Date);
      return 4;
    }
    assert.fail('Unexpected dashboard parcel count query');
  });
  mock.method(Parcel, 'aggregate', async () => []);
  const result = await request('/api/admin/dashboard', { id: adminId });
  assert.equal(result.status, 200);
  assert.equal(result.body.processingParcels, 3);
  assert.equal(result.body.dailyBookings, 4);
  assert.equal(result.body.failedDeliveries, 1);
});

test('public account self-registration is retired; merchant application is the public onboarding path', async () => {
  for (const role of ['admin', 'agent']) {
    const result = await request('/api/auth/register', { method: 'POST', body: { name: 'New Customer', email: 'new@example.com', password: 'customer-password', role } });
    assert.equal(result.status, 410);
  }
});

test('admin role edits take effect for existing tokens and revoke existing sockets', async () => {
  const oldToken = token(customerId);
  const promote = await request(`/api/admin/users/${customerId}/role`, { id: adminId, method: 'PATCH', body: { role: 'admin' } });
  assert.equal(promote.status, 200);
  assert.equal(promote.body.user.role, 'admin');
  assert.equal(promote.body.user.password, undefined);
  assert.deepEqual(events, [{ room: `user:${customerId}`, event: 'roleChanged', data: { role: 'admin' } }, { room: `user:${customerId}`, disconnected: true }]);
  const promotedSession = await request('/api/auth/me', { bearer: oldToken });
  assert.equal(promotedSession.body.user.role, 'admin');
  const oldAdminToken = token(customerId);
  const demote = await request(`/api/admin/users/${customerId}/role`, { id: adminId, method: 'PATCH', body: { role: 'customer' } });
  assert.equal(demote.status, 200);
  assert.equal((await request('/api/admin/users', { bearer: oldAdminToken })).status, 403);
  assert.equal((await request('/api/auth/me', { bearer: oldAdminToken })).body.user.role, 'customer');
});

test('admin cannot change their own role, unknown users, or invalid/agent roles', async () => {
  for (const [id, role, expected] of [
    [adminId, 'customer', 400],
    [customerId, 'owner', 400],
    [customerId, 'agent', 400],
    [customerId, { role: 'admin' }, 400],
    [agentId, 'customer', 400],
    ['bad-id', 'admin', 400],
    ['507f1f77bcf86cd799439099', 'admin', 404]
  ]) {
    const result = await request(`/api/admin/users/${id}/role`, { id: adminId, method: 'PATCH', body: { role } });
    assert.equal(result.status, expected);
  }
  assert.equal(accounts.get(adminId).role, 'admin');
});

test('session endpoint returns only public account fields', async () => {
  const result = await request('/api/auth/me', { id: adminId });
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body.user).sort(), ['email', 'id', 'name', 'role']);
});

test('admin provisioning hashes passwords and never overwrites existing accounts', async () => {
  mock.method(User, 'findOne', async () => null);
  const create = mock.method(User, 'create', async (data) => ({ _id: adminId, ...data }));
  const result = await createAdmin({ name: ' Administrator ', email: ' ADMIN@Example.com ', password: 'long-private-password' });
  assert.equal(result.created, true);
  assert.equal(result.user.role, 'admin');
  assert.equal(result.user.email, 'admin@example.com');
  assert.equal(await bcrypt.compare('long-private-password', result.user.password), true);
  assert.equal(create.mock.callCount(), 1);
  mock.restoreAll();
  mock.method(User, 'findOne', async () => accounts.get(adminId));
  assert.equal((await createAdmin({ email: 'admin@example.com', password: 'another-long-password' })).created, false);
  mock.restoreAll();
  mock.method(User, 'findOne', async () => accounts.get(customerId));
  await assert.rejects(createAdmin({ email: 'customer@example.com', password: 'another-long-password' }), /non-admin account/);
  assert.equal(accounts.get(customerId).role, 'customer');
  await assert.rejects(createAdmin({ email: 'admin@example.com', password: 'short' }), /12 characters/);
});
