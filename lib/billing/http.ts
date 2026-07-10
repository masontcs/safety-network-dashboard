import { NextResponse } from 'next/server'
import { AppError } from '@/lib/utils/errors'

/**
 * Error responder for the billing routes.
 *
 * The shared `apiError` masks every non-AppError as "An unexpected error
 * occurred" (safe default for public-facing routes). Billing is an internal,
 * admin-only tool, so here we surface the real message — it makes testing and
 * debugging far faster and leaks nothing a public user could see.
 */
export function billingApiError(error: unknown): NextResponse {
  console.error('[Billing API Error]', error)

  if (error instanceof AppError) {
    return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status })
  }

  const message = error instanceof Error && error.message ? error.message : 'An unexpected error occurred.'
  return NextResponse.json({ success: false, error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
}
