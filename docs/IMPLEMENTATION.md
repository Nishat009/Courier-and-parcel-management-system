# Courier platform implementation guide

## Product scope

One Bangladesh courier operator with multiple branches/hubs. The MVP includes operations, accounts, merchant and rider web portals, and public tracking. Money is stored as integer poisha and displayed as BDT in `Asia/Dhaka`. No SaaS tenancy, native apps, live GPS, partial delivery, or parcel exchange.

## Current foundation and architecture

The repository already uses React 19 + Vite, React Router, Express 5, Mongoose, MongoDB, JWT auth and Socket.IO. Preserve this deployed foundation for the MVP instead of replacing it with Next.js/PostgreSQL. Use a modular monolith: route adapters -> domain services -> Mongoose models; domain modules are parcels, identity, branches, pricing, cash reconciliation, merchant ledger and payouts. Use MongoDB transactions for multi-document financial writes; production MongoDB must be a replica set (Atlas qualifies). Use conditional writes/version checks for state changes and idempotency keys for retried commands.

MongoDB has no Prisma-style schema migration system. Versioned, repeatable migration scripts in `backend/src/migrations` and a migration ledger are the migration mechanism. Existing parcel/user documents must remain readable during rollout.

## Domain and state rules

- Merchant status is independent of account role: `pending -> approved | rejected -> suspended`. Public merchant applications never grant operational access. Only approved merchants may book.
- Parcel operational states: `Processing -> Booked -> Picked Up -> At Origin Hub -> In Transit -> At Destination Hub -> Out for Delivery -> Delivered`; `Delivery Failed` is a recorded attempt and requires an authorized retry or return decision. The rider's failure reason and the Operations/admin retry or cancellation decision reason are recorded in append-only event history with actor, time, and branch/rider context.
- COD financial state is separate: `not_due -> due -> collected -> handed_over -> reconciled -> payable -> paid`; exceptions use explicit reversal entries, never edits/deletes. Prepaid parcels have no COD receivable.
- COD eligibility requires successful delivery, the configured exact COD amount collected, and cash handover reconciled by an accounts/branch role. Merchant payout is net of the booking-time fee snapshot. A payout can be marked paid only after an external bank/MFS confirmation reference is recorded; the MVP does not execute transfers.
- BDT values are integer poisha. Booking stores an immutable price snapshot. Initial configurable defaults: base delivery fee 60 BDT inside destination branch area, 100 BDT intercity; COD fee 1% (rounded half-up to poisha); no tax/insurance/surge fee. Operations may revise rates for future bookings only.
- Asia/Dhaka is used for user-facing date grouping and display; persisted timestamps remain UTC.
- No delivery confirmation provider is assumed. A rider records an attempt/result and proof metadata; SMS, email and private file storage use adapters and report unavailable until configured.
- Merchant application receipt and review email notifications are written to a transactional MongoDB outbox. The SMTP worker reports provider acceptance only, retries with a bounded backoff, and leaves exhausted messages for operator review; delivery is not claimed. SMS remains an adapter awaiting a configured provider.

## Permission matrix

| Capability | Admin | Operations | Accounts | Merchant | Rider | Public |
|---|---:|---:|---:|---:|---:|---:|
| Approve merchants / manage users | yes | no | no | own profile only | no | no |
| All branches, parcels and assignments | yes | assigned branches | read as needed | own parcels | own assignments | no |
| Create bookings | yes | yes | no | approved account only | no | no |
| Advance operational state | yes | assigned branches | no | no | assigned parcels and allowed steps | no |
| Record COD collection | yes | no | no | no | own delivered parcel | no |
| Verify cash handover / reconcile | yes | no | assigned branches | no | submit handover only | no |
| Build/confirm merchant payout | yes | no | yes | request/view own | no | no |
| Track a parcel | yes | yes | yes | own parcels | assigned parcels | tracking code + limited public fields |

Every API query and write must enforce role plus merchant, branch and rider scope server-side. Client route guards are convenience only.

Accounts users are branch-scoped for cash handover review and reconciliation. Merchant balances and payout queues are consolidated company-wide, so admin/accounts roles can review the central payout and ledger queues; only admin may reverse ledger/payout entries. Admin and operations may create a booking on behalf of an existing approved merchant using that merchant's email; operations must select an origin branch in their assignment. The booking remains owned by the merchant, while the event records the staff actor.

