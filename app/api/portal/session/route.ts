import { NextResponse } from 'next/server'
import { getPortalContext } from '@/lib/api/portal'

// Who am I, and which profiles can I see. Drives the portal shell.
export async function GET(): Promise<NextResponse> {
  const res = await getPortalContext()
  if (!res.ok) return res.response
  const { ctx } = res
  return NextResponse.json({
    success: true,
    data: {
      customerName: ctx.customerName,
      email: ctx.email,
      name: ctx.name,
      role: ctx.role,
      profiles: ctx.profiles,
    },
  })
}
