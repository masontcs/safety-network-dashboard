'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/**
 * App-wide, promise-based confirm/alert dialogs — a themed in-app replacement for the native
 * window.confirm / window.alert (which are unstyled, ignore dark mode, and freeze automation).
 *
 * Usage:
 *   const confirm = useConfirm()
 *   if (!(await confirm({ message: 'Delete this?', danger: true, confirmLabel: 'Delete' }))) return
 *
 *   const alert = useAlert()
 *   await alert('Network error — please try again.')
 *
 * Mounted once at the root (inside ThemeProvider) so every interface — billing, dashboards,
 * tech — gets it. Rendered inline (not portaled) so it inherits the global theme variables.
 */

interface ConfirmOpts { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
interface AlertOpts { title?: string; message: string; okLabel?: string }

interface DialogCtx {
  confirm: (opts: ConfirmOpts | string) => Promise<boolean>
  alert: (opts: AlertOpts | string) => Promise<void>
}

const Ctx = createContext<DialogCtx | null>(null)

export function useConfirm(): DialogCtx['confirm'] {
  const c = useContext(Ctx)
  if (!c) throw new Error('useConfirm must be used within <DialogProvider>')
  return c.confirm
}
export function useAlert(): DialogCtx['alert'] {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAlert must be used within <DialogProvider>')
  return c.alert
}

type Req =
  | { kind: 'confirm'; title?: string; message: string; confirmLabel: string; cancelLabel: string; danger: boolean }
  | { kind: 'alert'; title?: string; message: string; okLabel: string }

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = useState<Req | null>(null)
  const resolver = useRef<((v: unknown) => void) | null>(null)

  const settle = useCallback((value: unknown) => {
    const r = resolver.current
    resolver.current = null
    setReq(null)
    r?.(value)
  }, [])

  const confirm = useCallback((opts: ConfirmOpts | string) => {
    const o = typeof opts === 'string' ? { message: opts } : opts
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve as (v: unknown) => void
      setReq({ kind: 'confirm', title: o.title, message: o.message, confirmLabel: o.confirmLabel ?? 'Confirm', cancelLabel: o.cancelLabel ?? 'Cancel', danger: !!o.danger })
    })
  }, [])

  const alert = useCallback((opts: AlertOpts | string) => {
    const o = typeof opts === 'string' ? { message: opts } : opts
    return new Promise<void>((resolve) => {
      resolver.current = resolve as (v: unknown) => void
      setReq({ kind: 'alert', title: o.title, message: o.message, okLabel: o.okLabel ?? 'OK' })
    })
  }, [])

  // Keyboard: Enter = primary action, Escape = cancel/dismiss.
  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); settle(req.kind === 'confirm' ? false : undefined) }
      else if (e.key === 'Enter') { e.preventDefault(); settle(req.kind === 'confirm' ? true : undefined) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req, settle])

  return (
    <Ctx.Provider value={{ confirm, alert }}>
      {children}
      {req && (
        <div
          role="presentation"
          onClick={() => settle(req.kind === 'confirm' ? false : undefined)}
          style={{
            position: 'fixed', inset: 0, zIndex: 3000, display: 'grid', placeItems: 'center',
            background: 'rgba(0,0,0,.45)', padding: 16,
          }}
        >
          <div
            role={req.kind === 'confirm' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-label={req.title ?? (req.kind === 'confirm' ? 'Confirm' : 'Notice')}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(440px, 100%)', background: 'var(--bg-surface, var(--surface, #fff))',
              color: 'var(--text-primary, #1a1a1e)', border: '1px solid var(--border-emphasis, #e6e7ea)',
              borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,.28)', padding: '20px 22px',
            }}
          >
            {req.title && <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{req.title}</div>}
            <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary, var(--text-primary, #333))', whiteSpace: 'pre-wrap' }}>{req.message}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              {req.kind === 'confirm' && (
                <button
                  type="button"
                  onClick={() => settle(false)}
                  style={{
                    padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    borderRadius: 9, border: '1px solid var(--border-emphasis, #d9dade)',
                    background: 'transparent', color: 'var(--text-primary, #1a1a1e)',
                  }}
                >
                  {req.cancelLabel}
                </button>
              )}
              <button
                type="button"
                autoFocus
                onClick={() => settle(req.kind === 'confirm' ? true : undefined)}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  borderRadius: 9, border: 'none', color: '#fff',
                  background: req.kind === 'confirm' && req.danger ? 'var(--danger, #d33)' : 'var(--accent, #2f6f4f)',
                }}
              >
                {req.kind === 'confirm' ? req.confirmLabel : req.okLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}
