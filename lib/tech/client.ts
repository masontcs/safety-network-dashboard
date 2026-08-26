/**
 * Tech app API client — the ONE place that talks to /api/tech/*.
 *
 * Kept deliberately thin and framework-free (plain fetch, relative URLs, typed shapes)
 * so the eventual native app can reuse these types and swap only the transport (base URL
 * + bearer token instead of cookies). The screens never fetch directly — they call these.
 *
 * Money-blind by contract: none of these shapes carry a rate, price, cost or total.
 */

export interface Features { add: boolean; return: boolean; dtc: boolean }

export interface TicketListItem {
  id: string
  ticketNumber: string
  date: string
  isLead: boolean
  features: Features
  job: { number: string; name: string | null } | null
  customer: string | null
  site: string | null
  myHours: number
}

export interface LaborEntry {
  id: string
  technicianId: string
  technicianName: string
  mine: boolean
  activity: string
  startTime: string
  endTime: string
  crossesMidnight: boolean
  hours: number
  enteredOnMyBehalf: boolean
}

export interface EquipmentEntry {
  id: string
  eventType: string | null
  date: string
  qty: number
  equipmentId: string | null
  itemName: string
  itemCode: string
  variation: string | null
}

export interface OnRentItem {
  itemId: string
  variationId: string | null
  itemName: string
  itemCode: string
  variation: string | null
  qty: number
}

export interface TicketDetail {
  id: string
  ticketNumber: string
  date: string
  isLead: boolean
  features: Features
  job: { number: string; name: string | null } | null
  customer: string | null
  site: string | null
  labor: LaborEntry[]
  myHours: number
  equipment: EquipmentEntry[]
  onRent: OnRentItem[]
}

export interface YardShift { id: string; date: string; myHours: number }
export interface ActivityType { id: string; name: string }
export interface TechItem { id: string; code: string; name: string; tracked: boolean; variations: { id: string; name: string }[] }

interface ApiEnvelope<T> { success: boolean; data?: T; error?: string; code?: string }

export class TechApiError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { credentials: 'same-origin', ...init })
  } catch {
    throw new TechApiError('You appear to be offline. Your change was not saved.', 'NETWORK', 0)
  }
  let json: ApiEnvelope<T>
  try {
    json = (await res.json()) as ApiEnvelope<T>
  } catch {
    throw new TechApiError('Unexpected server response.', 'BAD_RESPONSE', res.status)
  }
  if (!res.ok || !json.success) {
    throw new TechApiError(json.error ?? 'Something went wrong.', json.code ?? 'ERROR', res.status)
  }
  return json.data as T
}

const jsonBody = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const techApi = {
  listTickets: () => call<TicketListItem[]>('/api/tech/tickets'),
  getTicket: (id: string) => call<TicketDetail>(`/api/tech/tickets/${id}`),
  listYard: () => call<YardShift[]>('/api/tech/yard'),

  listActivityTypes: () => call<ActivityType[]>('/api/tech/activity-types'),
  listItems: () => call<TechItem[]>('/api/tech/items'),

  addLabor: (id: string, body: { activityTypeId: string; startTime: string; endTime: string; technicianId?: string; notes?: string }) =>
    call<void>(`/api/tech/tickets/${id}/labor`, jsonBody(body)),
  deleteLabor: (id: string, entryId: string) =>
    call<void>(`/api/tech/tickets/${id}/labor?entryId=${encodeURIComponent(entryId)}`, { method: 'DELETE' }),

  addYardTime: (yardShiftId: string, body: { activityTypeId: string; startTime: string; endTime: string; notes?: string }) =>
    call<void>(`/api/tech/yard/${yardShiftId}/time`, jsonBody(body)),
  deleteYardTime: (yardShiftId: string, entryId: string) =>
    call<void>(`/api/tech/yard/${yardShiftId}/time?entryId=${encodeURIComponent(entryId)}`, { method: 'DELETE' }),

  addEquipment: (id: string, body: { itemId: string; variationId?: string | null; qty: number; eventType?: string; equipmentId?: string | null }) =>
    call<void>(`/api/tech/tickets/${id}/equipment`, jsonBody(body)),
  deleteEquipment: (id: string, entryId: string) =>
    call<void>(`/api/tech/tickets/${id}/equipment?entryId=${encodeURIComponent(entryId)}`, { method: 'DELETE' }),

  submit: (id: string) => call<void>(`/api/tech/tickets/${id}/submit`, { method: 'POST' }),
}
