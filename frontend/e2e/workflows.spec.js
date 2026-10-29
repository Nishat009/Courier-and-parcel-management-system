import { expect, test } from '@playwright/test';

const json = (route, data, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(data)
});

const installApiMock = async (page, { handlers = {}, initialUser = null } = {}) => {
  let currentUser = initialUser;
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (pathname === '/api/auth/me' && method === 'GET') {
      return currentUser ? json(route, { user: currentUser }) : json(route, { msg: 'Authentication required' }, 401);
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = request.postDataJSON();
      currentUser = handlers.login ? await handlers.login(body) : null;
      return currentUser ? json(route, { user: currentUser }) : json(route, { msg: 'Invalid credentials' }, 401);
    }
    const handler = handlers[`${method} ${pathname}`];
    if (!handler) return json(route, { msg: `No browser test stub for ${method} ${pathname}` }, 500);
    const result = await handler(route, request);
    if (result !== undefined) return json(route, result.data, result.status || 200);
  });
};

const signInAs = async (page, role) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(`${role}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`/${role}$`));
};

test('merchant can submit an application and the public can track a parcel', async ({ page }) => {
  let applicationBody;
  await installApiMock(page, {
    handlers: {
      'POST /api/merchants/apply': async (route, request) => {
        applicationBody = request.postDataJSON();
        return { status: 202, data: { status: 'pending', merchant: { businessName: applicationBody.businessName } } };
      },
      'GET /api/merchants/track/BDABCDEF123456': async () => ({
        data: {
          trackingCode: 'BDABCDEF123456', status: 'In Transit', createdAt: '2026-10-29T04:00:00.000Z',
          destination: { branch: 'Chattogram Central Hub', city: 'Chattogram' },
          events: [{ type: 'status_transition', toStatus: 'In Transit', actorRole: 'operations', createdAt: '2026-10-29T06:00:00.000Z' }]
        }
      })
    }
  });

  await page.goto('/merchant-apply');
  await page.getByLabel('Contact name').fill('Synthetic Merchant');
  await page.getByLabel('Business name').fill('Dhaka Test Store');
  await page.getByLabel('Email address').fill('merchant@example.test');
  await page.getByLabel('Mobile number').fill('01700000000');
  await page.getByLabel('Pickup address').fill('Mirpur 10, Dhaka');
  await page.getByLabel('Password (12+ characters)').fill('synthetic-password');
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByRole('status')).toContainText('Application submitted for Dhaka Test Store');
  expect(applicationBody).toMatchObject({ businessName: 'Dhaka Test Store', email: 'merchant@example.test' });

  await page.goto('/track');
  await page.getByLabel('Tracking code').fill('BDABCDEF123456');
  await page.getByRole('button', { name: 'Track parcel' }).click();
  await expect(page.getByText('In Transit', { exact: true })).toBeVisible();
  await expect(page.getByText('Destination: Chattogram', { exact: true })).toBeVisible();
  await expect(page.getByText(/operations/)).toHaveCount(0);
});

test('approved merchant can create a COD booking with a price snapshot request', async ({ page }) => {
  const merchant = { id: '507f1f77bcf86cd799439001', name: 'Synthetic Merchant', email: 'merchant@example.test', role: 'merchant' };
  let createdBooking;
  const branches = [
    { _id: '507f1f77bcf86cd799439011', name: 'Dhaka Central Hub', city: 'Dhaka' },
    { _id: '507f1f77bcf86cd799439012', name: 'Chattogram Central Hub', city: 'Chattogram' }
  ];
  await installApiMock(page, {
    handlers: {
      login: async () => merchant,
      'GET /api/merchants/branches': async () => ({ data: { items: branches } }),
      'GET /api/merchants/parcels': async () => ({ data: { items: createdBooking ? [createdBooking] : [], page: 1, pages: 1, total: createdBooking ? 1 : 0 } }),
      'GET /api/merchants/payouts': async () => ({ data: { items: [], page: 1, pages: 1 } }),
      'GET /api/merchants/ledger': async () => ({ data: { items: [], pages: 1, balancePoisha: 0 } }),
      'GET /api/merchants/payout-eligibility': async () => ({ data: { parcelCount: 0, amountPoisha: 0 } }),
      'POST /api/merchants/booking-quote': async () => ({ data: { deliveryFeePoisha: 10000, codFeePoisha: 1250, merchantNetPoisha: 123750 } }),
      'POST /api/merchants/bookings': async (route, request) => {
        const body = request.postDataJSON();
        expect(body.codAmountPoisha).toBe(125000);
        expect(request.headers()['idempotency-key']).toBeTruthy();
        createdBooking = {
          _id: '507f1f77bcf86cd799439099', trackingCode: 'BDABCDEF123456', status: 'Processing',
          pickupAddress: body.pickupAddress, deliveryAddress: body.deliveryAddress,
          paymentType: body.paymentType, priceSnapshot: { codAmountPoisha: body.codAmountPoisha, deliveryFeePoisha: 10000 }, cod: { status: 'due' }
        };
        return { status: 201, data: createdBooking };
      }
    }
  });

  await signInAs(page, 'merchant');
  await page.getByLabel('Pickup branch').selectOption(branches[0]._id);
  await page.getByLabel('Pickup address').fill('Mirpur 10, Dhaka');
  await page.getByLabel('Destination branch').selectOption(branches[1]._id);
  await page.getByLabel('Delivery address').fill('Agrabad, Chattogram');
  await page.getByLabel('Recipient name').fill('Synthetic Receiver');
  await page.getByLabel('Recipient mobile').fill('01712345678');
  await page.getByLabel('Parcel contents').fill('Books');
  await page.getByLabel('Payment').selectOption('COD');
  await page.getByLabel('COD amount (BDT)').fill('1250.00');
  await page.getByRole('button', { name: 'Request booking' }).click();

  await expect(page.locator('.success-message')).toContainText('BDABCDEF123456');
  await expect(page.locator('.parcel-card').getByText('Processing', { exact: true })).toBeVisible();
  await expect(page.getByText('Mirpur 10, Dhaka')).toBeVisible();
});

test('rider must enter the cash actually collected before confirming COD delivery', async ({ page }) => {
  const rider = { id: '507f1f77bcf86cd799439002', name: 'Synthetic Rider', email: 'rider@example.test', role: 'rider', branchIds: ['507f1f77bcf86cd799439012'] };
  const parcel = {
    _id: '507f1f77bcf86cd799439099', trackingCode: 'BDABCDEF123456', status: 'Out for Delivery',
    pickupAddress: 'Mirpur 10, Dhaka', deliveryAddress: 'Agrabad, Chattogram', paymentType: 'COD',
    destinationBranchId: '507f1f77bcf86cd799439012', priceSnapshot: { codAmountPoisha: 125000 }, cod: { status: 'due' }
  };
  let delivered = false;
  let collectionAmount;
  await installApiMock(page, {
    handlers: {
      login: async () => rider,
      'GET /api/rider/parcels': async () => ({ data: { items: delivered ? [] : [parcel], page: 1, pages: 1 } }),
      'GET /api/finance/cash-handovers/mine': async () => ({ data: { items: [], page: 1, pages: 1 } }),
      'POST /api/finance/deliveries/507f1f77bcf86cd799439099/confirm': async (route, request) => {
        collectionAmount = request.postDataJSON().collectedAmountPoisha;
        if (collectionAmount !== 125000) return { status: 409, data: { msg: 'Collected cash must match the booking COD amount exactly' } };
        delivered = true;
        return { data: { parcel: { ...parcel, status: 'Delivered' }, collection: { status: 'collected', amountPoisha: collectionAmount } } };
      }
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, 'rider');
  await expect(page.getByText('BDABCDEF123456')).toBeVisible();
  const cashInput = page.getByLabel(/Cash actually received/);
  await expect(page.getByRole('button', { name: /Confirm delivered/ })).toBeDisabled();
  await cashInput.fill('1249.99');
  await page.getByRole('button', { name: /Confirm delivered/ }).click();
  await expect(page.getByRole('alert')).toContainText('must match');
  expect(collectionAmount).toBe(124999);

  await cashInput.fill('1250.00');
  await page.getByRole('button', { name: /Confirm delivered/ }).click();
  await expect(page.locator('.success-message')).toContainText('cash collection saved');
  expect(collectionAmount).toBe(125000);
  await expect(page.getByText('No assigned work')).toBeVisible();
});

test('accounts records the counted handover amount, reconciles it, and records a confirmed payout', async ({ page }) => {
  const accounts = { id: '507f1f77bcf86cd799439003', name: 'Synthetic Accounts', email: 'accounts@example.test', role: 'accounts' };
  let handover = { _id: 'handover-1', riderId: { name: 'Synthetic Rider' }, branchId: { name: 'Chattogram Hub' }, expectedAmountPoisha: 50000, declaredAmountPoisha: 50000, status: 'submitted' };
  let payout = { _id: 'payout-1', merchantId: { name: 'Synthetic Store' }, amountPoisha: 42000, status: 'requested' };
  const reconcileRequests = [];
  const payoutActions = [];
  await installApiMock(page, {
    handlers: {
      login: async () => accounts,
      'GET /api/finance/cash-handovers': async () => ({ data: { items: [handover], page: 1, pages: 1, total: 1 } }),
      'GET /api/finance/payouts': async () => ({ data: { items: [payout], page: 1, pages: 1, total: 1 } }),
      'GET /api/finance/ledger': async () => ({ data: { items: [], page: 1, pages: 1, total: 0 } }),
      'PATCH /api/finance/cash-handovers/handover-1/reconcile': async (route, request) => {
        const amount = request.postDataJSON().verifiedAmountPoisha;
        reconcileRequests.push(amount);
        handover = { ...handover, verifiedAmountPoisha: amount, status: amount === handover.expectedAmountPoisha ? 'reconciled' : 'disputed' };
        return { data: handover };
      },
      'PATCH /api/finance/payouts/payout-1': async (route, request) => {
        const action = request.postDataJSON();
        payoutActions.push(action);
        payout = { ...payout, status: action.action === 'approve' ? 'approved' : 'paid', paymentReference: action.paymentReference };
        return { data: payout };
      }
    }
  });
  await signInAs(page, 'accounts');
  const counted = page.getByLabel('Cash physically counted for handover handover-1');
  await counted.fill('499.99');
  await page.getByRole('button', { name: 'Record counted cash' }).click();
  await expect(page.getByText('disputed', { exact: true })).toBeVisible();
  expect(reconcileRequests).toEqual([49999]);

  await counted.fill('500.00');
  await page.getByRole('button', { name: 'Recheck counted cash' }).click();
  await expect(page.getByText('reconciled', { exact: true })).toBeVisible();
  expect(reconcileRequests).toEqual([49999, 50000]);

  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByLabel('Confirmed bank/MFS reference').fill('BANK-12345');
  await page.getByRole('button', { name: 'Record confirmed payment' }).click();
  await expect(page.locator('#payouts .status-badge').filter({ hasText: 'paid' })).toBeVisible();
  expect(payoutActions).toEqual([{ action: 'approve' }, { action: 'mark-paid', paymentReference: 'BANK-12345' }]);
});
