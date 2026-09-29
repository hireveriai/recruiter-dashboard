/**
 * Throwaway database for Employee / Department / Project / assessment
 * targeting integration tests. Same approach as focus-test-database.ts:
 * creates a NEW uniquely named database on the server TEST_DATABASE_URL
 * points at, replays the baseline plus the real employee migrations in
 * order, and drops it afterwards. Returns null (tests skip) when
 * TEST_DATABASE_URL is not set.
 *
 *   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=postgres --name hv-test postgres:17
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres npm run test:unit
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

export const EMPLOYEE_BASELINE_SQL = [
  "test/fixtures/employee-targeting-baseline.sql",
  "db/migrations/20260916_employee_activities.sql",
  "db/migrations/20260917_employee_activity_job_optional.sql",
]
export const EMPLOYEE_TARGETING_MIGRATION = "db/migrations/20260929_employee_departments_projects_targeting.sql"
export const EMPLOYEE_TARGETING_ROLLBACK = "db/migrations/20260929_employee_departments_projects_targeting_rollback.sql"

export type EmployeeTestDatabase = {
  url: string
  pool: pg.Pool
  runSqlFile: (file: string) => Promise<void>
  drop: () => Promise<void>
}

export async function createEmployeeTestDatabase(
  sqlFiles: string[] = [...EMPLOYEE_BASELINE_SQL, EMPLOYEE_TARGETING_MIGRATION]
): Promise<EmployeeTestDatabase | null> {
  const adminUrl = process.env.TEST_DATABASE_URL
  if (!adminUrl) return null

  const name = `employee_it_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const admin = new pg.Pool({ connectionString: adminUrl, max: 1 })
  await admin.query(`create database ${name}`)
  await admin.end()

  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 })
  // A dedicated single-connection pool per file, so a failing migration's
  // aborted transaction is rolled back on its own connection instead of
  // leaking into the shared pool.
  const runSqlFile = async (file: string) => {
    const single = new pg.Pool({ connectionString: url.toString(), max: 1 })
    try {
      await single.query(readFileSync(path.join(root, file), "utf8"))
    } catch (error) {
      await single.query("rollback").catch(() => {})
      throw error
    } finally {
      await single.end()
    }
  }

  for (const file of sqlFiles) {
    await runSqlFile(file)
  }

  return {
    url: url.toString(),
    pool,
    runSqlFile,
    drop: async () => {
      await pool.end()
      const cleanup = new pg.Pool({ connectionString: adminUrl, max: 1 })
      await cleanup.query(`drop database if exists ${name} with (force)`)
      await cleanup.end()
    },
  }
}
