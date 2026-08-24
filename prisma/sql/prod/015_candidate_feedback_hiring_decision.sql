-- Lets a recruiter attach their hiring decision (or withhold it) to a
-- candidate feedback email sent from Interviews > Generate Candidate Feedback.
-- Separate from candidate_recruiter_decisions, which tracks the internal
-- REVIEW_REQUIRED/PROCEED/HOLD/REJECT workflow -- this only records what was
-- last communicated to the candidate, in the candidate-facing vocabulary.

alter table public.interviews
  add column if not exists candidate_feedback_hiring_decision text;

alter table public.interviews
  drop constraint if exists interviews_candidate_feedback_hiring_decision_check;

alter table public.interviews
  add constraint interviews_candidate_feedback_hiring_decision_check
    check (candidate_feedback_hiring_decision in ('SHORTLISTED', 'REJECTED', 'UNDISCLOSED'));
