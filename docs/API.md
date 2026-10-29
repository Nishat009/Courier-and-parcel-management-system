# API guide

Base URL for local development: `http://localhost:5000`. JSON requests use `Content-Type: application/json`. Browser authentication uses an HttpOnly `courier_session` cookie (`SameSite=Lax` in development, `SameSite=None; Secure` in production for separate Render sites). Cookie-authenticated writes require an `Origin` exactly listed in `CLIENT_URL`. Legacy bearer JWT authentication remains enabled only outside production unless explicitly enabled with `LEGACY_BEARER_AUTH=true`.

`GET /health/live` reports that the API process is responding. `GET /health/ready` returns `200` only while MongoDB is connected, transaction-capable (replica set, sharded, or load-balanced), every repository migration is recorded in the migration ledger, and every applied migration checksum matches its current repository file; it returns `503` otherwise. Render uses the readiness endpoint. Transaction-backed writes return `503` with a clear reason when the database topology cannot support transactions.

Paginated list endpoints validate status and role filters. Unknown enum values and repeated parameters return `400` instead of silently removing the filter. `page` and `limit` must be positive whole numbers; malformed, repeated, zero, negative, or unsafe offsets return `400`. Requested limits above each endpoint's cap are clamped to that cap. Admin user search accepts one `q` value up to 100 characters; operations and merchant tracking-prefix search accepts one `q` value up to 40 characters. Invalid or repeated search parameters return `400`.

All `/api` responses include `Cache-Control: no-store` so authenticated personal, parcel and finance data is not retained by browser or intermediary caches.

Critical parcel, merchant review, cash reconciliation, payout, and reversal writes require an `Idempotency-Key` header (8–128 letters, digits, `.`, `_`, `:`, or `-`). Reusing a key with a different request body returns `409`.

## Identity

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public | `410 Gone`; customer self-registration is retired |
| POST | `/api/auth/login` | Public | Create server-side session cookie |
| POST | `/api/auth/logout` | Public | Revoke current session |
| POST | `/api/auth/password` | Session | Change password using the current password; revoke all sessions and keep a fresh session in this browser |
| GET | `/api/auth/me` | Session | Current account and branch scope |
| POST | `/api/merchants/apply` | Public | Submit pending merchant application |
| GET | `/api/merchants/applications?page=1&limit=20&status=pending` | Admin | Filtered, paginated merchant applications |
| PATCH | `/api/merchants/applications/:id/review` | Admin | Approve/reject pending application; suspend active merchant with reason or reinstate suspended merchant; requires `Idempotency-Key` |

