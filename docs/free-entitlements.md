# Free entitlements (recruiter trial + candidate practice)

One entitlement architecture for the whole platform:

```
Signup  →  Request  →  Validation / review  →  Approval  →  Grant
```

Creating an account grants nothing. Free credits only exist after an approved
request, and every consumption path verifies that server-side.

## Where the old automatic grant lived

| Location | What it did |
| --- | --- |
| `organizations_seed_workspace_trial_credits` trigger on `public.organizations` | Inserted `10 / 25` into `workspace_trial_credits` for every new organization. This was the real grant. |
| `workspace_trial_credits` column defaults (`10`, `25`) | Any insert without explicit values produced a funded workspace. |
| `upsertTrialCreditRow()` in `lib/server/services/trial-credits.ts` | Explicitly inserted `FREE_TRIAL_INTERVIEW_CREDITS` / `FREE_TRIAL_SCREENING_CREDITS` on first read. |
| `ensureTrialCreditOptionalSchema()` in the same file | **Re-created the trigger on every server boot**, so removing it in SQL alone would not have held. |

All four are removed. `sp_onboard_recruiter` itself never granted credits — it
only inserted the organization row that fired the trigger, so it is unchanged.

Candidates previously had no free entitlement at all; the free practice
interview is new and follows the same flow rather than being auto-granted.

## Schema

| Object | Purpose |
| --- | --- |
| `trial_requests` | One row per request. Status, risk score, risk reasons, validation payload, IP / user-agent / device signals, decision + decider. |
| `trial_grants` | The entitlement itself. `grant_key` is **unique** — the hard guarantee that one subject receives one grant, ever. |
| `trial_request_events` | Append-only audit of every state transition, including automated ones and the migration backfill. |
| `workspace_trial_credits` | Existing balance table, **extended** with `trial_status`, `trial_request_id`, `trial_granted_at`, `trial_expires_at`. Not duplicated. |
| `hireveri_user_subscriptions` | Existing credit system, **reused** for candidate free practice via the `practice-free-trial` plan and the deterministic id `free-practice-<identityId>`. |
| `email_domain_reputation` | Disposable / public mailbox classification. |
| `platform_admins` | Reviewers, alongside the `PLATFORM_ADMIN_EMAILS` env allowlist. |

Two partial unique indexes on `trial_requests` allow at most one
`PENDING_REVIEW` and at most one `APPROVED` request per subject.

## Functions (authoritative logic)

Kept in Postgres, matching the existing `sp_`/`fn_` convention, so the
recruiter app, candidate app and any future admin surface share one
implementation and one transaction boundary.

- `fn_request_recruiter_trial(...)` — validation, risk scoring, request creation and (when the company validates cleanly) the grant, in one call.
- `fn_request_candidate_practice(...)` — the same for candidates.
- `fn_approve_trial_request(id, actor, reason)` / `fn_reject_trial_request(...)` — admin decisions. Approve takes a row lock and is idempotent.
- `fn_apply_trial_grant(id)` — the only path that writes credits. Refuses non-approved requests; `on conflict (grant_key) do nothing` makes it a no-op once granted.
- `fn_get_recruiter_trial_state(orgId)` / `fn_get_candidate_practice_state(identityId)` — read models for the dashboards.
- Helpers: `fn_normalize_email`, `fn_email_domain`, `fn_website_domain`, `fn_email_domain_kind`, `fn_company_matches_domain`.

## Enforcement

Recruiter (`lib/server/services/trial-credits.ts`):

1. `evaluateEntitlementGate()` refuses anything that is not `APPROVED` or a paid subscription — `403 FREE_TRIAL_NOT_ACTIVE` / `403 FREE_TRIAL_PENDING_REVIEW`.
2. The deduction `UPDATE` additionally carries `and trial_status = 'APPROVED' and <credits> >= amount`, so the decision is made by the database under concurrency, not by the earlier read.
3. `resolveVisibleCredits()` reports zero for an inactive trial, so the API can never advertise credits it would refuse to spend.

This sits behind the existing call sites — `interview/create-link`,
`send-interviews`, `match-candidates` — which already routed through
`assertTrialCreditsAvailable` / `deductTrialCredits`. Nothing else changed there.

Candidate (`lib/server/practice-entitlement.ts`):

1. `assertCanStartPracticeInterview()` requires a paid credit or an approved free credit.
2. The credit is spent **before** the interview is created, and refunded if creation fails.
3. `POST /api/practice/interviews` no longer accepts an `identityId` from the request body — it previously fell back to it when no session was present, which skipped the credit check entirely.

## Abuse prevention

Layered signals, scored, never a permanent block:

- normalized email (plus-tags stripped everywhere, dots stripped for Gmail)
- email verification status
- disposable / public / corporate mailbox classification
- company name ↔ email domain ↔ website domain consistency
- another organization on the same corporate domain already holding a trial
- prior grant on the same normalized email, device or IP
- request bursts per IP (soft: forced review; hard: `429`)

Score ≤ 20 auto-approves; anything above goes to `PENDING_REVIEW` for a human.
A rejected subject may not re-submit for 14 days, but a reviewer can approve at
any time — shared devices, offices and libraries are normal.

Recruiter and candidate entitlements are independent: a former practice
candidate can still get a recruiter trial (subject to company validation), and a
recruiter trial never grants practice credit.

## Migrations

Apply in order:

1. `prisma/sql/prod/012_free_entitlement_requests.sql` — tables, columns, drops the auto-grant trigger, resets defaults to 0. Grandfathers every existing balance row to `APPROVED` in the same transaction that adds `trial_status`, so it is safe on its own.
2. `prisma/sql/prod/013_free_entitlement_functions.sql` — the functions.
3. `prisma/sql/prod/014_free_entitlement_backfill.sql` — retroactive request + grant + audit rows for existing workspaces. **Balances are never modified.**

Rollback: `prisma/sql/prod/012_free_entitlement_requests_rollback.sql`.

Deploy order does not matter: the app's `ensureTrialCreditSchema()` performs the
same column addition and grandfathering, and drops the trigger, so deploying the
app before the migration is also safe.

Existing production state at time of writing: 5 organizations, all with
partially consumed balances, 3 with active paid subscriptions. All 5 are
grandfathered to `APPROVED` with their balances untouched. Existing practice
candidates are **not** backfilled — they never had a free entitlement, so there
is nothing to preserve; they can request one like anyone else.

## Admin

`/admin/trial-requests` in the recruiter app, gated by `requirePlatformAdmin()`
(env `PLATFORM_ADMIN_EMAILS`, comma separated, or a row in `platform_admins`).
Shows requester, email, domain, website, request type, date, validation result,
risk indicators and status. Approve / reject are idempotent — the second click
returns `granted: false` and writes nothing.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PLATFORM_ADMIN_EMAILS` | Comma-separated reviewer allowlist (recruiter app). |
| `RESEND_API_KEY`, `EMAIL_FROM` | Already used by the recruiter app; the candidate app now uses the same account through the Resend REST API (no new dependency, no new provider). |

## Tests

```bash
npm run test:unit    # pure policy tests, no database
npm run test:db      # full flow against a real Postgres
npm test             # both
```

`test:db` needs `TEST_DATABASE_URL` and skips cleanly without it:

```bash
docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=postgres --name hv-test postgres:17
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres npm run test:db
```

It applies `test/fixtures/entitlement-fixture-schema.sql` (the pre-migration
shape, auto-grant trigger included) and then migrations 012–014, so the
migrations themselves are exercised.