## Development milestones

1. Foundation and decisions: repository audit, docs, env templates, fixtures and test harness.
2. Identity and access: secure server-side session cookie, merchant application/approval, branches and role/branch scopes.
3. Parcel lifecycle: booking validation, price snapshots, assignment, state machine, append-only events, public tracking.
4. COD and settlement: collection, branch handover, reconciliation, immutable merchant ledger and payout lifecycle/reversals.
5. Portals: operations/accounts, merchant, mobile rider, tracking; loading/empty/error/permission states and pagination.
6. Hardening and operations: provider adapters, migration/seed/backup instructions, critical-flow Playwright and full validation.

## Open policies with safe defaults

- Delivery retry/return policy: default to a logged `DeliveryFailed` attempt and keep parcel assigned for an operations decision; no automatic second attempt or return movement. A manual retry or cancellation requires an auditable decision reason.
- Service areas and fee bands: synthetic seed includes Dhaka and Chattogram branches; keep fee bands in editable configuration and do not infer real-time routing costs.
- Payout frequency/minimum: default to manual, on-demand eligible batches with no minimum; mark paid only with a confirmation reference.
- Proof retention/access: keep private references, not public URLs; scoped access and no public proof exposure. Retention duration remains an operator-configurable policy.
- Payment provider, SMS/email and file storage credentials are external configuration; no success is claimed without provider confirmation.

## Implementation checklist

