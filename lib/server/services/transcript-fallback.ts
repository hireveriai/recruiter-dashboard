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

  const markerPattern = /(?:^|\n)\s*((?:candidate|answer|a)\s*\d*|veris\s*q?\s*\d*|(?:question|q)\s*\d*)\s*[:\-]\s*/gi
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

export function fillMissingAnswersFromTranscript<T extends { answer?: string; answerText?: string | null; question?: string | null }>(
  rows: T[],
  transcript: string | null | undefined
) {
  const fallbackAnswers = extractCandidateAnswersFromTranscript(transcript)

  if (fallbackAnswers.length === 0) {
    return rows
  }

  let fallbackIndex = 0

  return rows.map((row) => {
    const currentAnswer = "answer" in row ? row.answer : row.answerText
    if (!isEmptyAnswer(currentAnswer)) {
      return row
    }

    const fallbackAnswer = fallbackAnswers[fallbackIndex]
    fallbackIndex += 1

    const cleanedFallbackAnswer = cleanRecoveredCandidateAnswer(fallbackAnswer, row.question)

    if (!cleanedFallbackAnswer) {
      return row
    }

    return {
      ...row,
      ...("answer" in row ? { answer: cleanedFallbackAnswer } : { answerText: cleanedFallbackAnswer }),
    }
  })
}
