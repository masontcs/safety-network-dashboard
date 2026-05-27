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

// Reads localStorage before first paint so the correct data-theme is applied
// to <html> synchronously — prevents any flash of wrong theme color.
const themeScript = `(function(){try{var t=localStorage.getItem('sn-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.variable}>
        {/* Must be first child — runs sync before any render to set data-theme */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ThemeProvider>
          <NavigationProgress />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
