export function validateEmployeeName(
  firstName: unknown,
  lastName: unknown
): string | null {
  if (typeof firstName !== 'string' || !firstName.trim()) return 'First name is required'
  if (typeof lastName !== 'string' || !lastName.trim()) return 'Last name is required'
  if (firstName.length > 100) return 'First name is too long (max 100 characters)'
  if (lastName.length > 100) return 'Last name is too long (max 100 characters)'
  return null
}
