import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { validateEmployeeName } from '@/lib/api/employee-name'
import { apiError } from '@/lib/utils/errors'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json()
    const validationError = validateEmployeeName(body.firstName, body.lastName)
    if (validationError) {
      return NextResponse.json(
        { success: false, error: validationError, code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    const { data: employee, error } = await supabase
      .from('employees')
      .update({
        first_name: (body.firstName as string).trim(),
        last_name: (body.lastName as string).trim(),
        // raw_name_in_report is never touched — it lives on employee_entity_assignments
      })
      .eq('id', params.id)
      .select('id, first_name, last_name')
      .single()

    if (error || !employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found.', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        id: employee.id,
        firstName: employee.first_name,
        lastName: employee.last_name,
        displayName: `${employee.first_name} ${employee.last_name}`.trim(),
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
