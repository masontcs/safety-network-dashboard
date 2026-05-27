import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import NavigationProgress from '@/components/layout/NavigationProgress'
import { ThemeProvider } from '@/lib/theme/ThemeContext'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'Safety Network Operations',
  description: 'Internal operations dashboard',
  robots: { index: false, follow: false },
}

// Inline script runs synchronously before first paint to prevent FOUC.
// It reads localStorage and sets data-theme on <html> before React hydrates.
const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('sn-theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch(e) {}
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* eslint-disable-next-line @next/next/no-before-interactive-script-outside-document */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={inter.variable}>
        <ThemeProvider>
          <NavigationProgress />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
