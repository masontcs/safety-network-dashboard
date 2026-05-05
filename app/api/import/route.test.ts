import { describe, it, expect } from 'vitest'
import { NextResponse } from 'next/server'
import { isAdminRole, guardAdminOnly } from '@/lib/api/auth'
import type { Role } from '@/lib/supabase/database.types'

describe('import routes — admin guard (isAdminRole)', () => {
  it('returns true for admin', () => {
    expect(isAdminRole('admin')).toBe(true)
  })

  it('returns false for executive', () => {
    expect(isAdminRole('executive')).toBe(false)
  })

  it('returns false for district_manager', () => {
    expect(isAdminRole('district_manager')).toBe(false)
  })

  it('returns false for branch_manager', () => {
    expect(isAdminRole('branch_manager')).toBe(false)
  })
})

describe('import routes — guardAdminOnly', () => {
  it('returns null for admin (allows through)', () => {
    const result = guardAdminOnly('admin' as Role)
    expect(result).toBeNull()
  })

  it('returns 403 NextResponse for executive', () => {
    const result = guardAdminOnly('executive' as Role)
    expect(result).toBeInstanceOf(NextResponse)
    expect(result?.status).toBe(403)
  })

  it('returns 403 NextResponse for district_manager', () => {
    const result = guardAdminOnly('district_manager' as Role)
    expect(result).toBeInstanceOf(NextResponse)
    expect(result?.status).toBe(403)
  })

  it('returns 403 NextResponse for branch_manager', () => {
    const result = guardAdminOnly('branch_manager' as Role)
    expect(result).toBeInstanceOf(NextResponse)
    expect(result?.status).toBe(403)
  })
})