- [x] Inspect repository, current stack, and local instructions (no `AGENTS.md` found).
- [x] Document product scope, architecture, status/finance rules, permissions, assumptions, and milestones.
- [x] Foundation: domain schemas/indexes, migration ledger/runner, synthetic seed script, configuration defaults, and domain test harness.
- [x] Merchant application/review, HttpOnly server-side sessions, role/branch authorization primitives, branch administration endpoints.
- [x] Admin staff account creation with internal-role validation, active-branch assignment checks, and bcrypt-hashed initial passwords.
- [x] Suspend/reactivate operations, accounts, and rider accounts; suspension atomically revokes server sessions and live sockets, and reactivation requires active branch assignments. Admin and merchant lifecycle remains under protected admin/review workflows.
- [x] Authenticated password change for every role; verify the current password and revoke other sessions while rotating the current session.
- [x] Login brute-force protection with hashed MongoDB rate buckets, per-IP and per-account/IP failed-attempt windows, and constant-cost invalid-account comparison.
- [x] Support cross-site Render frontend/API session cookies with `SameSite=None; Secure` and require configured `Origin` on cookie-authenticated writes.
- [x] Rate-limit public merchant applications by IP using expiring, opaque MongoDB counters.
- [x] Rate-limit public tracking lookups by IP while keeping the tracking response limited to parcel status and scan history.
- [x] Disable browser and intermediary caching for API responses that may contain session or parcel data.
- [x] Merchant review action idempotency for approval/rejection/suspension/reinstatement.
- [x] Admin merchant suspension/reinstatement with reason history, transactional account-state update, revoked sessions, and disconnected active sockets.
- [x] Merchant booking price snapshot, idempotency, branch booking, state machine, compare-and-swap transition and event history.
- [x] Capture and normalize recipient name/mobile for merchant bookings; expose contact details only inside authorized merchant, rider, operations, and admin parcel views.
- [x] Require idempotency keys for parcel transitions and replay the original transition result on safe retries.
- [x] Require idempotency keys for rider assignment and append an event when the assignment changes.
- [x] Require riders to remain assigned to the relevant origin/destination branch for parcel access, transitions, and private proof access.
- [x] Require idempotency keys for cash reconciliation, payout decisions, and COD payable reversal; the finance UI reuses pending keys after ambiguous network failures.
- [x] Persist pending browser idempotency keys in tab-scoped session storage so an ambiguous critical write can safely reuse its key after a page reload; clear these keys on explicit logout.
- [x] Rider COD capture, branch cash handover, reconciliation, and append-only merchant ledger entries.
- [x] Enforce COD capture permissions in the domain service: only the assigned rider or an admin can record collection; Operations may confirm prepaid delivery within branch scope.
- [x] Expose delivery confirmation in the admin/operations workspace: admins can enter exact COD collected, while branch Operations can confirm prepaid parcels only.
- [x] Block Mongoose bulkWrite mutations on ledger entries, parcel events, and cash-review attempts so append-only safeguards cover bulk as well as query writes.
- [x] Parse BDT form values as decimal strings into integer poisha/basis points without binary floating-point rounding.
- [x] Format signed BDT ledger values and admin pricing snapshots from integer units without converting large poisha values through floating point.
- [x] Payout eligibility, approval, confirmed-reference payment recording, and explicit reversal.
- [x] Show merchant-wide payout eligibility totals only for reconciled parcels with one matching, unreversed COD payable ledger entry; reserve that same eligible set atomically, independent of the visible parcel-history page.
- [x] Operations/accounts/merchant/rider/admin/public tracking screens and API documentation.
- [x] Keep list loading, empty and request-error states distinct across the portal queues.
- [x] Document the complete mounted admin and legacy-history API surface, including retired writes, read-only routes, access rules, and response purpose.
- [x] Let merchants expand each parcel to view its chronological operational and settlement event history.
- [x] Enforce live-GPS and retired-workflow exclusions by removing customer/agent dashboards, Google Maps code/configuration/dependency, and rejecting legacy coordinate writes.
- [x] Admin-configurable booking fees and COD rate with append-only change history; new rates affect future bookings while booking snapshots remain fixed.
- [x] Branch activation control with transactional deactivation guard for active parcels, unresolved handovers, assigned staff, and concurrent booking reservations.
- [x] Let admins edit branch name, city, address, and optional phone from the branch workspace while preserving the existing activation safeguards.
- [x] Rider delivery photo upload to private MongoDB GridFS, scoped proof download for authorized merchant/rider/operations/admin, and retention in database backups.
- [x] Keep delivered COD collections visible to riders until cash is submitted for branch handover.
- [x] Clear stale rider cash-handover selections when parcel pages/data change; submit only the visible eligible selection and show its expected amount.
- [x] Paginated/filtered accounts handovers, payouts and ledger; paginated merchant payout history and admin merchant applications.
- [x] Paginate/filter the admin user and all-branch booking lists, as well as merchant applications.
- [x] Add an opt-in replica-set integration suite for migration compatibility, the merchant-to-payout workflow, concurrent transitions, immutability, and reversals; it uses a unique temporary database and never falls back to `MONGO_URI`.
- [x] Add and run Playwright browser workflows for merchant application, public tracking, COD booking, rider COD collection, cash reconciliation, and recorded payout. The browser suite stubs HTTP responses; domain/database behavior is covered separately.
- [x] Execute the replica-set integration suite against a unique temporary database; verify migration compatibility and the merchant-to-payout reversal flow. Confirm the local synthetic seed includes all roles, both branches, and each important parcel status.
- [x] Deployment, backup/restore, local setup, and known external configuration documented.
- [x] Pin a compatible Node.js runtime for both Render services and enforce the supported engine range in package manifests and lockfiles.
- [x] Add separate liveness/readiness endpoints, require transaction-capable MongoDB topology for readiness, and configure Render to check it.
- [x] Document Free Render deployment order: back up Atlas, run migrations and create the first admin from a trusted terminal, then configure and deploy the Blueprint.

## Progress record

The new merchant-to-payout workflow is implemented in the modular monolith and its screens are wired to the API. Merchant payout eligibility is summarized across all pages only when the parcel has one matching, unreversed COD payable ledger entry; payout requests reserve that eligible set inside one transaction. Admins can configure same-branch/inter-branch delivery fees and COD percentage; each change is recorded and only applies to new parcel snapshots. Riders can record actual COD cash, upload private delivery photos, and submit cash handovers; Accounts reconciles the physically counted amount. Delivered COD parcels remain visible to the assigned rider until handover. Private proof access is checked against merchant ownership, rider assignment, operations branch scope, or admin role; the public tracking API exposes no proof data. Frontend lint and production build pass after these UI changes; workflow tests are intentionally deferred for the current build-focused iteration. The opt-in database integration suite remains pending execution on a dedicated test database. SMS and external object storage providers still need configuration; the current private storage adapter uses MongoDB GridFS.

