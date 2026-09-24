import Link from 'next/link'
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_EFFECTIVE_DATE_LABEL,
  LEGAL_ENTITY,
} from '@/lib/legal/content'

/**
 * Shared shell for the two public legal pages (/privacy, /terms).
 *
 * Deliberately plain: a server component with no data fetching, no client JS and no new
 * dependencies, so an unauthenticated visitor (or Intuit's fetcher) gets the full document in
 * the first HTML response. Colors come from the app's existing theme tokens, so it reads
 * correctly in both light and dark; the measure is capped for readability and the padding
 * collapses gracefully at phone width.
 */
export function LegalDocument({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-secondary)' }}>
      <div
        className="px-5 py-10 md:px-8 md:py-16 mx-auto"
        style={{ maxWidth: 720, fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif' }}
      >
        <header style={{ marginBottom: 32 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/safety_network_logo.png"
            alt={LEGAL_ENTITY}
            className="h-auto w-[140px] md:w-[168px]"
            style={{ display: 'block', marginBottom: 24 }}
          />
          <h1
            className="text-[26px] md:text-[32px]"
            style={{ color: 'var(--text-primary)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}
          >
            {title}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10 }}>
            Effective <time dateTime={LEGAL_EFFECTIVE_DATE}>{LEGAL_EFFECTIVE_DATE_LABEL}</time>
          </p>
        </header>

        <main>{children}</main>

        <footer
          style={{
            marginTop: 48,
            paddingTop: 20,
            borderTop: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--text-muted)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            justifyContent: 'space-between',
          }}
        >
          <span>© {new Date().getFullYear()} {LEGAL_ENTITY}</span>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <Link href="/privacy" style={{ color: 'var(--text-muted)' }}>Privacy Policy</Link>
            <Link href="/terms" style={{ color: 'var(--text-muted)' }}>Terms &amp; EULA</Link>
            <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} style={{ color: 'var(--text-muted)' }}>
              {LEGAL_CONTACT_EMAIL}
            </a>
          </span>
        </footer>
      </div>
    </div>
  )
}

/** One numbered-free section: a bold lead-in heading and its prose. */
export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <h2
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 8,
          letterSpacing: '-0.01em',
        }}
      >
        {heading}
      </h2>
      <div style={{ fontSize: 14.5, lineHeight: 1.7 }}>{children}</div>
    </section>
  )
}

/** A mailto link styled for body prose. */
export function LegalMail() {
  return (
    <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}>
      {LEGAL_CONTACT_EMAIL}
    </a>
  )
}
