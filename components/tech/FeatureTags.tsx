import type { Features } from '@/lib/tech/client'

/** The ticket's feature flags as small tags, plus a Lead badge when relevant. */
export default function FeatureTags({ features, isLead }: { features: Features; isLead?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {features.dtc && <span className="tech-tag dtc">DTC</span>}
      {features.add && <span className="tech-tag add">Add</span>}
      {features.return && <span className="tech-tag ret">Return</span>}
      {isLead && <span className="tech-tag lead">Lead</span>}
    </span>
  )
}
