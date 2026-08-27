/**
 * Shift dispatch constants. Job Type is a multiselect from this fixed list; Meal Type is a
 * single choice the dispatcher sets per shift (Standard is the default). Techs must
 * acknowledge the meal type when they accept the shift.
 */

export const JOB_TYPES = [
  'Set & go',
  'Lane Closure',
  'Shoulder Closure',
  'Turn Pocket Closure',
  'Double Lane Closure',
  'Job Meeting',
  'Flagging',
  'Pre Stage',
  'Job Check',
  'CAS',
  'USA',
  'No Parking Signs',
  'Maintain',
  'Road Closure',
  'Deliver Equipment',
  'Pickup Equipment',
  'CalTrans',
] as const

export type JobType = (typeof JOB_TYPES)[number]

export const MEAL_TYPES = [
  { value: 'standard', label: 'Standard Lunch' },
  { value: 'odmp', label: 'Approved ODMP (No Lunch Required)' },
] as const

export type MealType = (typeof MEAL_TYPES)[number]['value']

export const mealTypeLabel = (v: string): string =>
  MEAL_TYPES.find((m) => m.value === v)?.label ?? v
