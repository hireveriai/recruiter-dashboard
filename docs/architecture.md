# VerisNova Interview Architecture

## Layers

### 1. Shared AI Brain (Backend)
Responsibilities:
- Question generation
- Answer evaluation
- Fraud detection
- Scoring
- Next question decision

Location: `lib/server/ai`
API surface: `/api/ai/*`

### 2. Recruiter Dashboard
Responsibilities:
- Job creation
- Interview configuration
- Reports and outcomes

UI should only display state; all decision logic must live in backend.

### 3. Calm Room
Responsibilities:
- Ask questions
- Capture answers
- Display real-time interaction

The calm room must call the backend for:
- evaluation
- next question selection

## Rules
- Centralize intelligence in backend
- UI layers must not contain decision logic
- Behavioral questions must be enforced by backend generation logic

## Behavioral Questions Policy
- Always included in every interview
- Placement: mid/probe phases (never at start)
- Mix by role type:
  - Technical: 15-25% (target 20%)
  - Non-technical: 40-50% (target 45%)
  - Hybrid: ~30%
- Must be contextual to job skills
