// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import MoneyInput from './MoneyInput'

afterEach(cleanup)

/**
 * The bug this guards: a controlled money field that reformats cents -> "5.00" on every
 * keystroke overwrites what you're typing. After ONE digit the value snaps to "5.00" and
 * the caret jumps to the end, so you can't type "5.75" or click into the middle to edit.
 * It shipped twice (price-list tiers, then item variation adjustments).
 */
function Harness({ initial = null, allowNegative = false }: { initial?: number | null; allowNegative?: boolean }) {
  const [cents, setCents] = useState<number | null>(initial)
  return (
    <>
      <MoneyInput valueCents={cents} allowNegative={allowNegative} ariaLabel="amount" onChangeCents={setCents} />
      <span data-testid="cents">{cents === null ? 'null' : String(cents)}</span>
    </>
  )
}

const field = () => screen.getByLabelText('amount') as HTMLInputElement
const cents = () => screen.getByTestId('cents').textContent

/** Type a string one character at a time, like a person does. */
function typeChars(text: string) {
  const el = field()
  el.focus()
  fireEvent.focus(el)
  for (const ch of text) fireEvent.change(el, { target: { value: el.value + ch } })
}

describe('MoneyInput — typing is not fought by reformatting', () => {
  it('keeps every digit while typing a multi-digit amount', () => {
    render(<Harness />)
    typeChars('5')
    expect(field().value).toBe('5')       // NOT "5.00" — this is the regression
    typeChars('.75')
    expect(field().value).toBe('5.75')
    expect(cents()).toBe('575')
  })

  it('does not snap an existing value the moment you focus and type', () => {
    render(<Harness initial={1200} />)
    expect(field().value).toBe('12.00')   // formatted while blurred
    const el = field()
    fireEvent.focus(el)
    expect(el.value).toBe('12')           // raw, editable — not "12.00"
    fireEvent.change(el, { target: { value: '125' } })
    expect(el.value).toBe('125')
    expect(cents()).toBe('12500')
  })

  it('formats only on blur', () => {
    render(<Harness />)
    typeChars('7.5')
    expect(field().value).toBe('7.5')
    fireEvent.blur(field())
    expect(field().value).toBe('7.50')
  })

  it('lets you clear the field to nothing', () => {
    render(<Harness initial={500} />)
    const el = field()
    fireEvent.focus(el)
    fireEvent.change(el, { target: { value: '' } })
    expect(cents()).toBe('null')
  })

  it('accepts a negative adjustment, including the lone minus mid-typing', () => {
    render(<Harness allowNegative />)
    const el = field()
    fireEvent.focus(el)
    fireEvent.change(el, { target: { value: '-' } })
    expect(el.value).toBe('-')            // the minus must survive as a draft
    fireEvent.change(el, { target: { value: '-2' } })
    expect(cents()).toBe('-200')
    fireEvent.change(el, { target: { value: '-2.5' } })
    expect(cents()).toBe('-250')
  })

  it('rejects a negative when not allowed (a price is never negative)', () => {
    render(<Harness />)
    const el = field()
    fireEvent.focus(el)
    fireEvent.change(el, { target: { value: '-' } })
    expect(el.value).toBe('')             // shape check blocks it
  })

  it('rejects letters', () => {
    render(<Harness />)
    typeChars('abc')
    expect(field().value).toBe('')
    expect(cents()).toBe('null')
  })
})
