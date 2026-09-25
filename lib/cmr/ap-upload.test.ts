import { describe, it, expect, vi } from 'vitest'

// ap-server reaches for the Supabase service client at module scope; this test only exercises
// readApUpload, which never touches the database, so the client is stubbed out.
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))

const { readApUpload } = await import('./ap-server')

/**
 * The CMR A/P upload gate — which file types are allowed to reach the parser at all.
 *
 * Two are, because CMR accounts export from two QuickBooks products: `.xlsx` (Desktop, and QBO's
 * default) and `.csv` (QuickBooks Online's other export of the same A/P Aging Detail report,
 * which is how WHWY's may arrive). The *layout* is decided by the parser from the sheet's own
 * header row — the file name only picks which integrity check applies here.
 */

const ACCOUNT = '0f0e7a2c-1b4d-4c8a-9f3e-2d6b5a7c8e10'

/** A minimal .xlsx: the zip signature is all readApUpload inspects. */
const xlsxBytes = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00])
const csvBytes = () => new TextEncoder().encode(',Date,Transaction type\n,01/05/2026,Bill\n')

function upload(fileName: string, bytes: Uint8Array, accountId: string = ACCOUNT): Request {
  const form = new FormData()
  form.set('accountId', accountId)
  form.set('file', new File([bytes as unknown as BlobPart], fileName))
  return new Request('https://example.test/api/cmr/ap/import/preview', { method: 'POST', body: form })
}

async function refusal(res: Response): Promise<{ status: number; code?: string; error?: string }> {
  const body = (await res.json()) as { code?: string; error?: string }
  return { status: res.status, code: body.code, error: body.error }
}

describe('readApUpload — accepted file types', () => {
  it('accepts an .xlsx', async () => {
    const r = await readApUpload(upload('STS AP 92226.xlsx', xlsxBytes()))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.fileName).toBe('STS AP 92226.xlsx')
    expect(r.value.accountId).toBe(ACCOUNT)
  })

  it('accepts a .csv — QuickBooks Online\'s other export of the same report', async () => {
    const r = await readApUpload(upload('WHWY A_P Aging Detail.csv', csvBytes()))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.fileName).toBe('WHWY A_P Aging Detail.csv')
    expect(r.value.bytes.length).toBeGreaterThan(0)
  })

  it('is case-insensitive about the extension', async () => {
    expect((await readApUpload(upload('REPORT.XLSX', xlsxBytes()))).ok).toBe(true)
    expect((await readApUpload(upload('REPORT.CSV', csvBytes()))).ok).toBe(true)
  })
})

describe('readApUpload — refusals', () => {
  it('refuses any other extension', async () => {
    const r = await readApUpload(upload('report.pdf', xlsxBytes()))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(await refusal(r.response)).toMatchObject({ status: 400, code: 'NOT_XLSX' })
  })

  it('refuses an .xlsx that is not a zip archive', async () => {
    const r = await readApUpload(upload('report.xlsx', csvBytes()))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(await refusal(r.response)).toMatchObject({ status: 400, code: 'NOT_XLSX' })
  })

  it('refuses a workbook merely renamed to .csv', async () => {
    // SheetJS would happily read it, but it is not what the person meant to send.
    const r = await readApUpload(upload('report.csv', xlsxBytes()))
    expect(r.ok).toBe(false)
    if (r.ok) return
    const body = await refusal(r.response)
    expect(body).toMatchObject({ status: 400, code: 'NOT_XLSX' })
    expect(body.error).toMatch(/named \.csv but is an Excel workbook/)
  })

  it('refuses an empty file, whichever extension', async () => {
    for (const name of ['report.xlsx', 'report.csv']) {
      const r = await readApUpload(upload(name, new Uint8Array(0)))
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(await refusal(r.response)).toMatchObject({ status: 400, code: 'NOT_XLSX' })
    }
  })

  it('refuses a missing or malformed account id', async () => {
    const r = await readApUpload(upload('report.csv', csvBytes(), 'not-a-uuid'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect((await refusal(r.response)).status).toBe(400)
  })
})
