# Local operations, deployment, and data recovery

## Local setup

Requirements: Node.js 20.19+ (or 22.12+) and MongoDB Atlas or a local replica-set deployment. Transactions are used for booking, delivery/cash settlement, payout, and merchant review. A standalone local `mongod` without replica-set mode cannot run those workflows.

For a single-machine Windows development server, back up its `mongod.cfg`, add this top-level configuration, then restart the MongoDB service from an elevated PowerShell window:

```yaml
replication:
  replSetName: rs0
```

Initialize the one-node set once (use the actual local MongoDB port if it differs):

```powershell
mongosh "mongodb://127.0.0.1:27017/admin" --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"
```

Set `MONGO_URI` to `mongodb://127.0.0.1:27017/courier_parcel?replicaSet=rs0`. Keep the config backup until the service starts and `/health/ready` returns `200`. This changes MongoDB service configuration and requires permission to restart it; it does not drop application collections. For a temporary isolated replica set, use MongoDB Atlas or a local container with a separate data directory.

1. Copy `backend/.env.example` to `backend/.env`; set a private `MONGO_URI` and a long random `JWT_SECRET`.
2. Copy `frontend/.env.example` to `frontend/.env`; set `VITE_API_URL=http://localhost:5000`.
3. Install and apply migrations:

   ```powershell
   cd backend
   npm install
   npm run migrate
   ```

4. For synthetic development accounts and parcel states only, first confirm that `MONGO_URI` targets a disposable development database. Then explicitly enable and run the seed:

   ```powershell
   $env:ALLOW_SYNTHETIC_SEED = 'true'
   npm run seed:dev
   Remove-Item Env:ALLOW_SYNTHETIC_SEED
   ```

   It refuses to run when `NODE_ENV=production`, touches only `@example.test` accounts, the `DHK-CENTRAL`/`CTG-CENTRAL` demo branches and `DEMO-*` parcels, and resets all synthetic demo account passwords to one shared value on each run and prints the generated value when `SEED_PASSWORD` is blank. It creates a pending merchant application for admin review, idempotent booking and parcel transition history for the seeded state fixtures, plus a counted-cash review attempt for the reconciled demo handover. Public tracking accepts `DEMO-*` codes only in development/test environments. The seed does not delete existing application data.
5. In separate terminals run `npm start` from `backend` and `npm run dev` from `frontend`.

### Replica-set integration test

