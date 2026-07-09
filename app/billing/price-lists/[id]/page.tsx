import PriceListEditorClient from '@/components/billing/PriceListEditorClient'

// Auth, role gate and shell live in app/billing/layout.tsx.
export default function PriceListEditorPage({ params }: { params: { id: string } }) {
  return <PriceListEditorClient priceListId={params.id} />
}
