'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggle: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark')

  // On mount, read saved preference (the inline script already applied the
  // data-theme attribute before hydration, so no flash)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sn-theme') as Theme | null
      if (saved === 'light' || saved === 'dark') {
        setTheme(saved)
      }
    } catch {
      // localStorage unavailable — stay with default dark
    }
  }, [])

  function toggle() {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem('sn-theme', next)
      } catch { /* ignore */ }
      document.documentElement.setAttribute('data-theme', next)
      return next
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}
