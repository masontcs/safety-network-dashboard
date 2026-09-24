import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * A guard on the shipped wh_access migration. The file in this repo IS the SQL applied to the
 * live database with the sanctioned flow (`supabase db push`, via apply-wh-access-migration
 * .command, whose md5 gate refuses to apply anything else). Editing an applied migration is what
 * caused the 2026-09-10 drift, so this pins its md5 and re-asserts the rules the app depends on.
 * To change the schema, add a NEW migration — don't touch this file.
 *
 * Its behaviour was run against a scratch PostgreSQL 16 before shipping: the four display names
 * seed to four rows with granted_by null, RLS is on with no policies, anon and authenticated are
 * refused outright ("permission denied for table wh_access"), deleting a profile removes its
 * grant and clears granted_by elsewhere, and a name matching no profile raises a WARNING naming
 * the people who were NOT granted.
 */

const DIR = path.join(process.cwd(), 'supabase', 'migrations')
const MD5 = 'c99aa7a182cf6003d496c26698493f8b'
const NAME = 'wh_access'
const SEEDS = ['Mason Doty', 'Jordan Johnson', 'Russ Johnson', 'Paula Lofgren']

const files = readdirSync(DIR).filter((f) => f.endsWith(`_${NAME}.sql`))
const sql = files.length === 1 ? readFileSync(path.join(DIR, files[0]), 'utf8') : ''

describe('wh_access migration', () => {
  it('is exactly one file, at a single applied version, byte-identical to what was verified', () => {
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(new RegExp(`^\\d{14}_${NAME}\\.sql$`))
    expect(createHash('md5').update(readFileSync(path.join(DIR, files[0]))).digest('hex')).toBe(MD5)
  })

  it('sorts after WH Phase 1 (the A/R + A/P tables it gates)', () => {
    const phase1 = readdirSync(DIR).filter((f) => f.endsWith('_wh_ar_ap.sql'))
    expect(phase1).toHaveLength(1)
    expect(files[0] > phase1[0]).toBe(true)
  })

  it('keeps the service-role-only posture: RLS on, no policies, anon+authenticated revoked', () => {
    expect(sql).toContain('alter table public.wh_access enable row level security;')
    expect(sql).toContain('revoke all on table public.wh_access from anon, authenticated;')
    expect(sql).not.toMatch(/create policy/i)
    expect(sql).not.toMatch(/grant .* on table public\.wh_access/i)
  })

  it('has the columns the phase specified, keyed one row per person', () => {
    expect(sql).toContain('user_id    uuid primary key references public.user_profiles(id) on delete cascade')
    expect(sql).toContain('granted_by uuid references public.user_profiles(id) on delete set null')
    expect(sql).toContain('granted_at timestamptz not null default now()')
    // No role column: a row is the whole permission (view + upload).
    expect(sql).not.toMatch(/^\s*role\s/m)
  })

  it('indexes the granted_by foreign key', () => {
    expect(sql).toContain('create index wh_access_granted_by_idx on public.wh_access (granted_by);')
  })

  it('seeds exactly the four people, by display_name, idempotently', () => {
    const insert = /insert into public\.wh_access[\s\S]*?on conflict do nothing;/.exec(sql)?.[0] ?? ''
    expect(insert).toBeTruthy()
    for (const name of SEEDS) expect(insert).toContain(`'${name}'`)
    expect(insert).toContain('from public.user_profiles')
    expect(insert).toContain('on conflict do nothing')
    // Exactly four names, so a fifth person can't be slipped into the seed unnoticed.
    expect(insert.match(/'[^']+ [^']+'/g)).toHaveLength(4)
  })

  it('says so loudly if one of the four matched no profile', () => {
    expect(sql).toMatch(/raise warning 'wh_access seed: NO user_profiles row matched/)
    for (const name of SEEDS) expect(sql).toContain(`'${name}'`)
  })

  it('creates only wh_access and touches nothing else', () => {
    expect(sql).not.toMatch(/^\s*insert\s+into\s+public\.(?!wh_access)/im)
    expect(sql).not.toMatch(/alter table public\.(?!wh_access)/i)
    // No DROP statement (the word itself appears in a comment about dropping privileges).
    expect(sql).not.toMatch(/^\s*drop\s/im)
    expect(sql).not.toMatch(/create table public\.(?!wh_access)/i)
    // No WH A/R or A/P data is read or changed by the access migration.
    expect(sql).not.toMatch(/wh_(ar|ap)_(imports|lines)/)
  })
})
