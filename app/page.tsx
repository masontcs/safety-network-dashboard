import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import AnimatedDotGrid from '@/components/landing/AnimatedDotGrid'

const DASHBOARD_ROUTES: Record<Role, string> = {
  admin:            '/admin',
  executive:        '/executive',
  district_manager: '/district',
  branch_manager:   '/manager',
}

export default async function RootPage() {
  const supabase = createServerClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (session) {
    const { data } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', session.user.id)
      .single()
    const profile = data as { role: Role } | null
    if (profile) redirect(DASHBOARD_ROUTES[profile.role])
    redirect('/login')
  }

  return (
    <>
      <AnimatedDotGrid />
      <div
        style={{
          minHeight: '100vh',
          background: '#111111',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          zIndex: 1,
          fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif',
          padding: '0 24px',
        }}
      >
      <div style={{ textAlign: 'center', maxWidth: 560 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/safety_network_logo.png"
          alt="Safety Network"
          style={{ display: 'block', width: 240, height: 'auto', margin: '0 auto 24px' }}
        />

        <h1
          style={{
            fontSize: 38,
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: '0 0 16px',
          }}
        >
          Operations Management Portal
        </h1>

        <p
          style={{
            fontSize: 16,
            color: '#888888',
            lineHeight: 1.6,
            margin: '0 auto 40px',
            maxWidth: 420,
          }}
        >
          Real-time visibility into payroll, revenue, and fuel across all branches
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/login"
            style={{
              background: '#ff6b00',
              color: '#ffffff',
              borderRadius: 8,
              padding: '12px 32px',
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
              display: 'inline-block',
              border: '1px solid #ff6b00',
            }}
          >
            Sign In
          </Link>
          <Link
            href="/request-access"
            style={{
              background: 'transparent',
              color: '#ff6b00',
              borderRadius: 8,
              padding: '12px 32px',
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
              display: 'inline-block',
              border: '1px solid #ff6b00',
            }}
          >
            Request Access
          </Link>
        </div>
      </div>

      <div
        style={{
          position: 'fixed',
          bottom: 24,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 11,
          color: '#555555',
        }}
      >
        © 2026 Safety Network Inc. — Confidential&nbsp;&nbsp;|&nbsp;&nbsp;Internal Use Only
      </div>
    </div>
    </>
  )
}