## Operations and merchant

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/admin/users?page=1&limit=25&role=&q=` | Admin | Filtered, paginated user directory without password fields; `q` matches a name or email prefix |
| GET | `/api/admin/notifications?page=1&limit=20&status=dead_letter` | Admin | Paginated transactional email outbox; exposes provider configuration, acceptance, retry counts and recipient for operations review |
| POST | `/api/admin/notifications/:id/retry` | Admin | Requeues a dead-letter email and records the operator and manual retry count |
| POST | `/api/admin/users` | Admin | Create an active internal staff account with an initial password and validated branch scope |
| PATCH | `/api/admin/users/:id/status` | Admin | Suspend or reactivate an operations/accounts/rider account; suspension revokes sessions and live sockets; reactivation requires active branch assignments |
| GET | `/api/admin/bookings?page=1&limit=25&status=` | Admin | Filtered, paginated read-only archive of branchless legacy customer parcels (including records migrated with a merchantId backfill) |
| GET | `/api/admin/pricing` | Admin | Current BDT fees and COD percentage |
| PUT | `/api/admin/pricing` | Admin | Set integer poisha fees and COD basis points for future bookings; append an audit record |
| GET | `/api/merchants/branches` | Approved merchant | Active booking branches |
| POST | `/api/merchants/booking-quote` | Approved merchant | Calculate delivery fee, COD fee and estimated COD settlement from current active branches and server pricing; the final booking always recalculates the snapshot |
| POST | `/api/merchants/bookings` | Approved merchant | Idempotent booking with price snapshot; requires recipient name and Bangladesh mobile number |
| GET | `/api/merchants/parcels?page=1&limit=20&status=&q=` | Merchant | Own paginated parcels; optional exact status and escaped, uppercased tracking-code prefix filters are applied inside merchant ownership scope |
| GET | `/api/merchants/payout-eligibility` | Merchant | Current count and total amount of reconciled COD parcels with matching unreversed COD payable ledger entries |
| GET | `/api/merchants/parcels/:id/events` | Owning merchant | Append-only parcel history |
| GET | `/api/operations/parcels?page=1&limit=25&status=&q=` | Admin / scoped operations | Paginated branch queue of merchant parcels with origin/destination branch summaries; `status` must be a valid operational state, `q` searches an uppercase tracking-code prefix; legacy customer records are excluded |
| GET | `/api/operations/parcels/:id/events?page=1&limit=20` | Admin / operations assigned to either route branch | Paginated, newest-first parcel event history with branch, actor role and decision/failure notes; branchless legacy parcels and out-of-scope parcels return `404` |
| GET | `/api/operations/parcels/riders` | Admin / scoped operations | Active riders in scope |
| GET | `/api/operations/bookings/options` | Admin / scoped operations | Active origin branches (restricted to assigned branches for operations) and active destination branches |
| POST | `/api/operations/bookings` | Admin / scoped operations | Create a branch-assisted booking for an existing approved merchant by merchant email; operations must use an assigned origin branch; requires `Idempotency-Key` |
| PUT | `/api/operations/parcels/:id/transition` | Admin / scoped operations / assigned rider | Validated non-delivery transition; a rider must give a failure reason of at least 8 characters, and Operations/admin must give a decision reason of at least 8 characters when retrying or cancelling a failed delivery; requires `Idempotency-Key` |
| PATCH | `/api/operations/parcels/:id/rider` | Admin / scoped operations | Assign a rider matching the parcel current hub branch; rejects branchless parcels, records the assignment event, and requires `Idempotency-Key` |
| GET | `/api/rider/parcels?page=1&limit=30&status=` | Rider | Own assignments with origin/destination branch summaries whose current hub matches rider branch membership; optional status filter is applied inside this scope, including delivered COD awaiting handover |
| POST | `/api/rider/parcels/:id/proofs` | Assigned rider | Upload a JPEG/PNG/WebP delivery photo (raw image body, maximum 5 MB) after delivery |
| GET | `/api/rider/proofs/:proofId` | Admin / branch operations / owning merchant / assigned rider | Download a private proof after server-side parcel-scope authorization |
| POST | `/api/finance/deliveries/:parcelId/confirm` | Admin / scoped operations / assigned rider | Confirm delivery; an Operations user may confirm prepaid delivery only. Exact COD collection is restricted to the assigned rider or admin |
| GET | `/api/merchants/track/:trackingCode` | Public | Limited operational status and scan history with public branch/city names; excludes recipient PII, proofs, notes, riders and finance events. `DEMO-*` fixtures are accepted only in development/test environments |

## Cash and payout

All money fields in JSON are integer poisha; `100 poisha = BDT 1`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/finance/cash-handovers` | Assigned rider | Submit a branch cash batch |
| GET | `/api/finance/cash-handovers/mine?page=1&limit=10&status=` | Rider | Read-only, paginated handover history for the authenticated rider, including expected/declared/verified amounts and append-only Accounts review attempts; never includes other riders' batches |
| GET | `/api/finance/cash-handovers?page=1&limit=20&status=` | Admin / branch accounts | Scoped handover queue with append-only review attempts and amounts, plus included parcels' tracking code/status/COD snapshot/recorded collection (no recipient PII) |
| PATCH | `/api/finance/cash-handovers/:id/reconcile` | Admin / branch accounts | Record verified count; mismatch remains disputed; requires `Idempotency-Key` |
| POST | `/api/merchants/payouts` | Merchant | Request payout for `{ "allEligible": true }` or selected reconciled parcel IDs |
| GET | `/api/merchants/payouts?page=1&limit=20&status=` | Merchant | Own paginated payout history with included tracking codes and net snapshots, optionally filtered by payout status |
| GET | `/api/merchants/ledger?page=1&limit=25` | Merchant | Immutable entries and current poisha balance |
| GET | `/api/finance/payouts?page=1&limit=20&status=` | Admin / accounts | Payout queue with included tracking codes, net snapshots, and reviewer/payer/reverser identity metadata (no recipient PII) |
| GET | `/api/finance/ledger?page=1&limit=25&merchantId=&type=` | Admin / accounts | Immutable company ledger entries with links, references and reason for related reversal rows; invalid or repeated `merchantId` and `type` filters return `400` |
| PATCH | `/api/finance/payouts/:id` | Admin / accounts | `approve`, `reject`, or `mark-paid`; `reject` requires a reason of 8–1000 characters, and `mark-paid` requires a confirmed payment reference. Admin only may `reverse` a paid payout, with a confirmed return reference and reason; both payment and return references remain on the payout. Requires `Idempotency-Key`. |
| POST | `/api/finance/ledger/:entryId/reverse` | Admin | Reverse a COD payable entry with a required reason; blocked while a payout is requested, approved, or paid. Requires `Idempotency-Key`. |
| GET/POST | `/api/admin/branches` | Admin | List/create branches |
| PATCH | `/api/admin/branches/:id` | Admin | Update branch details or activate/deactivate; transactional deactivation is blocked while active work, handovers, staff assignments, or concurrent booking reservations remain |
| PATCH | `/api/admin/users/:id/access` | Admin | Set role and branch assignments |

