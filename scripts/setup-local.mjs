#!/usr/bin/env node
// One-command local bootstrap for Calyflow. Run with `npm run setup`.
//
// It is idempotent — safe to re-run any time. Steps:
//   1. verify prerequisites (Supabase CLI + a running Docker daemon)
//   2. boot the local Supabase stack (this also applies every migration)
//   3. write/refresh .env.local wired to that local stack (keys auto-injected)
//   4. seed the workflow library + model catalog
//
// The local Supabase keys come straight from `supabase status`, so you never
// have to copy/paste anything. Cloud credentials are never touched.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envLocal = join(root, '.env.local')
const envExample = join(root, '.env.example')

const log = (m = '') => console.log(m)
const die = (m) => {
  console.error(`\n✖  ${m}\n`)
  process.exit(1)
}

// Run a command, streaming its output. Returns the exit status.
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts })
}
// Run a command quietly and return { ok, stdout }.
function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: root, ...opts })
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// ── 1. Prerequisites ────────────────────────────────────────────────────────
log('▶  Checking prerequisites…')

if (!capture('supabase', ['--version']).ok) {
  die(
    'Supabase CLI not found.\n' +
      '  Install it with one of:\n' +
      '    brew install supabase/tap/supabase      (macOS / Linux, recommended)\n' +
      '    npm install -g supabase                  (any platform)\n' +
      '  Docs: https://supabase.com/docs/guides/local-development',
  )
}

if (!capture('docker', ['info']).ok) {
  // Docker CLI may exist but the daemon is down. Try to bring up Colima
  // automatically (the common macOS setup) before giving up.
  if (capture('colima', ['version']).ok) {
    log('  Docker daemon not running — starting Colima…')
    if (run('colima', ['start']).status !== 0) {
      die('Could not start Colima. Start your Docker engine, then re-run `npm run setup`.')
    }
  } else {
    die(
      'Docker engine is not running.\n' +
        '  Start Docker Desktop, OR install Colima (`brew install colima` then `colima start`),\n' +
        '  then re-run `npm run setup`.',
    )
  }
}
log('  ✓ Supabase CLI + Docker ready')

// ── 2. Boot the local Supabase stack (applies migrations) ───────────────────
log('\n▶  Starting local Supabase (first run pulls images — may take a few minutes)…')
if (run('supabase', ['start']).status !== 0) {
  die('`supabase start` failed. Scroll up for the error, fix it, then re-run `npm run setup`.')
}

// ── 3. Wire up .env.local with the local stack's keys ───────────────────────
log('\n▶  Writing .env.local…')

const status = capture('supabase', ['status', '-o', 'env'])
if (!status.ok) die('Could not read `supabase status`. Is the stack running?')

const sb = {}
for (const line of status.stdout.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) sb[m[1]] = m[2].replace(/^"|"$/g, '') // strip surrounding quotes
}
const need = (k) => sb[k] || die(`Supabase status did not report ${k}.`)
const apiUrl = need('API_URL')
const anonKey = need('ANON_KEY')
const serviceKey = need('SERVICE_ROLE_KEY')

if (!existsSync(envLocal)) {
  copyFileSync(envExample, envLocal)
  log('  Created .env.local from .env.example')
}

let env = readFileSync(envLocal, 'utf8')

// Replace an existing `KEY=...` line, or append it if absent.
function upsert(key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm')
  if (re.test(env)) env = env.replace(re, `${key}=${value}`)
  else env += `${env.endsWith('\n') ? '' : '\n'}${key}=${value}\n`
}
// Current value of a key, or '' if unset.
function valueOf(key) {
  const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1] : ''
}

upsert('SUPABASE_URL', apiUrl)
upsert('NEXT_PUBLIC_SUPABASE_ANON_KEY', anonKey)
upsert('SUPABASE_SERVICE_ROLE_KEY', serviceKey)

// Generate a real encryption key the first time (placeholder or empty).
const enc = valueOf('APP_ENCRYPTION_KEY')
if (!enc || enc.startsWith('change-me')) {
  upsert('APP_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
  log('  Generated a fresh APP_ENCRYPTION_KEY')
}

writeFileSync(envLocal, env)
log('  ✓ .env.local points at the local Supabase stack')

// ── 4. Seed the workflow library + model catalog ────────────────────────────
log('\n▶  Seeding the workflow library + model catalog…')
const seedEnv = { ...process.env, SUPABASE_URL: apiUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey }
if (run('npm', ['run', 'seed'], { env: seedEnv }).status !== 0) {
  log('  ⚠  Seeding failed — you can retry later with `npm run seed`.')
} else {
  log('  ✓ Library seeded')
}

// ── Done ────────────────────────────────────────────────────────────────────
const admin = valueOf('ADMIN_EMAILS') || 'you@example.com'
log('\n✔  Setup complete!\n')
log('  Next:  npm run dev      then open http://localhost:3000')
log(`  Sign in with any email (e.g. ${admin}) — single-workspace mode, no password.\n`)
log('  Handy:')
log('    Supabase Studio (browse the DB):  http://127.0.0.1:54323')
log('    Mailpit (catches outgoing email): http://127.0.0.1:54324')
log('    Stop the stack when done:         npm run db:stop\n')
