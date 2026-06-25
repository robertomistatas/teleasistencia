/**
 * Supabase PostgreSQL Smoke Probe — Standalone validation script
 * Sprint 1 deliverable per Implementation Plan v1.1 §9
 *
 * Validates Supabase PostgreSQL connectivity and runtime assumptions.
 * Does NOT run as part of the daemon.
 *
 * Usage: npm run smoke:pg
 *
 * Requires: SUPABASE_DB_URL (and other env vars for config loading)
 */

import pg from 'pg'
import { loadConfig } from '../src/config/config.js'

interface ProbeResult {
  check: string
  status: 'PASS' | 'FAIL'
  detail?: unknown
  error?: string
}

const results: ProbeResult[] = []

function record(check: string, status: 'PASS' | 'FAIL', detail?: unknown, error?: string): void {
  results.push({ check, status, detail, error })
  const line = JSON.stringify({ ts: new Date().toISOString(), check, status, detail, error })
  process.stdout.write(line + '\n')
}

async function run(): Promise<void> {
  let config
  try {
    config = loadConfig()
  } catch {
    record('config', 'FAIL', undefined, 'Failed to load configuration — check env vars')
    return
  }

  const pool = new pg.Pool({
    connectionString: config.supabaseDbUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
    ssl: config.supabaseDbUrl.includes('sslmode=')
      ? undefined
      : { rejectUnauthorized: true },
  })

  try {
    // 0. Set statement_timeout — simulates the Connection Initialization Barrier
    await pool.query(`SET statement_timeout = '30000'`)

    // 1. SELECT 1
    try {
      await pool.query('SELECT 1 AS alive')
      record('select_1', 'PASS')
    } catch (err) {
      record('select_1', 'FAIL', undefined, err instanceof Error ? err.message : String(err))
      return
    }

    // 2. version()
    try {
      const res = await pool.query('SELECT version() AS v')
      record('version', 'PASS', { version: res.rows[0]?.v })
    } catch (err) {
      record('version', 'FAIL', undefined, err instanceof Error ? err.message : String(err))
    }

    // 3. current_user
    try {
      const res = await pool.query('SELECT current_user AS u')
      record('current_user', 'PASS', { user: res.rows[0]?.u })
    } catch (err) {
      record('current_user', 'FAIL', undefined, err instanceof Error ? err.message : String(err))
    }

    // 4. search_path
    try {
      const res = await pool.query('SHOW search_path')
      record('search_path', 'PASS', { search_path: res.rows[0]?.search_path })
    } catch (err) {
      record('search_path', 'FAIL', undefined, err instanceof Error ? err.message : String(err))
    }

    // 5. statement_timeout — must match runtime contract (30s)
    try {
      const res = await pool.query('SHOW statement_timeout')
      const value = res.rows[0]?.statement_timeout as string | undefined
      const expected = '30s'
      if (value === expected) {
        record('statement_timeout', 'PASS', { statement_timeout: value, expected })
      } else {
        record('statement_timeout', 'FAIL', { statement_timeout: value, expected },
          `statement_timeout is '${value}', expected '${expected}'`)
      }
    } catch (err) {
      record('statement_timeout', 'FAIL', undefined, err instanceof Error ? err.message : String(err))
    }
  } finally {
    await pool.end()
  }
}

run()
  .then(() => {
    const failed = results.filter((r) => r.status === 'FAIL').length
    const passed = results.filter((r) => r.status === 'PASS').length
    const summary = JSON.stringify({
      ts: new Date().toISOString(),
      summary: true,
      total: results.length,
      passed,
      failed,
      status: failed === 0 ? 'ALL_PASS' : 'HAS_FAILURES',
    })
    process.stdout.write(summary + '\n')
    process.exit(failed > 0 ? 1 : 0)
  })
  .catch((err) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      check: 'probe_fatal',
      status: 'FAIL',
      error: err instanceof Error ? err.message : String(err),
    })
    process.stdout.write(line + '\n')
    process.exit(1)
  })
