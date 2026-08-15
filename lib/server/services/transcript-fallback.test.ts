import assert from "node:assert/strict"
import test from "node:test"

import {
  cleanRecoveredCandidateAnswer,
  extractAnswersByQuestionMarker,
  extractCandidateAnswersFromTranscript,
  fillMissingAnswersFromTranscript,
} from "./transcript-fallback.ts"

// The shape a LiveKit recording actually produces: only interviewer turns are
// labelled, the candidate's speech follows unlabelled.
const verisLabelledTranscript = `VERIS Q1: Please walk me through your experience.

Hi there. So my name is Anamika and I have been in the sector for almost six years.

VERIS Q2: How do you manage customer enquiries during peak support times?

It completely depends upon which process you follow, but we divide by volume.`

const questionEchoTranscript = `
VERIS Q1: Explain your experience
Candidate A1: VERIS Q1: Explain your experience

VERIS Q2: How do you approach performance testing for a large-scale application?
Candidate A2: VERIS Q2: How do you approach performance testing for a large-scale application?
`

test("does not recover VERIS question echoes as candidate answers", () => {
  assert.deepEqual(extractCandidateAnswersFromTranscript(questionEchoTranscript), [])
})

test("keeps missing answers empty when recording transcript only contains question echoes", () => {
  const rows = [
    {
      question: "Explain your experience",
      answerText: "No response provided.",
    },
    {
      question: "How do you approach performance testing for a large-scale application?",
      answerText: null,
    },
  ]

  assert.deepEqual(fillMissingAnswersFromTranscript(rows, questionEchoTranscript), rows)
})

test("cleans stored answer text that exactly echoes the question", () => {
  assert.equal(
    cleanRecoveredCandidateAnswer(
      "VERIS Q4: Implement a TypeScript function that validates an API payload and returns a typed success or error result.",
      "Implement a TypeScript function that validates an API payload and returns a typed success or error result."
    ),
    null
  )
})

test("recovers answers from a transcript where only the questions are labelled", () => {
  assert.deepEqual(
    extractAnswersByQuestionMarker(verisLabelledTranscript, [
      "Please walk me through your experience.",
      "How do you manage customer enquiries during peak support times?",
    ]),
    [
      "Hi there. So my name is Anamika and I have been in the sector for almost six years.",
      "It completely depends upon which process you follow, but we divide by volume.",
    ]
  )
})

test("fills only the missing answers and keeps them aligned to their question", () => {
  const rows = [
    { question: "Please walk me through your experience.", answerText: null },
    {
      question: "How do you manage customer enquiries during peak support times?",
      answerText: "Already captured live.",
    },
  ]

  assert.deepEqual(fillMissingAnswersFromTranscript(rows, verisLabelledTranscript), [
    {
      question: "Please walk me through your experience.",
      answerText:
        "Hi there. So my name is Anamika and I have been in the sector for almost six years.",
    },
    {
      question: "How do you manage customer enquiries during peak support times?",
      answerText: "Already captured live.",
    },
  ])
})

test("does not shift a later answer onto an earlier unanswered question", () => {
  // The old positional fallback consumed a flat list, so one missing answer
  // pulled every later answer up by one question.
  const rows = [
    { question: "Please walk me through your experience.", answerText: "Captured live." },
    {
      question: "How do you manage customer enquiries during peak support times?",
      answerText: null,
    },
  ]

  const filled = fillMissingAnswersFromTranscript(rows, verisLabelledTranscript)
  assert.equal(
    filled[1].answerText,
    "It completely depends upon which process you follow, but we divide by volume."
  )
})

test("does not paste a captured answer onto a question that was never answered", () => {
  // Production shape: every question is labelled, but only the answers that
  // survived live capture carry a Candidate label. Consuming those as a flat
  // list showed Q3's answer under Q1 and Q5's under Q2.
  const mixed = `VERIS Q1: Please walk me through your experience.

VERIS Q2: How do you manage customer enquiries during peak support times?

VERIS Q3: What would you do if a customer was unhappy with a service resolution?

Candidate A3: That could be human error, but the customer has to end up happy.

VERIS Q4: Can you give a specific example of resolving a customer issue?

VERIS Q5: Walk me through your process for onboarding a new customer.

Candidate A5: It depends entirely on which process you follow.`

  const rows = [
    { question: "Please walk me through your experience.", answerText: null },
    { question: "How do you manage customer enquiries during peak support times?", answerText: null },
    {
      question: "What would you do if a customer was unhappy with a service resolution?",
      answerText: "That could be human error, but the customer has to end up happy.",
    },
    { question: "Can you give a specific example of resolving a customer issue?", answerText: null },
    {
      question: "Walk me through your process for onboarding a new customer.",
      answerText: "It depends entirely on which process you follow.",
    },
  ]

  const filled = fillMissingAnswersFromTranscript(rows, mixed)

  assert.equal(filled[0].answerText, null, "Q1 was never answered")
  assert.equal(filled[1].answerText, null, "Q2 was never answered")
  assert.equal(filled[3].answerText, null, "Q4 was never answered")
  assert.equal(
    filled[2].answerText,
    "That could be human error, but the customer has to end up happy."
  )
  assert.equal(filled[4].answerText, "It depends entirely on which process you follow.")
})

test("never assigns an unlabeled full recording transcript to a missing answer", () => {
  const rawRecordingTranscript =
    "Explain your experience. I have five years of experience. " +
    "Implement an API validator. This is the API payload. ".repeat(80)
  const rows = [
    { question: "How do you secure OAuth2 data?", answerText: null },
  ]

  assert.deepEqual(extractCandidateAnswersFromTranscript(rawRecordingTranscript), [])
  assert.deepEqual(fillMissingAnswersFromTranscript(rows, rawRecordingTranscript), rows)
})
