# Bangladesh Courier & Parcel Management

Responsive web application for a single Bangladesh courier operator with multiple branches. Includes administrator, operations, accounts, merchant and rider workspaces plus public parcel tracking. Uses BDT/poisha and `Asia/Dhaka` for date display. The MVP excludes SaaS tenancy, native apps, live GPS, partial delivery and parcel exchange.

## Technology

This repository already had a deployed React/Vite + Express/Mongoose + MongoDB application, so the foundation preserves those conventions rather than replacing the running app with Next.js/PostgreSQL. Backend domain modules separate parcel lifecycle, pricing, COD reconciliation, merchant ledger and payout behavior. Versioned Mongo migration scripts are used in place of Prisma migrations. Multi-document workflows require a MongoDB replica set; Atlas is supported.

## Local setup

Requirements: Node.js 20.19+ (or 22.12+) and MongoDB Atlas or a local replica set.

1. Copy `backend/.env.example` to `backend/.env`; configure `MONGO_URI` and a long random `JWT_SECRET`.
2. Copy `frontend/.env.example` to `frontend/.env`; use `VITE_API_URL=http://localhost:5000`.
3. Run migrations and install dependencies:

   ```powershell
   cd backend
   npm install
   npm run migrate
   $env:ALLOW_SYNTHETIC_SEED = 'true'
   npm run seed:dev
   Remove-Item Env:ALLOW_SYNTHETIC_SEED
   npm start
   ```

4. In another terminal:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

5. Open the Vite URL, normally `http://localhost:5173`. Synthetic users use `admin`, `operations`, `accounts`, `merchant`, `rider` at `example.test`; the seed command resets them to a shared password each run and prints it.

Never commit `.env`, credentials, or backup archives. `seed:dev` requires an explicit environment flag, refuses when `NODE_ENV=production`, and only upserts demo identities/parcels. Confirm the database target is disposable before enabling it.

## First end-to-end workflows

- Merchant: apply at `/merchant-apply`; an admin reviews the application. After approval, sign in, choose origin/destination branches, enter the recipient's name and Bangladesh mobile number, submit a booking with COD amount, and follow it by its tracking code. Public tracking never shows recipient contact details.
- Operations: for phone/counter requests, create an assisted booking for an existing approved merchant. The parcel stays on the merchant account; operations can only choose an assigned branch as its origin. Then assign a rider and move it through booking, pickup, origin hub, transit and destination hub.
- Rider: update pickup/hub steps, record the exact COD cash collected at delivery, optionally upload a private JPEG/PNG/WebP delivery photo, and submit a branch cash handover. Proof files are stored in MongoDB GridFS and included in database backups.
- Accounts: verify the physical cash count, approve an eligible merchant payout, and record a confirmed bank/MFS reference after the external transfer is complete.
- Merchant: request payout only for delivered COD parcels with reconciled cash.
- Public: use `/track` for limited tracking status without customer contact/address or proof data.

## Documentation

- [Architecture, business rules, permissions, assumptions and milestone checklist](docs/IMPLEMENTATION.md)
- [HTTP API reference](docs/API.md)
- [Current validation results](docs/VALIDATION.md)
- [Local operations, Render/Atlas deployment, backup and restore](docs/OPERATIONS.md)
- [Render Blueprint](render.yaml)

## Validation

```powershell
cd backend
npm test

# Optional: real migration and finance workflow test against a dedicated local replica set
$env:TEST_MONGO_URI = 'mongodb://127.0.0.1:27017/?replicaSet=rs0'
npm run test:integration
Remove-Item Env:TEST_MONGO_URI

cd ..\frontend
npm run lint
npm run build
```

For browser workflows, start Vite in one frontend terminal with `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort`, then run `npm run test:e2e` from another frontend terminal. These browser tests stub API responses; database transaction behavior is covered separately by running `npm run test:integration` from `backend` with the explicit test replica-set URI.

## Current implementation limits

Legacy customer parcel records remain available as read-only history; customer self-registration and customer/agent write endpoints return `410 Gone`. Active merchant parcels use the branch-aware operations workflow. Live coordinate collection/display is disabled. Merchant approval, branch-aware booking, operational state transitions, rider COD capture and handover, private delivery proof, cash reconciliation, payout eligibility and manual payout recording are available through their APIs/workspaces. Merchant application and review emails use the transactional notification outbox when SMTP is configured; SMTP acceptance is not treated as delivery confirmation. Admins can suspend/reactivate branch staff, which revokes live sessions. Four Playwright workflows cover core browser screens with stubbed APIs; the opt-in Mongo integration suite passed against a unique temporary database on a local replica set. SMS gateway and external object storage credentials, automated bank/MFS transfers, automated return routing, and advanced reporting remain external integrations or later work. No external transfer is reported successful without a recorded confirmation reference.
