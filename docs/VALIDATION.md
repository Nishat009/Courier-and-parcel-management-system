# Validation results

Last recorded: 2026-10-29. These checks ran on the local development environment. Browser workflow tests use stubbed HTTP responses; the database integration test exercises the real domain services and a disposable MongoDB database.

| Check | Result | Coverage and limits |
|---|---|---|
| `backend`: `npm test` | 48 passed, 0 failed | Authorization and route behavior, retired legacy writes, server-side sessions, pricing/state/finance rules, and input validation |
| `backend`: `npm run test:integration` | 1 passed, 0 failed | Connected to local replica set `rs0` on port 27018 with `TEST_MONGO_URI`; applied all repository migrations and ran the merchant booking-to-payout-reversal workflow in a unique temporary database, then dropped that database |
| `frontend`: `npm run test:e2e` | 4 passed, 0 failed | Merchant application/public tracking, COD booking, rider COD confirmation, and Accounts cash reconciliation/payout UI; HTTP endpoints are stubbed and Socket.IO is disabled for isolation |
| `frontend`: `npm run lint` | Passed | ESLint |
| `frontend`: `npm run build` | Passed | Vite production bundle |
| Backend source syntax checks | Passed | Changed route and query utility files checked with `node --check` |
| Development seed inspection | Passed | Found 6 synthetic accounts, 2 branches, 2 merchant profiles, and 10 `DEMO-*` parcels covering the seeded operational statuses |
| Local readiness | Passed | `GET /health/ready` returned `200` with MongoDB connected and migration checksums current |

The integration suite uses a random `courier_integration_test_*` database name and does not use the application database. Keep `TEST_MONGO_URI` pointed at a disposable replica set when repeating it. Browser tests do not prove API/database correctness; use the database integration suite for that coverage.
