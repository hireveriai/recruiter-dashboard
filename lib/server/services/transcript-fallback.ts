type TranscriptSegment = {
  label: string
  text: string
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeForComparison(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b(?:veris\s*q?|candidate|answer|question|q|a)\s*\d*\s*[:\-]\s*/gi, " ")
    .replace(/[^a-z0-9+#.]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function wordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length
}

function isEmptyAnswer(value: string | null | undefined) {
  const normalized = normalizeWhitespace(String(value ?? ""))
  return !normalized || /^no (candidate )?(response|answer)( was)? (recorded|provided)\.?$/i.test(normalized)
}

function isLikelyInterviewerPrompt(value: string | null | undefined) {
  const normalized = normalizeWhitespace(String(value ?? ""))
  return /^(?:veris\s*q?|question|q)\s*\d*\s*[:\-]/i.test(normalized)
}

function isLikelyQuestionEcho(answer: string | null | undefined, question: string | null | undefined) {
  const normalizedAnswer = normalizeForComparison(answer)
  const normalizedQuestion = normalizeForComparison(question)

  if (!normalizedAnswer || !normalizedQuestion) {
    return false
  }

  if (normalizedAnswer === normalizedQuestion) {
    return true
  }

  const answerWords = wordCount(normalizedAnswer)
  const questionWords = wordCount(normalizedQuestion)

  return (
    questionWords >= 4 &&
    answerWords <= questionWords + 2 &&
    (normalizedAnswer.includes(normalizedQuestion) || normalizedQuestion.includes(normalizedAnswer))
  )
}

export function cleanRecoveredCandidateAnswer(answer: string | null | undefined, question: string | null | undefined) {
  const normalizedAnswer = normalizeWhitespace(String(answer ?? ""))

  if (
    !normalizedAnswer ||
    isLikelyInterviewerPrompt(normalizedAnswer) ||
    isLikelyQuestionEcho(normalizedAnswer, question)
  ) {
    return null
  }

  return normalizedAnswer
}

function splitLabeledTranscript(transcript: string) {
  const normalized = transcript.replace(/\r\n/g, "\n").trim()
  if (!normalized) {
    return []
  }

  // `candidate\s*a?\s*\d*` also covers the "Candidate A1:" form, which the
  // earlier pattern silently failed to match: it consumed "Candidate", then
  // required a colon where the "A" sat.
  const markerPattern = /(?:^|\n)\s*((?:candidate|answer)\s*a?\s*\d*|a\s*\d+|veris\s*q?\s*\d*|(?:question|q)\s*\d*)\s*[:\-]\s*/gi
  const markers = [...normalized.matchAll(markerPattern)]

  if (markers.length === 0) {
    return []
  }

  return markers.map((marker, index): TranscriptSegment => {
    const start = (marker.index ?? 0) + marker[0].length
    const end = index + 1 < markers.length ? markers[index + 1].index ?? normalized.length : normalized.length

    return {
      label: marker[1].toLowerCase(),
      text: normalized.slice(start, end).trim(),
    }
  }).filter((segment) => segment.text)
}

export function extractCandidateAnswersFromTranscript(transcript: string | null | undefined) {
  const value = String(transcript ?? "").trim()
  if (!value) {
    return []
  }

  const labeledSegments = splitLabeledTranscript(value)
  const questionSegments = labeledSegments
    .filter((segment) => /^(veris|question|q)\b/i.test(segment.label))
    .map((segment) => segment.text)
  const candidateSegments = labeledSegments
    .filter((segment) => /^(candidate|answer|a)\b/i.test(segment.label))
    .map((segment) => cleanRecoveredCandidateAnswer(segment.text, null))
    .filter((answer) => answer && !questionSegments.some((question) => isLikelyQuestionEcho(answer, question)))
    .filter(Boolean)

  if (candidateSegments.length > 0) {
    return candidateSegments
  }

  // A raw recording transcript is one continuous document containing every
  // question and answer. It has no reliable per-question boundaries, so using
  // paragraphs (or the whole document) as positional answers can attach an
  // entire interview to one missing answer. Only explicitly labelled
  // candidate-answer segments are safe for this display-only fallback.
  return []
}

function isQuestionLabel(label: string) {
  return /^(veris|question|q)\b/i.test(label)
}

function readLabelNumber(label: string) {
  const match = label.match(/(\d+)\s*$/)
  if (!match) {
    return null
  }

  const parsed = Number(match[1])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * Recovers answers from the transcript shape LiveKit recordings actually
 * produce, where only the interviewer turns carry a label:
 *
 *   VERIS Q1: <question text>
 *
 *   <candidate answer>
 *
 *   VERIS Q2: ...
 *
 * The candidate's speech is present and cleanly delimited, but it has no label
 * of its own, so the strict candidate-label extractor discards all of it. Here
 * each labelled question segment is paired with the interview's known question
 * text, the restated question is stripped off the front, and whatever remains
 * is the candidate's answer -- positioned by question order rather than by
 * consuming a flat list.
 *
 * Returns answers aligned to the order the question markers appear in.
 */
export function extractAnswersByQuestionMarker(
  transcript: string | null | undefined,
  questions: Array<string | null | undefined>
) {
  const value = String(transcript ?? "").trim()
  if (!value) {
    return [] as Array<string | null>
  }

  const segments = splitLabeledTranscript(value)
  if (segments.length === 0) {
    return [] as Array<string | null>
  }

  const answers: Array<string | null> = questions.map(() => null)
  let cursor = -1

  const assign = (index: number, answer: string | null) => {
    if (answer && index >= 0 && index < answers.length && !answers[index]) {
      answers[index] = answer
    }
  }

  for (const segment of segments) {
    const labelNumber = readLabelNumber(segment.label)

    if (isQuestionLabel(segment.label)) {
      cursor = labelNumber !== null ? labelNumber - 1 : cursor + 1
      const questionText = questions[cursor] ?? null
      const normalizedQuestion = normalizeForComparison(questionText)

      const paragraphs = segment.text
        .split(/\n\s*\n/)
        .map((paragraph) => normalizeWhitespace(paragraph))
        .filter(Boolean)

      // Drop the leading paragraphs that merely restate the question.
      while (paragraphs.length > 0 && normalizedQuestion) {
        const candidate = normalizeForComparison(paragraphs[0])
        const isRestatement =
          candidate === normalizedQuestion ||
          normalizedQuestion.startsWith(candidate) ||
          candidate.startsWith(normalizedQuestion)

        if (!isRestatement) {
          break
        }

        paragraphs.shift()
      }

      assign(cursor, cleanRecoveredCandidateAnswer(paragraphs.join(" "), questionText))
      continue
    }

    // A candidate turn belongs to the question it follows, or to the question
    // its own label numbers it against ("Candidate A3" -> question 3).
    const index = labelNumber !== null ? labelNumber - 1 : cursor
    assign(index, cleanRecoveredCandidateAnswer(segment.text, questions[index] ?? null))
  }

  return answers
}

export function fillMissingAnswersFromTranscript<T extends { answer?: string; answerText?: string | null; question?: string | null }>(
  rows: T[],
  transcript: string | null | undefined
) {
  // Question-marker recovery is positioned, so an unanswered question never
  // shifts a later answer onto an earlier one. It wins whenever the transcript
  // carries markers at all; the flat candidate list is only for transcripts
  // that label answers without ever labelling the questions.
  const answersByQuestion = extractAnswersByQuestionMarker(
    transcript,
    rows.map((row) => row.question ?? null)
  )
  const usePositioned = answersByQuestion.length > 0
  const fallbackAnswers = usePositioned ? [] : extractCandidateAnswersFromTranscript(transcript)

  if (!usePositioned && fallbackAnswers.length === 0) {
    return rows
  }

  let fallbackIndex = 0

  return rows.map((row, index) => {
    const currentAnswer = "answer" in row ? row.answer : row.answerText
    if (!isEmptyAnswer(currentAnswer)) {
      return row
    }

    let cleanedFallbackAnswer: string | null

    if (usePositioned) {
      cleanedFallbackAnswer = answersByQuestion[index] ?? null
    } else {
      const fallbackAnswer = fallbackAnswers[fallbackIndex]
      fallbackIndex += 1
      cleanedFallbackAnswer = cleanRecoveredCandidateAnswer(fallbackAnswer, row.question)
    }

    if (!cleanedFallbackAnswer) {
      return row
    }

    return {
      ...row,
      ...("answer" in row ? { answer: cleanedFallbackAnswer } : { answerText: cleanedFallbackAnswer }),
    }
  })
}
