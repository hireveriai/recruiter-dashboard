type TranscriptSegment = {
  label: string
  text: string
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function isEmptyAnswer(value: string | null | undefined) {
  const normalized = normalizeWhitespace(String(value ?? ""))
  return !normalized || /^no (candidate )?(response|answer)( was)? (recorded|provided)\.?$/i.test(normalized)
}

function splitLabeledTranscript(transcript: string) {
  const normalized = transcript.replace(/\r\n/g, "\n").trim()
  if (!normalized) {
    return []
  }

  const markerPattern = /(?:^|\n)\s*((?:candidate|answer|a)\s*\d*|(?:veris|question|q)\s*\d*)\s*[:\-]\s*/gi
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
  const candidateSegments = labeledSegments
    .filter((segment) => /^(candidate|answer|a)\b/i.test(segment.label))
    .map((segment) => normalizeWhitespace(segment.text))
    .filter(Boolean)

  if (candidateSegments.length > 0) {
    return candidateSegments
  }

  return value
    .split(/\n{2,}/)
    .map(normalizeWhitespace)
    .filter(Boolean)
}

export function fillMissingAnswersFromTranscript<T extends { answer?: string; answerText?: string | null }>(
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

    if (!fallbackAnswer) {
      return row
    }

    return {
      ...row,
      ...("answer" in row ? { answer: fallbackAnswer } : { answerText: fallbackAnswer }),
    }
  })
}
