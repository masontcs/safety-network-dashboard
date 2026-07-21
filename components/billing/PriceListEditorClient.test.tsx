// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import PriceListEditorClient from './PriceListEditorClient'

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))

const TIERS = [
  { id: 't1', name: 'Tier 1', position: 1, pctOffPrevious: 0 },
  { id: 't2', name: 'Tier 2', position: 2, pctOffPrevious: 10 },
]

const PRICE_LIST = {
  id: 'pl1', name: 'Test List', entityId: 'e1', isActive: true, inUseByProfiles: 0,
  billingTypes: [], tiers: TIERS,
  items: [
    { // by-cadence equipment, no variations
      id: 'pli1', itemId: 'i1', code: 'MSG-BOARD', name: 'Message Board', category: 'Equipment',
      freezeAfterPosition: null, tierExceptionTierId: null, singleRate: false,
      variations: [],
      grids: { '': { bases: { daily: 4500, weekly: 22500 }, overrides: [] } },
    },
    { // single-rate equipment with variations — priced per variation
      id: 'pli2', itemId: 'i2', code: 'CONE-28', name: 'Traffic Cone', category: 'Equipment',
      freezeAfterPosition: null, tierExceptionTierId: null, singleRate: true,
      variations: [{ id: 'v-orange', name: 'Orange' }, { id: 'v-green', name: 'Green' }],
      grids: { 'v-orange': { bases: { flat: 150 }, overrides: [] }, 'v-green': { bases: { flat: 175 }, overrides: [] } },
    },
    { // charge item — flat
      id: 'pli3', itemId: 'i3', code: 'CREW-1', name: '1 Man Crew', category: 'Labor',
      freezeAfterPosition: null, tierExceptionTierId: null, singleRate: false,
      variations: [], grids: { '': { bases: { flat: 5000 }, overrides: [] } },
    },
  ],
  catalog: [],
}

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: true, data: PRICE_LIST }) })) as unknown as typeof fetch
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const open = (code: string) => fireEvent.click(screen.getByText(code))

describe('price-list editor — collapse + single-rate + per-variation grids', () => {
  it('collapses items by default: no rate inputs until you open one', async () => {
    render(<PriceListEditorClient priceListId="pl1" />)
    await waitFor(() => expect(screen.getByText('MSG-BOARD')).toBeTruthy())
    expect(screen.queryByLabelText('MSG-BOARD daily base')).toBeNull() // collapsed
    open('MSG-BOARD')
    expect(screen.getByLabelText('MSG-BOARD daily base')).toBeTruthy()   // opened
  })

  it('shows the three billing types for a by-cadence item when opened', async () => {
    render(<PriceListEditorClient priceListId="pl1" />)
    await waitFor(() => expect(screen.getByText('MSG-BOARD')).toBeTruthy())
    open('MSG-BOARD')
    for (const label of ['Daily', 'Weekly', 'Monthly']) {
      expect(screen.getByText(label), `missing ${label}`).toBeTruthy()
    }
  })

  it('a single-rate item shows one Rate row, not the cadences', async () => {
    render(<PriceListEditorClient priceListId="pl1" />)
    await waitFor(() => expect(screen.getByText('CONE-28')).toBeTruthy())
    open('CONE-28')
    expect(screen.queryByText('Weekly')).toBeNull()
    expect(screen.getByLabelText('CONE-28 Orange rate base')).toBeTruthy()
  })

  it('prices each variation on its own grid', async () => {
    render(<PriceListEditorClient priceListId="pl1" />)
    await waitFor(() => expect(screen.getByText('CONE-28')).toBeTruthy())
    open('CONE-28')
    expect(screen.getByText('Orange')).toBeTruthy()
    expect(screen.getByText('Green')).toBeTruthy()
    const orange = screen.getByLabelText('CONE-28 Orange rate base') as HTMLInputElement
    const green = screen.getByLabelText('CONE-28 Green rate base') as HTMLInputElement
    expect(orange.value).toBe('1.50')
    expect(green.value).toBe('1.75')
  })

  it('offers the single-rate toggle for equipment', async () => {
    render(<PriceListEditorClient priceListId="pl1" />)
    await waitFor(() => expect(screen.getByText('MSG-BOARD')).toBeTruthy())
    open('MSG-BOARD')
    expect(screen.getByText('Single rate')).toBeTruthy()
  })

  it('does not offer single-rate for a charge item (it is inherently flat)', async () => {
    render(<PriceListEditorClient priceListId="pl1" />)
    await waitFor(() => expect(screen.getByText('CREW-1')).toBeTruthy())
    open('CREW-1')
    expect(screen.getByLabelText('CREW-1 rate base')).toBeTruthy()
    expect(screen.queryAllByText('Single rate').length).toBe(0)
  })
})
