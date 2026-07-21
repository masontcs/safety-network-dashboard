// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react'
import PriceListEditorClient from './PriceListEditorClient'

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))

const PRICE_LIST = {
  id: 'pl1', name: 'Test List', entityId: 'e1', isActive: true, inUseByProfiles: 0,
  billingTypes: [],
  tiers: [
    { id: 't1', name: 'Tier 1', position: 1, pctOffPrevious: 0 },
    { id: 't2', name: 'Tier 2', position: 2, pctOffPrevious: 10 },
    { id: 't3', name: 'Tier 3', position: 3, pctOffPrevious: 10 },
  ],
  items: [
    {
      id: 'pli1', itemId: 'i1', code: 'CONE-28', name: 'Traffic Cone', category: 'Equipment',
      freezeAfterPosition: null, tierExceptionTierId: null,
      bases: { daily: 200, weekly_billed_weekly: 1000 },
      overrides: [],
      variations: [{ id: 'v1', name: 'Orange', rateAdjCents: 0 }],
    },
    {
      id: 'pli2', itemId: 'i2', code: 'CREW-1', name: '1 Man Crew', category: 'Labor',
      freezeAfterPosition: null, tierExceptionTierId: null,
      bases: { flat: 5000 }, overrides: [], variations: [],
    },
  ],
  catalog: [],
}

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ json: () => Promise.resolve({ success: true, data: PRICE_LIST }) })
  ) as unknown as typeof fetch
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('price-list editor — per-item equipment blocks', () => {
  it('renders every billing type as its own row for an equipment item', async () => {
    render(<PriceListEditorClient priceListId="pl1" />)
    await waitFor(() => expect(screen.getByText('CONE-28')).toBeTruthy())

    // All six cadences visible for the one item — the whole point: no dropdown gating.
    for (const label of ['Daily', 'Weekly · billed weekly', 'Weekly · billed daily',
      'Monthly · billed monthly', 'Monthly · billed weekly', 'Monthly · billed daily']) {
      expect(screen.getByText(label), `missing ${label}`).toBeTruthy()
    }
  })

  it('shows NO global billing-type switcher (it was the confusing part)', async () => {
    render(<PriceListEditorClient priceListId="pl1" />)
    await waitFor(() => expect(screen.getByText('CONE-28')).toBeTruthy())
    expect(screen.queryByLabelText('Billing type')).toBeNull()
  })

  it("binds each cadence's base to its own value and lets you edit them independently", async () => {
    render(<PriceListEditorClient priceListId="pl1" />)
    await waitFor(() => expect(screen.getByText('CONE-28')).toBeTruthy())

    const daily = screen.getByLabelText('CONE-28 Daily base rate') as HTMLInputElement
    const weekly = screen.getByLabelText('CONE-28 Weekly · billed weekly base rate') as HTMLInputElement
    expect(daily.value).toBe('2.00')
    expect(weekly.value).toBe('10.00')

    // Editing one cadence's base does not disturb another's.
    fireEvent.focus(daily)
    fireEvent.change(daily, { target: { value: '3.50' } })
    expect(screen.getByLabelText('CONE-28 Weekly · billed weekly base rate')).toHaveProperty('value', '10.00')
  })

  it('keeps per-item Freeze after, Tier exception, and Variation adj controls', async () => {
    render(<PriceListEditorClient priceListId="pl1" />)
    await waitFor(() => expect(screen.getByText('CONE-28')).toBeTruthy())
    expect(screen.getByLabelText('CONE-28 freeze after')).toBeTruthy()
    expect(screen.getByLabelText('CONE-28 tier exception')).toBeTruthy()
    expect(screen.getByLabelText('CONE-28 Orange rate adjustment')).toBeTruthy()
  })

  it('still renders charge items in the compact flat-rate grid, not a 6-row block', async () => {
    render(<PriceListEditorClient priceListId="pl1" />)
    await waitFor(() => expect(screen.getByText('CREW-1')).toBeTruthy())
    // A labor item has no cadence rows.
    const crew = screen.getByText('CREW-1').closest('.card') ?? document.body
    expect(within(crew as HTMLElement).queryByText('Daily')).toBeNull()
  })
})