- [x] Keep historical customer parcel records visible in admin as read-only; route all active merchant parcel operations through the branch-aware operations workflow.
- [x] Scope cancellation to the parcel's current handling hub: origin before the delivery attempt, destination after a failed delivery; record the same branch in parcel history.
- [x] Exclude legacy branchless records from the operations queue and reject transition, assignment, or delivery writes for legacy records in the domain layer.
- [x] Return branch scope on login and show Operations actions only when the signed-in staff member is assigned to the transition or assignment branch.
- [x] Populate origin/destination hub summaries in Operations and Rider queues and group rider cash handovers by destination hub.
- [x] Set acceptance metadata on the Processing-to-Booked transition and scope admin dashboard counts to current branch-routed merchant parcels in Asia/Dhaka day boundaries.
- [x] Require all migration names and source checksums as part of API readiness and keep migrated branchless customer records visible in the read-only admin archive.
- [x] Append an auditable parcel event for every cash handover count mismatch so merchants can see why COD settlement remains on hold.
- [x] Keep each cash reconciliation attempt and its counted amount, reviewer, timestamp, and result in an append-only collection; expose the review history in the scoped Accounts queue.
- [x] Let admin and branch operations create idempotent assisted bookings for an approved merchant, preserving merchant ownership and enforcing assigned-origin scope.
- [x] Deliver authenticated, role/branch-scoped live update events for parcel, cash handover, and payout changes; portals reload their scoped API data when events arrive.
- [x] Require and preserve a rider's reason when recording a failed delivery attempt, so operations can make an informed retry or cancellation decision.
- [x] Require Operations/admin to record a reason when retrying or cancelling a failed delivery, and store that decision in the transactional parcel transition event.
- [x] Give Operations/admin paginated, newest-first, server-side branch-scoped parcel activity so riders' failed-delivery notes and prior decisions are visible before action.
- [x] Show Accounts the tracking codes, COD booking snapshots and rider-recorded amounts inside each cash batch without exposing recipient personal data.
- [x] Show merchants and Accounts the tracking codes and net booking snapshots inside each payout batch, without exposing recipient personal data.
- [x] Show merchant payout lifecycle timestamps and Accounts-side reviewer, payer, and reverser identities alongside their recorded references.
- [x] Require Accounts/admin to provide a reason when rejecting a merchant payout and show that reason in the merchant payout history.
- [x] Refresh public tracking every 60 seconds in a visible tab, pause requests in background tabs, and stop polling on terminal delivery/cancellation states.

- [x] Retire customer self-registration and legacy customer/agent write endpoints; preserve existing parcel history as read-only and direct public parcel applicants to merchant review.
- [x] Add branch-scoped operations queue search by tracking-code prefix, combined with status filters and pagination.
- [x] Reject unknown status/role filter values across paginated admin, operations, merchant, rider and finance queues instead of silently ignoring the filter.
- [x] Add admin directory search by name/email prefix combined with role filters and pagination.
- [x] Show public branch/city names at each tracking scan while keeping notes, rider identity, recipient details, proofs and finance events private.
- [x] Give synthetic parcel fixtures a complete booking and operational scan history; permit their `DEMO-*` tracking codes only in development/test environments.
- [x] Seed both approved and pending merchant accounts so admin approval has a synthetic application fixture.
- [x] Show merchants a server-calculated booking fee/COD/settlement estimate; booking still recalculates and snapshots the final price.
- [x] Show each merchant parcel's saved delivery fee, COD amount, COD fee rate/amount, and net settlement snapshot in parcel history.
- [x] Show payout and COD payable reversal references, reasons, timestamps, and links to the immutable reversal ledger entries in Accounts.
- [x] Let riders filter their paginated assignment queue by operational status while keeping the server-side rider and branch scope applied.
- [x] Give riders a read-only, status-filtered, paginated cash-handover history with expected, declared and verified amounts plus append-only Accounts recount attempts.
- [x] Let merchants filter their own paginated payout history by lifecycle status, applying ownership scope before filtering and counting.
- [x] Let merchants search their own paginated parcel history by escaped tracking-code prefix alongside operational status, applying both filters inside merchant ownership scope.
- [x] Queue merchant application/review emails in the same database transaction as the state change; retry SMTP failures with bounded backoff, track provider acceptance without claiming recipient delivery, and let admins manually requeue dead-letter messages.
- [x] Validate positive integer pagination and safe database offsets across all paginated API queues; reject malformed and repeated `page`/`limit` parameters.
- [x] Reject repeated or oversized admin, operations, and merchant search parameters instead of silently ignoring or truncating them.
