import { NextResponse } from 'next/server'

export type ParseResult<T> =
  | { success: true; data: T; warnings: string[] }
  | { success: false; error: string; warnings: string[] }

export class AppError extends Error {
  constructor(
    public override message: string,
    public code: string,
    public status: number,
    public detail?: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ParseError extends AppError {
  constructor(detail: string) {
    super(
      'The file could not be parsed. Please check the format and try again.',
      'PARSE_ERROR',
      400,
      detail
    )
  }
}

export class AuthError extends AppError {
  constructor() {
    super('You are not authorized to perform this action.', 'UNAUTHORIZED', 403)
  }
}

export class DuplicateImportError extends AppError {
  constructor(public conflictData: { entityCode?: string; periodDate: string; importId: string }) {
    super('An import already exists for this period.', 'DUPLICATE_IMPORT', 409)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found.`, 'NOT_FOUND', 404)
  }
}

// Wrap API route handlers — log detail server-side, return safe message to client
export function apiError(error: unknown): NextResponse {
  console.error('[API Error]', error)

  if (error instanceof DuplicateImportError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code, conflict: error.conflictData },
      { status: 409 }
    )
  }

  if (error instanceof AppError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.status }
    )
  }

  return NextResponse.json(
    { success: false, error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' },
    { status: 500 }
  )
}
