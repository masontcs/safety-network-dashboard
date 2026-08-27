import type { createServiceClient } from '@/lib/supabase/server'

type Svc = ReturnType<typeof createServiceClient>

/**
 * Replace a shift's job types / timeline / crew. Passing `undefined` for a section leaves it
 * untouched; passing an array replaces it wholesale (delete + insert). Used on create + PATCH.
 * Enforces exactly one lead: honors the flagged lead, else promotes the first tech.
 */
export async function writeShiftChildren(
  supabase: Svc,
  shiftId: string,
  jobTypes: string[] | undefined,
  timeline: { atTime: string; activityTypeId: string }[] | undefined,
  crew: { technicianId: string; isLead?: boolean }[] | undefined,
): Promise<void> {
  if (jobTypes) {
    await supabase.from('billing_shift_job_types').delete().eq('shift_id', shiftId)
    if (jobTypes.length) {
      const { error } = await supabase.from('billing_shift_job_types').insert(jobTypes.map((job_type) => ({ shift_id: shiftId, job_type })))
      if (error) throw new Error(error.message)
    }
  }
  if (timeline) {
    await supabase.from('billing_shift_timeline').delete().eq('shift_id', shiftId)
    if (timeline.length) {
      const { error } = await supabase.from('billing_shift_timeline').insert(
        timeline.map((t, i) => ({ shift_id: shiftId, sort_order: i, at_time: t.atTime, activity_type_id: t.activityTypeId })),
      )
      if (error) throw new Error(error.message)
    }
  }
  if (crew) {
    await supabase.from('billing_shift_crew').delete().eq('shift_id', shiftId)
    const cleaned = crew.filter((c) => c.technicianId)
    let leadSet = cleaned.some((c) => c.isLead)
    if (cleaned.length) {
      const { error } = await supabase.from('billing_shift_crew').insert(cleaned.map((c, i) => {
        const isLead = c.isLead ? true : (!leadSet && i === 0)
        if (isLead) leadSet = true
        return { shift_id: shiftId, technician_id: c.technicianId, is_lead: isLead }
      }))
      if (error) throw new Error(error.message)
    }
  }
}
