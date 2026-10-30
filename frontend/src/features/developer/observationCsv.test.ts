import { afterEach, describe, expect, it, vi } from 'vitest'
import { comparisonSummaryCsv, comparisonTraceCsv, downloadComparisonCsv, type ComparisonExportContext, type ComparisonTrace } from './observationCsv'
import { comparisonDemo } from './comparisonDemo'
import { comparisonGeometry, type ComparisonValues } from '../../../../model/prototype/observationComparison'

const values: ComparisonValues = { headGap: 1.23456789, faceHeight: -2.5, shoulderLift: 0, shoulderScale: 20, relativeZ: null, zMeters: null }
const context: ComparisonExportContext = { runId: 'synthetic-run', startedAt: '2026-10-16T04:00:00.000Z', source: 'synthetic', reference: comparisonGeometry(comparisonDemo(0, 'neutral')), dropped: 0 }
const row: ComparisonTrace = { elapsedMs: 4100, observationTimeMs: 7200, action: 'deviation', segment: 2, event: 'observation', status: 'depth_unavailable', imageValid: true, worldValid: false, values, zMeters: null }
describe('observation CSV: explicitly synthetic scalars only', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it('exports captured actions only, with full numeric precision, units, window and provenance', () => {
    const csv = comparisonSummaryCsv({ deviation: { values, elapsedMs: 4100, windowStartMs: 6200, windowEndMs: 7200, sampleCount: 11, segment: 2 } }, context)
    expect(csv.startsWith('\uFEFFschema_version,')).toBe(true)
    expect(csv).toContain('"observation-comparison-csv-v3"')
    expect(csv.trim().split('\r\n')).toHaveLength(2)
    expect(csv).toContain('head_gap_delta_pct_ref_image_shoulder_width')
    expect(csv).toContain('relative_z_estimated_m')
    expect(csv).toContain('"synthetic","user_selected_not_ground_truth"')
    expect(csv).toContain('"deviation","이탈 자세",2,4100,6200,7200,11,1.23456789,-2.5,0,20,,')
    for (const forbidden of ['landmarks','worldLandmarks','video','participant_id']) expect(csv).not.toContain(forbidden)
  })
  it('keeps missing depth blank, missing image blank, interruption events and segment changes explicit', () => {
    const csv = comparisonTraceCsv([row, { ...row, elapsedMs: 4200, observationTimeMs: null, action: 'stretch', segment: 3, event: 'hidden', status: 'unmeasurable', imageValid: false, worldValid: false, values: null }], { ...context, dropped: 12 })
    expect(csv).toContain('trace_rows_dropped')
    expect(csv).toContain(',12,"deviation"')
    expect(csv).toContain('"observation","depth_unavailable",true,false,1.23456789,-2.5,0,20,,')
    expect(csv).toContain('"stretch","앉은 채 스트레칭",3,4200,,"hidden","unmeasurable",false,false,,,,,,')
    const [header, ...rows] = csv.slice(1).trimEnd().split('\r\n')
    expect(header).toContain('protocol_phase_attempt')
    expect(rows.every(line => line.split(',').length === header.split(',').length)).toBe(true)
  })
  it('escapes quoted fields and neutralizes spreadsheet formulas without corrupting negative numeric cells', () => {
    const csv = comparisonTraceCsv([row], { ...context, runId: '=formula,"quoted"\nline', reference: null })
    expect(csv).toContain('"\'=formula,""quoted""\nline"')
    expect(csv).toContain(',-2.5,')
    expect(csv).not.toContain('"\'-2.5"')
  })
  it('creates a CSV only on the explicit download call and revokes its blob URL', async () => {
    vi.useFakeTimers()
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-download')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchor = { href: '', download: '', click: vi.fn() }
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor) })
    expect(create).not.toHaveBeenCalled()
    downloadComparisonCsv('trace', comparisonTraceCsv([row], context), 'synthetic')
    expect(anchor.download).toMatch(/^posture-observation-synthetic-trace-\d+\.csv$/)
    expect(anchor.href).toBe('blob:synthetic-download'); expect(anchor.click).toHaveBeenCalledOnce()
    const blob = create.mock.calls[0][0]
    expect(blob).toBeInstanceOf(Blob)
    if (!(blob instanceof Blob)) throw new Error('Expected a CSV Blob')
    expect(blob.type).toBe('text/csv;charset=utf-8')
    expect(await blob.text()).toContain('user_selected_not_ground_truth')
    expect(revoke).not.toHaveBeenCalled(); vi.advanceTimersByTime(1000); expect(revoke).toHaveBeenCalledWith('blob:synthetic-download')
  })
})
