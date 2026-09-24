import assert from "node:assert/strict"
import test from "node:test"

import {
  allocateFocusSlots,
  fitAreasToDuration,
  maxFocusAreasForDuration,
  normalizeCoverageWeights,
  validateFocusPlanInput,
} from "@/lib/server/interview-focus/focus-rules"

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0)

test("duration limits: 30 -> 5, 45 -> 6, 60 -> 7 focus areas", () => {
  assert.equal(maxFocusAreasForDuration(30), 5)
  assert.equal(maxFocusAreasForDuration(45), 6)
  assert.equal(maxFocusAreasForDuration(60), 7)
  assert.equal(maxFocusAreasForDuration(null), 5)
})

test("normalise: any raw weights become 5% steps, >=10% each, total 100", () => {
  for (const raw of [[1, 1, 1], [90, 5, 5], [30, 25, 20, 15, 10], [7, 3, 0, 1], [0, 0, 0, 0, 0, 0, 0], [3, 97]]) {
    const weights = normalizeCoverageWeights(raw)
    assert.equal(sum(weights), 100, JSON.stringify(raw))
    for (const weight of weights) {
      assert.ok(weight >= 10 && weight % 5 === 0, `${weight} from ${JSON.stringify(raw)}`)
    }
  }
})

test("normalise: preserves order of importance and is deterministic", () => {
  const weights = normalizeCoverageWeights([40, 30, 20, 10])
  assert.deepEqual(weights, [40, 30, 20, 10])
  assert.deepEqual(normalizeCoverageWeights([1, 1, 1]), normalizeCoverageWeights([1, 1, 1]))
  assert.deepEqual(normalizeCoverageWeights([1, 1, 1]), [35, 35, 30])
})

test("normalise: refuses more areas than 10% floors allow", () => {
  assert.throws(() => normalizeCoverageWeights(new Array(11).fill(1)))
})

const valid = [
  { areaKey: "communication", coverageWeight: 30 },
  { areaKey: "problem_solving", coverageWeight: 30 },
  { areaKey: "custom_x", label: "Classroom behaviour management", description: "Keeping a class on task", coverageWeight: 40 },
]

test("validate: accepts a correct plan and takes library labels from the library", () => {
  const result = validateFocusPlanInput({
    areas: [{ areaKey: "communication", label: "HACKED LABEL", coverageWeight: 50 }, { areaKey: "judgement", coverageWeight: 50 }],
    resumeEmphasis: "STANDARD",
    durationMinutes: 30,
  })
  assert.ok(result.ok)
  assert.equal(result.areas[0].label, "Communication")
  assert.equal(result.areas[0].isCustom, false)
  assert.deepEqual(result.areas.map((a) => a.sortOrder), [1, 2])
})

test("validate: custom competencies get stable, safe keys", () => {
  const result = validateFocusPlanInput({ areas: valid, resumeEmphasis: "LIGHT", durationMinutes: 45 })
  assert.ok(result.ok)
  const custom = result.areas.find((a) => a.isCustom)!
  assert.equal(custom.areaKey, "custom_x", "an existing custom key is kept")
  assert.equal(custom.label, "Classroom behaviour management")

  const fresh = validateFocusPlanInput({
    areas: [{ label: "  Patient   <safety>\u0007 ", coverageWeight: 60 }, { areaKey: "judgement", coverageWeight: 40 }],
    resumeEmphasis: "OFF",
    durationMinutes: 30,
  })
  assert.ok(fresh.ok)
  assert.equal(fresh.areas[0].areaKey, "custom_patient_safety")
  assert.equal(fresh.areas[0].label, "Patient <safety>")
})

test("validate: reports every rule violation instead of fixing numbers", () => {
  const cases: Array<[unknown, RegExp]> = [
    [[{ areaKey: "communication", coverageWeight: 95 }], /total exactly 100/],
    [[{ areaKey: "communication", coverageWeight: 92 }, { areaKey: "judgement", coverageWeight: 8 }], /steps of 5/],
    [[{ areaKey: "communication", coverageWeight: 95 }, { areaKey: "judgement", coverageWeight: 5 }], /at least 10%/],
    [[{ areaKey: "communication", coverageWeight: 50 }, { areaKey: "communication", coverageWeight: 50 }], /more than once/],
    [[{ label: "x", coverageWeight: 100 }], /at least 2 characters/],
    [[], /at least one/],
  ]
  for (const [areas, pattern] of cases) {
    const result = validateFocusPlanInput({ areas, resumeEmphasis: "STANDARD", durationMinutes: 60 })
    assert.equal(result.ok, false)
    assert.match((result as { errors: string[] }).errors.join(" "), pattern)
  }
})

test("validate: enforces the duration limit on number of areas", () => {
  const six = ["communication", "judgement", "ownership", "leadership", "adaptability", "collaboration"].map((areaKey, i) => ({
    areaKey,
    coverageWeight: i < 4 ? 15 : 20,
  }))
  assert.equal(validateFocusPlanInput({ areas: six, resumeEmphasis: "STANDARD", durationMinutes: 30 }).ok, false)
  assert.equal(validateFocusPlanInput({ areas: six, resumeEmphasis: "STANDARD", durationMinutes: 45 }).ok, true)
})

test("validate: rejects unknown resume emphasis", () => {
  const result = validateFocusPlanInput({ areas: valid, resumeEmphasis: "MAXIMUM", durationMinutes: 45 })
  assert.equal(result.ok, false)
})

test("allocate: every area gets a slot when possible, total always matches", () => {
  const areas = [30, 25, 20, 15, 10].map((coverageWeight) => ({ coverageWeight }))
  assert.deepEqual(allocateFocusSlots(areas, 7), [2, 2, 1, 1, 1])
  for (const slots of [5, 6, 7, 8, 10, 12, 13, 15]) {
    const counts = allocateFocusSlots(areas, slots)
    assert.equal(sum(counts), slots)
    assert.ok(counts.every((count) => count >= 1))
    for (let i = 1; i < counts.length; i += 1) {
      assert.ok(counts[i - 1] >= counts[i], `heavier areas never get fewer slots: ${counts}`)
    }
  }
})

test("allocate: fewer slots than areas go to the heaviest areas, deterministically", () => {
  const areas = [15, 40, 15, 30].map((coverageWeight) => ({ coverageWeight }))
  assert.deepEqual(allocateFocusSlots(areas, 2), [0, 1, 0, 1])
  assert.deepEqual(allocateFocusSlots(areas, 3), [1, 1, 0, 1], "tie between equal weights goes to the earlier area")
  assert.deepEqual(allocateFocusSlots(areas, 0), [0, 0, 0, 0])
})

test("fit: a plan saved for 60 minutes is trimmed for a 30 minute interview without mutating it", () => {
  const areas = [10, 20, 15, 10, 20, 10, 15].map((coverageWeight, index) => ({ coverageWeight, sortOrder: index + 1 }))
  const fitted = fitAreasToDuration(areas, 30)
  assert.equal(fitted.length, 5)
  assert.equal(sum(fitted.map((a) => a.coverageWeight)), 100)
  // Weights 20,20,15,15 then the earliest 10 survive, in their original order.
  assert.deepEqual(fitted.map((a) => a.sortOrder), [1, 2, 3, 5, 7])
  assert.equal(areas[0].coverageWeight, 10, "input untouched")
  assert.equal(fitAreasToDuration(areas, 60).length, 7)
})
