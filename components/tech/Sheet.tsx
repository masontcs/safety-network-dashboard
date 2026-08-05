'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * A bottom sheet. Portals into `.tech-root` (NOT document.body) so it inherits the
 * tech theme's CSS custom properties — portaling to body drops them and the accent
 * buttons render invisible (learned the hard way on the billing modal).
 */
export default function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // Lock background scroll while the sheet is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  if (typeof document === 'undefined') return null
  const host = document.querySelector('.tech-root') ?? document.body

  return createPortal(
    <div className="tech-sheet-overlay" onMouseDown={onClose}>
      <div className="tech-sheet" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="grip" />
        <h2>{title}</h2>
        {children}
      </div>
    </div>,
    host
  )
}
