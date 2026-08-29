// Machine identifiers (NEEDS_REVIEW, follow_up, pre_existing_workspace) must
// never reach the screen as-is -- an underscore in visible text reads as leaked
// backend plumbing. Everything rendered from an enum, status, kind, or reason
// column goes through here first.
//
// Acronyms that should stay uppercase are listed rather than title-cased, since
// "Ai Screening" and "Kyc" read worse than the raw value would.
const PRESERVED_UPPERCASE = new Set(["AI", "ID", "KYC", "URL", "API", "PDF", "OTP", "SMS", "CV", "HR"])

export function formatLabel(value, fallback = "") {
  const raw = String(value ?? "").trim()

  if (!raw) {
    return fallback
  }

  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => {
      const upper = word.toUpperCase()
      if (PRESERVED_UPPERCASE.has(upper)) {
        return upper
      }
      return upper.charAt(0) + word.slice(1).toLowerCase()
    })
    .join(" ")
}
