'use client'

import { useEffect, useRef } from 'react'

const SPACING = 28
const RADIUS = 1
const MIN_OPACITY = 0.05
const MAX_OPACITY = 1.0
const MIN_PERIOD_MS = 2000
const MAX_PERIOD_MS = 4000

interface Dot {
  x: number
  y: number
  phase: number
  speed: number  // radians per ms
}

export default function AnimatedDotGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let dots: Dot[] = []
    let animId: number
    let lastTs: number | null = null

    function buildDots(w: number, h: number) {
      const cols = Math.ceil(w / SPACING) + 1
      const rows = Math.ceil(h / SPACING) + 1
      const next: Dot[] = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const period = MIN_PERIOD_MS + Math.random() * (MAX_PERIOD_MS - MIN_PERIOD_MS)
          next.push({
            x: SPACING / 2 + c * SPACING,
            y: SPACING / 2 + r * SPACING,
            phase: Math.random() * Math.PI * 2,
            speed: (Math.PI * 2) / period,
          })
        }
      }
      dots = next
    }

    function resize() {
      const w = window.innerWidth
      const h = window.innerHeight
      canvas!.width = w
      canvas!.height = h
      buildDots(w, h)
    }

    resize()
    window.addEventListener('resize', resize)

    function draw(ts: number) {
      const dt = lastTs !== null ? ts - lastTs : 0
      lastTs = ts

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)

      for (const dot of dots) {
        dot.phase += dot.speed * dt
        const t = 0.5 + 0.5 * Math.sin(dot.phase)
        const opacity = MIN_OPACITY + t * (MAX_OPACITY - MIN_OPACITY)
        ctx!.beginPath()
        ctx!.arc(dot.x, dot.y, RADIUS, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(30,30,30,${opacity.toFixed(3)})`
        ctx!.fill()
      }

      animId = requestAnimationFrame(draw)
    }

    animId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  )
}
