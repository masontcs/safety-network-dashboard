'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

export default function NavigationProgress() {
  const pathname = usePathname()
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState(false)
  const prevPathname = useRef(pathname)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentWidth = useRef(0)

  // Navigation completed — slam bar to 100% and fade out
  useEffect(() => {
    if (pathname === prevPathname.current) return
    prevPathname.current = pathname
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    setWidth(100)
    const t = setTimeout(() => { setVisible(false); setWidth(0) }, 350)
    return () => clearTimeout(t)
  }, [pathname])

  // Start the bar when any same-origin link to a different page is clicked
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement).closest('a[href]')
      if (!a) return
      const href = a.getAttribute('href') ?? ''
      if (!href || href.startsWith('#') || href.startsWith('mailto:')) return
      try {
        const url = new URL(href, window.location.origin)
        if (url.origin !== window.location.origin) return
        if (url.pathname === window.location.pathname) return
        // Start
        if (tickRef.current) clearInterval(tickRef.current)
        currentWidth.current = 8
        setVisible(true)
        setWidth(8)
        tickRef.current = setInterval(() => {
          currentWidth.current += (90 - currentWidth.current) * 0.1
          setWidth(Math.min(currentWidth.current, 90))
        }, 80)
      } catch { /* ignore */ }
    }
    document.addEventListener('click', handleClick)
    return () => {
      document.removeEventListener('click', handleClick)
      if (tickRef.current) clearInterval(tickRef.current)
    }
  }, [])

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        height: 2,
        width: `${width}%`,
        background: '#ff6b00',
        zIndex: 9999,
        pointerEvents: 'none',
        transition: width >= 100 ? 'width 0.15s ease-out' : 'width 0.08s linear',
        boxShadow: '0 0 8px rgba(255,107,0,0.6)',
      }}
    />
  )
}
