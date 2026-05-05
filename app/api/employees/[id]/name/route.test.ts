import { describe, it, expect } from 'vitest'
import { validateEmployeeName } from '@/lib/api/employee-name'
import { guardAdminOnly } from '@/lib/api/auth'
import { NextResponse } from 'next/server'
import type { Role } from '@/lib/supabase/database.types'

describe('employees/[id]/name — admin-only guard (guardAdminOnly)', () => {
  it('admin is allowed through (returns null)', () => {
    expect(guardAdminOnly('admin' as Role)).toBeNull()
  })

  it('executive is blocked (returns 403)', () => {
    const result = guardAdminOnly('executive' as Role)
    expect(result).toBeInstanceOf(NextResponse)
    expect(result?.status).toBe(403)
  })

  it('district_manager is blocked (returns 403)', () => {
    const result = guardAdminOnly('district_manager' as Role)
    expect(result).toBeInstanceOf(NextResponse)
    expect(result?.status).toBe(403)
  })

  it('branch_manager is blocked (returns 403)', () => {
    const result = guardAdminOnly('branch_manager' as Role)
    expect(result).toBeInstanceOf(NextResponse)
    expect(result?.status).toBe(403)
  })
})

describe('employees/[id]/name — name validation (validateEmployeeName)', () => {
  it('returns null for valid first and last name', () => {
    expect(validateEmployeeName('John', 'Smith')).toBeNull()
  })

  it('returns error when firstName is empty string', () => {
    expect(validateEmployeeName('', 'Smith')).toBeTruthy()
  })

  it('returns error when firstName is whitespace only', () => {
    expect(validateEmployeeName('   ', 'Smith')).toBeTruthy()
  })

  it('returns error when firstName is missing (undefined)', () => {
    expect(validateEmployeeName(undefined, 'Smith')).toBeTruthy()
  })

  it('returns error when firstName is null', () => {
    expect(validateEmployeeName(null, 'Smith')).toBeTruthy()
  })

  it('returns error when lastName is empty string', () => {
    expect(validateEmployeeName('John', '')).toBeTruthy()
  })

  it('returns error when lastName is whitespace only', () => {
    expect(validateEmployeeName('John', '   ')).toBeTruthy()
  })

  it('returns error when lastName is missing (undefined)', () => {
    expect(validateEmployeeName('John', undefined)).toBeTruthy()
  })

  it('returns error when firstName exceeds 100 characters', () => {
    expect(validateEmployeeName('A'.repeat(101), 'Smith')).toBeTruthy()
  })

  it('returns error when lastName exceeds 100 characters', () => {
    expect(validateEmployeeName('John', 'B'.repeat(101))).toBeTruthy()
  })

  it('accepts names at the 100-character limit', () => {
    expect(validateEmployeeName('A'.repeat(100), 'B'.repeat(100))).toBeNull()
  })

  it('returns a string (error message) not a boolean on failure', () => {
    const result = validateEmployeeName('', 'Smith')
    expect(typeof result).toBe('string')
  })

  it('error message for missing firstName mentions "First name"', () => {
    const result = validateEmployeeName('', 'Smith')
    expect(result?.toLowerCase()).toContain('first name')
  })

  it('error message for missing lastName mentions "Last name"', () => {
    const result = validateEmployeeName('John', '')
    expect(result?.toLowerCase()).toContain('last name')
  })
})
