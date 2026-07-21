import assert from "node:assert/strict"
import test from "node:test"

import {
  cleanRecoveredCandidateAnswer,
  extractCandidateAnswersFromTranscript,
  fillMissingAnswersFromTranscript,
} from "./transcript-fallback.ts"

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