## Admin workspace and legacy history

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/admin/dashboard` | Admin | Current Dhaka-day booking count, processing and failed-delivery counts, and delivered COD parcel count |
| GET | `/api/admin/branches` | Admin | List branches, including inactive branches, for administration |
| POST | `/api/admin/branches` | Admin | Create a branch with unique code, name, city and address; optional phone |
| PATCH | `/api/admin/branches/:id` | Admin | Edit branch details or activate/deactivate under the active-work safeguards above |
| PATCH | `/api/admin/users/:id/role` | Admin | Legacy role change for admin/customer accounts; cannot change own role or convert legacy agent accounts |
| GET | `/api/parcel/my-parcels` | Existing customer session | Read historical customer parcel records without stored coordinates; no new customer booking workflow |
| GET | `/api/parcel/assigned` | Existing agent session | Read historical agent assignments without stored coordinates; no new agent workflow |
| POST | `/api/parcel/book` | Existing customer session | Retired; returns `410 Gone` |
| PUT | `/api/parcel/accept/:id`, `/api/parcel/assign/:id`, `/api/parcel/status/:id` | Legacy roles | Retired write routes; return `410 Gone` |

Internal staff credentials are created by an administrator. Share the initial password through a secure channel; this endpoint does not send email or report a delivery confirmation. Operations, accounts, and rider roles require at least one active branch. Admin accounts are unscoped.

Pricing update bodies use `sameBranchFeePoisha`, `interBranchFeePoisha`, and `codFeeBasisPoints` as non-negative integers. COD rates are capped at 10,000 basis points (100%). Each booking stores its own price snapshot, so rate changes never reprice existing parcels.

Merchant booking recipient phones accept local `01XXXXXXXXX` format or an international `+8801XXXXXXXXX` form; stored values are normalized to `+880…`. Public tracking excludes recipient name and phone.

The public tracking page refreshes an active parcel every 60 seconds while its browser tab is visible. Polling stops when the parcel is delivered or cancelled and continues to use the rate-limited public tracking endpoint.

## Common responses

- `400`: validation or unsupported transition.
- `401`: missing, expired, or revoked session.
- `403`: role, account state, branch, merchant, or rider scope denied.
- `404`: resource not visible to the caller or not found.
- `409`: state changed concurrently, duplicate idempotency key with different body, or settlement not eligible.
- `503`: database or service unavailable. Provider adapters must not report unconfirmed external success.

New screens should use the API response schema and must not infer permission from client-side route state.

## Live updates

Socket.IO uses the authenticated `courier_session` cookie and the same account/branch scope as the HTTP API. Admins receive administrative, finance, and all-branch update events; operations and accounts sockets join only their assigned branch rooms; merchants and riders join only their own account rooms. Events contain identifiers and minimal status values, and clients refresh through the scoped HTTP APIs before displaying current records. Event names include `parcelChanged`, `parcelAssigned`, `statusUpdate`, `cashHandoverChanged`, and `payoutChanged`.

Legacy customer and agent write endpoints (`POST /api/parcel/book`, `PUT /api/parcel/accept/:id`, `/assign/:id`, and `/status/:id`) return `410 Gone`. Existing legacy parcel records remain available to their owners as read-only data and in the administrator archive. Existing stored coordinates are not returned by legacy customer/agent parcel reads.

Repeated invalid login attempts receive `429` with `Retry-After`; counters use keyed hashes and expire after 15 minutes. Login rejects passwords over bcrypt's 72-byte input limit rather than silently truncating them.
Merchant applications are limited to 8 requests per IP/hour; excess traffic receives `429` with `Retry-After`.
