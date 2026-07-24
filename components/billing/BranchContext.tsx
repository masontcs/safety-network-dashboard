'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

/**
 * The active billing branch — the topbar pill picks it, and every list view scopes to
 * it. Empty string = "All branches" (subject to the user's role scope on the server).
 * Persisted in localStorage so the choice survives navigation and reloads.
 */

interface Branch { id: string; name: string; code: string }
interface BranchCtx {
  branchId: string
  setBranchId: (id: string) => void
  branches: Branch[]
  currentLabel: string
  /** '' when all branches, or '?branchId=<id>' — append to list fetches. */
  query: string
}

const Ctx = createContext<BranchCtx | null>(null)
const KEY = 'sn-billing-branch'

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchIdState] = useState<string>('')

  useEffect(() => {
    try { const saved = localStorage.getItem(KEY); if (saved) setBranchIdState(saved) } catch { /* ignore */ }
    fetch('/api/billing/reference').then((r) => r.json())
      .then((j) => { if (j.success) setBranches(j.data.branches) })
      .catch(() => {})
  }, [])

  const setBranchId = useCallback((id: string) => {
    setBranchIdState(id)
    try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY) } catch { /* ignore */ }
  }, [])

  const currentLabel = branchId ? (branches.find((b) => b.id === branchId)?.name ?? 'Branch') : 'All branches'
  const query = branchId ? `?branchId=${branchId}` : ''

  return <Ctx.Provider value={{ branchId, setBranchId, branches, currentLabel, query }}>{children}</Ctx.Provider>
}

export function useBranch(): BranchCtx {
  return useContext(Ctx) ?? { branchId: '', setBranchId: () => {}, branches: [], currentLabel: 'All branches', query: '' }
}
