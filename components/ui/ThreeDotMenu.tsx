'use client'

import { useState, useRef, useEffect } from 'react'

interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

interface ThreeDotMenuProps {
  items: MenuItem[]
}

export default function ThreeDotMenu({ items }: ThreeDotMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 6px',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          alignItems: 'center',
        }}
        aria-label="More options"
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{ width: 3, height: 3, borderRadius: '50%', background: '#555555' }}
          />
        ))}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: '#2a2a2a',
            border: '1px solid #333333',
            borderRadius: 8,
            minWidth: 140,
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                item.onClick()
                setOpen(false)
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                fontSize: 13,
                color: item.danger ? '#cc4444' : '#cccccc',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = '#333333'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'none'
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
