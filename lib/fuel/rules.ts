// WH/Signs transactions are excluded from all SN dashboard queries (business_tag IS NULL only).
export function isSnFuelTransaction(businessTag: string | null): boolean {
  return businessTag === null
}
