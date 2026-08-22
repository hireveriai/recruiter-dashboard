# VerisNova Recruiter Backend

Backend APIs for the recruiter dashboard using the existing PostgreSQL schema.

## Folder Structure

```text
backend/
  src/
    app.js
    server.js
    config/
      db.js
      env.js
    controllers/
      alerts.controller.js
      candidates.controller.js
      interview-invite.controller.js
      interviews.controller.js
      jobs.controller.js
      recordings.controller.js
      veris.controller.js
    middlewares/
      error-handler.js
    repositories/
      alerts.repository.js
      candidates.repository.js
      interview-invite.repository.js
      interviews.repository.js
      jobs.repository.js
      recordings.repository.js
      veris.repository.js
    routes/
      alerts.routes.js
      candidates.routes.js
      index.js
      interview.routes.js
      interviews.routes.js
      jobs.routes.js
      recordings.routes.js
      veris.routes.js
    services/
      alerts.service.js
      candidates.service.js
      dashboard.service.js
      interview-invite.service.js
      interviews.service.js
      jobs.service.js
      recordings.service.js
      veris.service.js
    utils/
      api-error.js
```

## Endpoints

- `POST /jobs`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /interview/create-link`
- `GET /candidates`
- `GET /candidates/:id`
- `GET /interviews`
- `GET /interviews/:id`
- `GET /alerts`
- `GET /recordings/:interviewId`
- `GET /veris/:candidateId`

## Request Body

### Create Job

```json
{
  "title": "Senior Backend Engineer",
  "department": "Engineering",
  "location": "Remote",
  "employmentType": "Full-time",
  "description": "Build recruiter-facing backend services.",
  "requirements": "Node.js, Express, PostgreSQL",
  "status": "open"
}
```

### Create Interview Link

```json
{
  "interviewId": 12,
  "expiresInHours": 48
}
```

Or create the interview first if it does not already exist:

```json
{
  "candidateId": 101,
  "jobId": 7,
  "scheduledAt": "2026-03-25T10:00:00.000Z",
  "expiresInHours": 48
}
```

## Dashboard Aggregation

`dashboard.service.js` normalizes recruiter-facing data into a consistent aggregate with:

- candidate info
- interview status
- expiry
- risk level
- invite status and link when available

The `GET /candidates` and `GET /interviews` APIs already include this aggregate in their `dashboard` field.

## SQL Mapping

API resource name `jobs` maps to the existing `job_positions` table.

- `employmentType` -> `employment_type`
- `createdAt` -> `created_at`
- `updatedAt` -> `updated_at`

Interview links map to the existing `interviews` and `interview_invites` tables.

- API link format: `/interview/{token}`
- Default invite expiry: 48 hours
- Invite statuses: `ACTIVE`, `EXPIRED`, `USED`
- `attemptsUsed` -> `attempts_used`
- `expiresAt` -> `expires_at`

Recruiter dashboard APIs use the existing tables only:

- `candidates`
- `interviews`
- `interview_invites`
- `interview_recordings`
- `fraud_signals`
- `interview_summaries`
- `job_positions`

## Start

Install dependencies and run:

```bash
npm install
npm run backend:start
```
