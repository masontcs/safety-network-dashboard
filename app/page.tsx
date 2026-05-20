import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import AnimatedDotGrid from '@/components/landing/AnimatedDotGrid'

const DASHBOARD_ROUTES: Record<Role, string> = {
  admin:            '/dashboard',
  executive:        '/dashboard',
  district_manager: '/dashboard',
  branch_manager:   '/dashboard',
  ar_manager:       '/ar',
  ar_team:          '/ar',
  office_team:      '/ar',
  project_manager:  '/dashboard',
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
        className="min-h-screen flex flex-col items-center justify-center relative z-[1] px-4 md:px-6 py-8"
        style={{ fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif' }}
      >
        <div className="text-center w-full" style={{ maxWidth: 560 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/safety_network_logo.png"
            alt="Safety Network"
            className="block mx-auto h-auto mb-6 w-[160px] md:w-[240px]"
          />

          <h1
            className="font-extrabold text-white leading-tight mb-4 text-[28px] md:text-[38px]"
            style={{ letterSpacing: '-0.02em' }}
          >
            Operations Management Portal
          </h1>

          <p
            className="text-[14px] md:text-[16px] leading-relaxed mx-auto mb-10"
            style={{ color: '#888888', maxWidth: 420 }}
          >
            Real-time visibility into payroll, revenue, and fuel across all branches
          </p>

          <div className="flex flex-col md:flex-row gap-3 justify-center">
            <Link
              href="/login"
              className="w-full md:w-auto text-center"
              style={{
                background: '#ff6b00',
                color: '#ffffff',
                borderRadius: 8,
                padding: '12px 32px',
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'none',
                display: 'block',
                border: '1px solid #ff6b00',
              }}
            >
              Sign In
            </Link>
            <Link
              href="/request-access"
              className="w-full md:w-auto text-center"
              style={{
                background: 'transparent',
                color: '#ff6b00',
                borderRadius: 8,
                padding: '12px 32px',
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'none',
                display: 'block',
                border: '1px solid #ff6b00',
              }}
            >
              Request Access
            </Link>
          </div>
        </div>

        <div
          className="text-[10px] md:text-[11px]"
          style={{
            position: 'fixed',
            bottom: 24,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: '#555555',
          }}
        >
          © 2026 Safety Network Inc. — Confidential&nbsp;&nbsp;|&nbsp;&nbsp;Internal Use Only
        </div>
      </div>
    </>
  )
}
