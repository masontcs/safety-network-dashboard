import CmrIcon from '@/components/cmr/CmrIcon'
import type { CmrNavIcon } from '@/lib/cmr/roles'

/**
 * Phase 0 placeholder for a CMR view that isn't built yet. Understated on purpose: a page
 * head in the display serif, and one quiet card saying what's coming.
 */
export default function ComingSoon({
  title,
  intro,
  icon,
  what,
  phase,
  aside,
}: {
  title: string
  intro: string
  icon: CmrNavIcon
  what: string
  phase: string
  aside?: React.ReactNode
}) {
  return (
    <>
      <header className="cmr-pagehead">
        <div>
          <h1 className="cmr-serif">{title}</h1>
          <p>{intro}</p>
        </div>
        {aside && <div className="actions">{aside}</div>}
      </header>
      <section className="cmr-card" aria-labelledby="cmr-soon-title">
        <div className="cmr-empty">
          <div className="ring"><CmrIcon name={icon} /></div>
          <h2 id="cmr-soon-title" className="cmr-serif">Coming soon</h2>
          <p>{what}</p>
          <span className="cmr-pill phase"><span className="pd" aria-hidden="true" /> {phase}</span>
        </div>
      </section>
    </>
  )
}
