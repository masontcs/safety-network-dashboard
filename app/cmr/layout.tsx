import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Fraunces } from 'next/font/google'
import { CMR_THEME_COOKIE, parseCmrTheme } from '@/lib/cmr/theme'
import './cmr.css'

/**
 * The outer CMR wrapper: design tokens (.cmr-root), the Fraunces display face, and the
 * light/dark preference (a cookie, so the first paint is already right). It deliberately does
 * NOT gate — the gate lives in (secure)/layout.tsx so the access-denied page at
 * /cmr/no-access can render without a redirect loop. Access is still enforced for every
 * other /cmr path by the middleware AND the (secure) layout.
 */

const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-fraunces',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Cash Ledger · Safety Network', template: '%s · Cash Ledger' },
  robots: { index: false, follow: false },
}

export default function CmrRootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseCmrTheme(cookies().get(CMR_THEME_COOKIE)?.value)
  return (
    <div className={`cmr-root ${fraunces.variable}`} data-theme={theme}>
      {children}
    </div>
  )
}
