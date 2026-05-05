'use client'

type View = 'weekly' | 'mtd' | 'ytd'

interface DateRangePickerProps {
  value: View
  onChange: (view: View) => void
}

const OPTIONS: { value: View; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'mtd', label: 'MTD' },
  { value: 'ytd', label: 'YTD' },
]

export default function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`filter-pill${value === opt.value ? ' filter-pill-active' : ''}`}
          style={{ fontFamily: 'inherit' }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
