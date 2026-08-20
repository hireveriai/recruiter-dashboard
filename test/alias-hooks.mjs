import { existsSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

// Resolves the "@/..." path alias from tsconfig.json for `node --test`.
// Node strips TypeScript types natively but does not read tsconfig paths.

const projectRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..")
const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.js"]

export async function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) {
    return next(specifier, context)
  }

  const base = path.join(projectRoot, specifier.slice(2))

  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${base}${suffix}`
    if (suffix !== "" && existsSync(candidate)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true }
    }
  }

  throw new Error(`Cannot resolve path alias "${specifier}" from ${projectRoot}`)
}
