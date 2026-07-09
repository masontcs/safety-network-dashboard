import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

/**
 * Billing-enabled entities (INC / STS / TCS) with their invoice-number letter.
 * An entity without a billing_entity_settings row cannot generate invoice
 * numbers, so it never appears here.
 */

interface Row {
  entity_id: string
  letter: string
  entities: { code: string; name: string } | null
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_entity_settings')
      .select('entity_id, letter, entities(code, name)')
      .eq('billing_enabled', true)
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as unknown as Row[]

    return NextResponse.json({
      success: true,
      data: rows
        .map((r) => ({
          entityId: r.entity_id,
          letter: r.letter,
          code: r.entities?.code ?? '',
          name: r.entities?.name ?? '',
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    })
  } catch (err) {
    return apiError(err)
  }
}
