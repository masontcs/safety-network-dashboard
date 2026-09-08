import { describe, it, expect } from 'vitest'
import { qbMoney, qbDate, linesToSplits, buildInvoiceIif, type QbKindMap, type QbConfig } from './quickbooksIif'

const KIND_MAP: QbKindMap = {
  rental: { account: 'REVENUE - SERVICES:SERV-EQUIPMENT USED', item: 'EQUIPMENT RENTAL', memo: 'EQUIPMENT RENTAL' },
  labor: { account: 'REVENUE - SERVICES:SERV-LABOR EMPLOYED', item: 'LABOR - TRAFFIC CONTROL', memo: 'LABOR - TRAFFIC CONTROL' },
  other: { account: 'REVENUE - SERVICES:SERV-OTHER-MISC', item: 'TRAFF CONTROL PLANS', memo: 'TRAFFIC CONTROL PLAN' },
}
const CFG: QbConfig = { arAccount: 'ACCOUNTS RECEIVABLE', taxAccount: 'Sales Tax Payable', taxZeroMemo: 'NO TAX', taxExtra: 'AUTOSTAX' }

describe('qbMoney', () => {
  it('formats with grouped thousands and 2 decimals', () => {
    expect(qbMoney(306000)).toBe('3,060.00')
    expect(qbMoney(143234)).toBe('1,432.34')
    expect(qbMoney(-139370)).toBe('-1,393.70')
    expect(qbMoney(0)).toBe('0.00')
    expect(qbMoney(1197500)).toBe('11,975.00')
  })
})

describe('qbDate', () => {
  it('renders M/D/YYYY with no leading zeros', () => {
    expect(qbDate('2026-04-04')).toBe('4/4/2026')
    expect(qbDate('2026-03-31')).toBe('3/31/2026')
    expect(qbDate('2026-12-09')).toBe('12/9/2026')
  })
})

describe('linesToSplits', () => {
  it('groups by account, sums, orders rental before labor', () => {
    const splits = linesToSplits(
      [{ kind: 'labor', amountCents: 139370 }, { kind: 'rental', amountCents: 2000 }, { kind: 'rental', amountCents: 1864 }],
      KIND_MAP, ':TCS-VI',
    )
    expect(splits.map((s) => s.item)).toEqual(['EQUIPMENT RENTAL', 'LABOR - TRAFFIC CONTROL'])
    expect(splits[0].amountCents).toBe(3864) // two rental lines summed
    expect(splits[1].amountCents).toBe(139370)
    expect(splits[0].klass).toBe(':TCS-VI')
  })
  it('routes unmapped kinds to the other bucket', () => {
    const splits = linesToSplits([{ kind: 'misc', amountCents: 500 }, { kind: 'lump_sum', amountCents: 700 }], KIND_MAP, '')
    expect(splits).toHaveLength(1)
    expect(splits[0].account).toBe('REVENUE - SERVICES:SERV-OTHER-MISC')
    expect(splits[0].amountCents).toBe(1200)
  })
  it('skips zero-amount lines', () => {
    expect(linesToSplits([{ kind: 'rental', amountCents: 0 }], KIND_MAP, '')).toHaveLength(0)
  })
})

describe('buildInvoiceIif', () => {
  const splits = linesToSplits([{ kind: 'rental', amountCents: 3864 }, { kind: 'labor', amountCents: 139370 }], KIND_MAP, ':TCS-VI')
  const iif = buildInvoiceIif([{
    docNum: '00105035', date: '2026-04-04', dueDate: '2026-05-04',
    customerName: 'FARWEST CORROSION CONTROL COMPANY', memo: '1485 Beulah St', poNum: 'B6673',
    nameIsTaxable: true, taxCents: 0, splits,
  }], CFG)
  const rows = iif.split('\r\n')

  it('is CRLF-terminated with a trailing newline', () => {
    expect(iif.endsWith('\r\n')).toBe(true)
    expect(rows[rows.length - 1]).toBe('') // trailing empty from final CRLF
  })

  it('emits the three IIF header rows', () => {
    expect(rows[0]).toBe('!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO\tDUEDATE\tADDR1\tPONUM\tNAMEISTAXABLE')
    expect(rows[1]).toBe('!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO\tEXTRA\tINVITEM\tTAXABLE')
    expect(rows[2]).toBe('!ENDTRNS')
  })

  it('writes a balanced TRNS + SPL block matching the sample layout', () => {
    // TRNS total is derived from splits (38.64 + 1,393.70 = 1,432.34); trailing tab preserved.
    expect(rows[3]).toBe('TRNS\t1\tINVOICE\t4/4/2026\tACCOUNTS RECEIVABLE\tFARWEST CORROSION CONTROL COMPANY\t\t1,432.34\t00105035\t1485 Beulah St\t5/4/2026\tFARWEST CORROSION CONTROL COMPANY\tB6673\tY\t')
    expect(rows[4]).toBe('SPL\t2\tINVOICE\t4/4/2026\tREVENUE - SERVICES:SERV-EQUIPMENT USED\t\t:TCS-VI\t-38.64\t00105035\tEQUIPMENT RENTAL\t\tEQUIPMENT RENTAL\tN')
    expect(rows[5]).toBe('SPL\t3\tINVOICE\t4/4/2026\tREVENUE - SERVICES:SERV-LABOR EMPLOYED\t\t:TCS-VI\t-1,393.70\t00105035\tLABOR - TRAFFIC CONTROL\t\tLABOR - TRAFFIC CONTROL\tN')
    expect(rows[6]).toBe('SPL\t4\tINVOICE\t4/4/2026\tSales Tax Payable\t\t\t0.00\t00105035\tNO TAX\tAUTOSTAX\t\tN')
    expect(rows[7]).toBe('ENDTRNS')
  })

  it('keeps one continuous id sequence across transactions', () => {
    const two = buildInvoiceIif([
      { docNum: 'A', date: '2026-04-04', dueDate: '2026-05-04', customerName: 'X', memo: '', poNum: '', nameIsTaxable: true, taxCents: 0, splits: linesToSplits([{ kind: 'rental', amountCents: 100 }], KIND_MAP, ':TCS-BK') },
      { docNum: 'B', date: '2026-04-05', dueDate: '2026-05-05', customerName: 'Y', memo: '', poNum: '', nameIsTaxable: true, taxCents: 0, splits: linesToSplits([{ kind: 'labor', amountCents: 200 }], KIND_MAP, ':TCS-BK') },
    ], CFG).split('\r\n')
    // rows: 0-2 header, 3 TRNS(1), 4 SPL(2), 5 tax(3), 6 ENDTRNS, 7 TRNS(4), ...
    expect(two[3].startsWith('TRNS\t1\t')).toBe(true)
    expect(two[7].startsWith('TRNS\t4\t')).toBe(true)
  })

  it('writes a negative tax credit when tax is non-zero', () => {
    const taxed = buildInvoiceIif([{
      docNum: 'T1', date: '2026-04-04', dueDate: '2026-05-04', customerName: 'Z', memo: '', poNum: '',
      nameIsTaxable: true, taxCents: 800, splits: linesToSplits([{ kind: 'sale', amountCents: 10000 }], KIND_MAP, ':TCS-BK'),
    }], CFG).split('\r\n')
    // total = 100.00 + 8.00 = 108.00
    expect(taxed[3]).toContain('\t108.00\t')
    expect(taxed[5]).toBe('SPL\t3\tINVOICE\t4/4/2026\tSales Tax Payable\t\t\t-8.00\tT1\tTAX\tAUTOSTAX\t\tN')
  })
})