`npm test` is offline and uses mocks. For database-backed validation, provide `TEST_MONGO_URI` for a dedicated local replica set (not the app's configured database), then run:

```powershell
cd backend
$env:TEST_MONGO_URI = 'mongodb://127.0.0.1:27017/?replicaSet=rs0'
npm run test:integration
Remove-Item Env:TEST_MONGO_URI
```

The test overrides the URI database with a random `courier_integration_test_*` name, runs the migration and the complete booking-to-payout-reversal flow, then drops only that generated database. It never uses the database named in `MONGO_URI`. The MongoDB test user needs permission to create and drop the temporary database. The URI is mandatory; there is no fallback to `MONGO_URI`. The suite needs transaction support, so a standalone MongoDB server will fail.

Demo roles: `admin`, `operations`, `accounts`, approved `merchant`, `pending-merchant`, and `rider` at `example.test`. The synthetic operations and rider accounts are assigned to both demo branches; Accounts is assigned to Dhaka, which owns the seeded handover. Adjust staff branch access in Admin → Users. Merchant application review is under Admin → Merchant applications.

For a real deployment, prepare the database before enabling the Render services. Render's current free web service does not provide a pre-deploy command or a service shell, so run the migration and first-admin commands from a trusted terminal with `MONGO_URI` set privately to the same Atlas database that Render will use. Take an Atlas backup first, and verify the target database name before proceeding. Do not run the synthetic seed against production.

```powershell
cd backend
npm ci
npm run migrate
npm run create-admin -- --email admin@your-company.example --name "Courier Admin"
```

The admin command prints a generated password once unless `ADMIN_PASSWORD` is set privately. Save it in a password manager; never use the synthetic seed accounts in production. After that, create the Blueprint in Render, supply `MONGO_URI`, and set `CLIENT_URL` and `VITE_API_URL` to the exact deployed frontend and backend origins. Redeploy the frontend after setting `VITE_API_URL`. Render's `/health/ready` check remains unavailable until the transaction-capable Atlas cluster has every migration applied.

## Render and Atlas

The repository `render.yaml` defines one Node web service (`backend`) and one static site (`frontend`). In Render choose **New → Blueprint**, connect the repository, and enter the Atlas URI when prompted for `MONGO_URI`. Render generates `JWT_SECRET`. After both URLs exist, set the backend `CLIENT_URL` to the exact frontend origin and frontend `VITE_API_URL` to the backend origin, then redeploy both. Do not place secrets in Git or `render.yaml`.

Production session cookies use `SameSite=None; Secure` so the browser can send the API cookie from Render's separate frontend and backend `onrender.com` sites. Cookie-authenticated write requests also require an `Origin` exactly listed in `CLIENT_URL`. If a user's browser blocks cross-site cookies, configure frontend and API custom domains under the same registrable domain (for example, `app.example.com` and `api.example.com`).

Atlas must have a database user and allow network access from the Render service. Prefer a narrow allowlist/private connectivity when available; `0.0.0.0/0` is broad. Before running `npm run migrate` against a deployment, confirm `MONGO_URI` targets the intended database and capture a backup.

Login failures are counted in hashed MongoDB buckets: 5 attempts per IP/email pair and 30 per IP within 15 minutes. Merchant applications are capped at 8 requests per IP/hour. Expired bucket documents are removed by a TTL index. `render.yaml` trusts one reverse-proxy hop so the API can use the client IP; set `TRUST_PROXY` only to the hop count of a proxy you control when running elsewhere. Do not trust forwarded headers when the API is directly exposed.

## Backup and restore

Use MongoDB Database Tools. Delivery proof photos are stored in the private `privateParcelProofs` GridFS bucket alongside proof metadata, so include the full application database in backups. Keep backup files encrypted and outside the repository; validate a restore into a separate database before relying on a backup. Store credentials in your private environment rather than in scripts.

PowerShell example:

```powershell
mongodump --uri $env:MONGO_URI --archive='D:\protected-backups\courier-2026-10-29.archive.gz' --gzip
```

Prefer writing to a protected dated archive path and pass `--gzip` for compression. For a consistent replica-set backup, use `--oplog` where supported. To restore an archive to a separately named recovery database, use `mongorestore --uri $env:RESTORE_URI --archive=<protected-archive> --gzip --nsFrom='courier_parcel.*' --nsTo='courier_parcel_recovery.*'`. Review the namespace/database before any in-place restore; a restore can overwrite data. Never run `--drop` against production as a routine recovery step.

After restoring, verify application reads, migration ledger, parcel/event counts, COD handovers, ledger balances, and payout references before directing traffic to the restored database.

## External configuration and current limits

- Merchant application receipt and review emails are queued transactionally in MongoDB. Configure `NODEMAILER_EMAIL`, `NODEMAILER_PASS`, and optionally `EMAIL_SERVICE` to enable the outbox worker. It retries failed sends up to five times with backoff; administrators can review and manually requeue dead-letter messages in Admin > Email notification queue. `accepted` means SMTP accepted the message; it does not confirm delivery to the recipient. The worker is at-least-once if the process stops after SMTP acceptance but before MongoDB records that result, so a rare duplicate email is possible.
- Delivery proof photos use a private MongoDB GridFS provider; access requires an authenticated user with the owning merchant, assigned rider, branch operations, or admin scope. No proof URL or metadata is exposed by public tracking. Mongo storage capacity and backup retention must be monitored with the database.
- SMS delivery and external object storage providers still need configuration. The storage interface supports provider adapters; the current implementation stores files in MongoDB GridFS.
- Payout processing is manual: the operator records a bank/MFS confirmation reference after completing the transfer. This app does not initiate transfers.
- Legacy customer and agent portal access now shows a retirement notice; historical customer parcels remain read-only in the administrator archive. GPS coordinate writes and customer map displays are disabled. Live GPS, native apps, partial delivery, parcel exchange, automated return routing, online payment, tax, insurance, and automated payouts are outside this MVP.
