import { cache } from 'react'
import { getCmrContext } from '@/lib/api/cmr'

/**
 * getCmrContext memoised for ONE server render, so the nested /cmr layouts and pages share a
 * single grant lookup per request. Server components only — API routes call getCmrContext
 * directly (a fresh check on every request).
 */
export const getCmrPageContext = cache(getCmrContext)
