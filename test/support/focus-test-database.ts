/**
 * Throwaway database for Interview Focus integration tests.
 *
 * Creates a NEW, uniquely named database on the server TEST_DATABASE_URL
 * points at, applies the minimal baseline fixture plus the real 016 and 022
 * migrations, and drops it afterwards. It never touches the database named in
 * TEST_DATABASE_URL itself, so pointing the variable at a shared server is
 * safe. Returns null (tests skip) when TEST_DATABASE_URL is not set.
 *
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres npm run test:unit
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const SQL_FILES = [
  "test/fixtures/interview-focus-baseline.sql",
  "prisma/sql/dev/016_job_questionnaire_architecture.sql",
  "prisma/sql/dev/020_ai_generation_limit.sql",
  "prisma/sql/dev/022_interview_focus_plans.sql",
]

export type FocusTestDatabase = {
  url: string
  pool: pg.Pool
  drop: () => Promise<void>
}

/** Baseline plus migrations for VERIS Live (023) on top of the focus stack. */
export const VERIS_LIVE_SQL_FILES = ["test/fixtures/veris-live-baseline.sql", "prisma/sql/dev/023_veris_live.sql", "prisma/sql/dev/024_veris_live_external_interviewers.sql"]

export async function createFocusTestDatabase(extraSqlFiles: string[] = []): Promise<FocusTestDatabase | null> {
  const adminUrl = process.env.TEST_DATABASE_URL
  if (!adminUrl) return null

  const name = `focus_it_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const admin = new pg.Pool({ connectionString: adminUrl, max: 1 })
  await admin.query(`create database ${name}`)
  await admin.end()

  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 })

  for (const file of [...SQL_FILES, ...extraSqlFiles]) {
    await pool.query(readFileSync(path.join(root, file), "utf8"))
  }

  return {
    url: url.toString(),
    pool,
    drop: async () => {
      await pool.end()
      const cleanup = new pg.Pool({ connectionString: adminUrl, max: 1 })
      await cleanup.query(`drop database if exists ${name} with (force)`)
      await cleanup.end()
    },
  }
}

/** Points the app's Prisma client at the test database. Call before importing services. */
export function useTestDatabaseForPrisma(url: string) {
  for (const key of ["DB_POOL_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"]) {
    delete process.env[key]
  }
  process.env.DATABASE_URL = url
}
