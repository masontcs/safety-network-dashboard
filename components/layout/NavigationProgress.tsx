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
  // Prevent double-start when both touchstart and click fire for the same tap
  const startedFromTouch = useRef(false)
  const touchOrigin = useRef<{ x: number; y: number } | null>(null)

  // Navigation completed — slam bar to 100% and fade out
  useEffect(() => {
    if (pathname === prevPathname.current) return
    prevPathname.current = pathname
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    setWidth(100)
    const t = setTimeout(() => { setVisible(false); setWidth(0) }, 350)
    return () => clearTimeout(t)
  }, [pathname])

  useEffect(() => {
    function startBar() {
      if (tickRef.current) clearInterval(tickRef.current)
      currentWidth.current = 8
      setVisible(true)
      setWidth(8)
      tickRef.current = setInterval(() => {
        currentWidth.current += (90 - currentWidth.current) * 0.1
        setWidth(Math.min(currentWidth.current, 90))
      }, 80)
    }

    function isSameOriginNavLink(target: EventTarget | null): string | null {
      const a = (target as HTMLElement)?.closest?.('a[href]')
      if (!a) return null
      const href = a.getAttribute('href') ?? ''
      if (!href || href.startsWith('#') || href.startsWith('mailto:')) return null
      try {
        const url = new URL(href, window.location.origin)
        if (url.origin !== window.location.origin) return null
        if (url.pathname === window.location.pathname) return null
        return href
      } catch { return null }
    }

    // touchstart fires the instant the user touches — no 300ms delay
    function handleTouchStart(e: TouchEvent) {
      touchOrigin.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      startedFromTouch.current = false
      if (!isSameOriginNavLink(e.target)) return
      startedFromTouch.current = true
      startBar()
    }

    // Cancel the bar if the user scrolls instead of tapping
    function handleTouchMove(e: TouchEvent) {
      if (!startedFromTouch.current || !touchOrigin.current) return
      const dx = Math.abs(e.touches[0].clientX - touchOrigin.current.x)
      const dy = Math.abs(e.touches[0].clientY - touchOrigin.current.y)
      if (dy > 8 || dx > 8) {
        // User is scrolling — cancel the bar
        startedFromTouch.current = false
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
        setVisible(false)
        setWidth(0)
      }
    }

    // click fires ~300ms after touch on mobile — skip if already started from touch
    function handleClick(e: MouseEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if (startedFromTouch.current) { startedFromTouch.current = false; return }
      if (!isSameOriginNavLink(e.target)) return
      startBar()
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: true })
    document.addEventListener('click', handleClick)
    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
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
