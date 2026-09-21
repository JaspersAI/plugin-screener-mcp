import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cellText,
  DEFAULT_SORT,
  echoOf,
  evidenceText,
  fieldLabel,
  filterText,
  fitOutput,
  fromDraft,
  gatheredText,
  groupFields,
  inSync,
  needsStart,
  OUTPUT_BYTES,
  overLimit,
  parseValue,
  progressText,
  readFields,
  readRun,
  readRunText,
  readScreen,
  readStart,
  readTickers,
  screenArgs,
  shownColumns,
  signOf,
  slug,
  summarize,
  toDraft,
  valueText,
  verificationMark,
  type Field,
  type Filter,
  type Output,
} from './screener.ts'

// The plugin's pure half: what goes to the server and what its answers hold, what a cell and a chip
// say, how a typed value is read, and the text the model is given. Everything here runs without
// React, the SDK, or a connection.

const GUIDE = [
  { field: 'revenue', group: 'Latest fiscal year', kind: 'number', unit: 'usd', ops: ['gt', 'gte', 'lt', 'lte', 'eq', 'ne', 'between', 'in', 'is_null', 'not_null'], sortable: true, description: 'Revenue, USD' },
  { field: 'gross_margin', group: 'Ratios and growth', kind: 'number', unit: 'fraction', ops: ['gt', 'gte', 'lt', 'lte', 'between'], sortable: true, description: 'Gross profit / revenue, fraction' },
  { field: 'fiscal_year', group: 'Latest fiscal year', kind: 'number', unit: 'year', ops: ['eq', 'gte'], sortable: true, description: 'Fiscal year' },
  { field: 'debt_to_equity', group: 'Ratios and growth', kind: 'number', unit: 'number', ops: ['lt'], sortable: true, description: 'Total debt / equity' },
  { field: 'sic_description', group: 'Identity', kind: 'text', unit: null, ops: ['eq', 'ne', 'in', 'contains', 'is_null', 'not_null'], sortable: true, description: 'SEC industry' },
  { field: 'fiscal_period_end', group: 'Latest fiscal year', kind: 'date', unit: null, ops: ['gte', 'between'], sortable: true, description: 'Period end' },
  { field: 'exchanges', group: 'Identity', kind: 'list', unit: null, ops: ['in', 'is_null', 'not_null'], sortable: false, description: 'Exchange of each ticker' },
]
const FIELDS = readFields(GUIDE)
const field = (name: string): Field => FIELDS.find((f) => f.field === name)!

test('the guide\'s rows are the fields, read leniently, and grouped in the guide\'s order', () => {
  assert.equal(FIELDS.length, 7)
  assert.deepEqual(field('revenue'), { ...GUIDE[0], ops: GUIDE[0]!.ops } as Field)
  // A row with no field is dropped; a number with no unit is a plain number; an op we do not know is left out.
  const loose = readFields([{ nothing: 1 }, { field: 'roe' }, { field: 'x', kind: 'list', ops: ['in', 'near'] }])
  assert.deepEqual(loose.map((f) => [f.field, f.kind, f.unit, f.ops, f.sortable]), [
    ['roe', 'number', 'number', [], true],
    ['x', 'list', null, ['in'], false],
  ])
  assert.deepEqual(readFields(undefined), [])
  assert.deepEqual(groupFields(FIELDS).map(([group, members]) => [group, members.length]), [
    ['Latest fiscal year', 3],
    ['Ratios and growth', 2],
    ['Identity', 2],
  ])
})

test('a field\'s name reads as a label', () => {
  assert.equal(fieldLabel('revenue_growth_yoy'), 'Revenue growth YoY')
  assert.equal(fieldLabel('roe'), 'ROE')
  assert.equal(fieldLabel('inst_own_pct'), 'Inst. own %')
  assert.equal(fieldLabel('sic_description'), 'SIC description')
  assert.equal(fieldLabel('insider_net_buy_value_6m'), 'Insider net buy value 6m')
  assert.equal(fieldLabel('revenue_cagr_3y'), 'Revenue CAGR 3Y')
})

test('the table draws the fields filtered on, the sort, then the columns asked for, each once and never the company\'s own', () => {
  const filters: Filter[] = [{ field: 'gross_margin', op: 'gte', value: 0.5 }, { field: 'sic_description', op: 'contains', value: 'software' }]
  assert.deepEqual(shownColumns(filters, DEFAULT_SORT, ['revenue', 'roe', 'gross_margin', 'name']), ['gross_margin', 'revenue', 'roe'])
})

test('cellText formats by unit, and a missing value is a dash', () => {
  assert.equal(cellText(2.5e9, field('revenue')), '$2.50B')
  assert.equal(cellText(12_300_000, field('revenue')), '$12.3M')
  assert.equal(cellText(-4_500, field('revenue')), '-$5K')
  assert.equal(cellText(6.13, { kind: 'number', unit: 'usd' }), '$6.13')
  assert.equal(cellText(null, field('revenue')), '—')
  assert.equal(cellText(0.153, field('gross_margin')), '15.3%')
  assert.equal(cellText(-0.08, field('gross_margin')), '-8.0%')
  assert.equal(cellText(2025, field('fiscal_year')), '2025')
  assert.equal(cellText(1.234, field('debt_to_equity')), '1.23')
  assert.equal(cellText(15_204_137_000, { kind: 'number', unit: 'number' }), '15.20B')
  assert.equal(cellText(4312, { kind: 'number', unit: 'number' }), '4,312')
  assert.equal(cellText(['NYSE', 'Nasdaq'], field('exchanges')), 'NYSE Nasdaq')
  assert.equal(cellText([], field('exchanges')), '—')
  assert.equal(cellText('2025-09-27', field('fiscal_period_end')), '2025-09-27')
  // A field the guide did not describe still shows its value.
  assert.equal(cellText(0.5, undefined), '0.50')
})

test('growth and returns carry a sign, nothing else does', () => {
  assert.equal(signOf('revenue_growth_yoy', 0.2), 'up')
  assert.equal(signOf('roe', -0.1), 'down')
  assert.equal(signOf('inst_shares_change_pct', 0), null)
  assert.equal(signOf('gross_margin', -0.1), null)
  assert.equal(signOf('roe', null), null)
})

test('a typed value is read into raw units by the field\'s unit', () => {
  assert.equal(parseValue('500M', field('revenue')), 5e8)
  assert.equal(parseValue('$2.5b', field('revenue')), 2.5e9)
  assert.equal(parseValue('-$5M', field('revenue')), -5e6)
  assert.equal(parseValue('1,204', field('revenue')), 1204)
  assert.equal(parseValue('6.13', field('revenue')), 6.13)
  assert.equal(parseValue('20', field('gross_margin')), 0.2)
  assert.equal(parseValue('15.3%', field('gross_margin')), 0.153)
  assert.equal(parseValue('-8', field('gross_margin')), -0.08)
  assert.equal(parseValue('2025', field('fiscal_year')), 2025)
  assert.equal(parseValue('0.5', field('debt_to_equity')), 0.5)
  assert.equal(parseValue(' software ', field('sic_description')), 'software')
  assert.equal(parseValue('2025-06-30', field('fiscal_period_end')), '2025-06-30')
  // What cannot be read is null, never a guess: a scale on a percentage, a percent sign on dollars, words, a loose date.
  for (const [text, name] of [['20M', 'gross_margin'], ['20%', 'revenue'], ['lots', 'revenue'], ['', 'revenue'], ['25', 'fiscal_year'], ['June 2025', 'fiscal_period_end']] as const) {
    assert.equal(parseValue(text, field(name)), null, `${text} on ${name}`)
  }
})

test('a raw value is shown the way it is typed, and reads back as the same value', () => {
  assert.equal(valueText(5e8, field('revenue')), '$500M')
  assert.equal(valueText(2.5e9, field('revenue')), '$2.5B')
  assert.equal(valueText(1500, field('revenue')), '$1.5K')
  assert.equal(valueText(-5e6, field('revenue')), '-$5M')
  assert.equal(valueText(0.2, field('gross_margin')), '20%')
  assert.equal(valueText(0.153, field('gross_margin')), '15.3%')
  assert.equal(valueText(2025, field('fiscal_year')), '2025')
  assert.equal(valueText(1500, field('debt_to_equity')), '1500')
  assert.equal(valueText('software', field('sic_description')), 'software')
  // A figure no scale says exactly is written out, so editing a filter never changes it.
  assert.equal(valueText(1_234_567_891, field('revenue')), '$1234567891')
  const cases: [number, string][] = [[5e8, 'revenue'], [1_234_567_891, 'revenue'], [6.13, 'revenue'], [-2.5e9, 'revenue'], [0.153, 'gross_margin'], [-0.08, 'gross_margin'], [0.12345, 'gross_margin'], [2025, 'fiscal_year'], [0.5, 'debt_to_equity'], [3e6, 'debt_to_equity']]
  for (const [raw, name] of cases) assert.equal(parseValue(valueText(raw, field(name)), field(name)), raw, `${raw} on ${name}`)
})

test('a filter reads in words, in display units', () => {
  assert.equal(filterText({ field: 'revenue', op: 'gte', value: 5e8 }, field('revenue')), 'Revenue ≥ $500M')
  assert.equal(filterText({ field: 'gross_margin', op: 'between', value: [0.2, 0.4] }, field('gross_margin')), 'Gross margin 20% to 40%')
  assert.equal(filterText({ field: 'sic_description', op: 'contains', value: 'software' }, field('sic_description')), 'SIC description contains "software"')
  assert.equal(filterText({ field: 'exchanges', op: 'in', value: ['NYSE', 'Nasdaq'] }, field('exchanges')), 'Exchanges in NYSE, Nasdaq')
  assert.equal(filterText({ field: 'fiscal_period_end', op: 'gte', value: '2025-06-30' }, field('fiscal_period_end')), 'Fiscal period end ≥ 2025-06-30')
  assert.equal(filterText({ field: 'revenue', op: 'is_null' }, field('revenue')), 'Revenue is empty')
  // A field the guide does not know still says what it is, in raw units.
  assert.equal(filterText({ field: 'roe', op: 'gt', value: 0.15 }, undefined), 'ROE > 0.15')
})

test('the dialog\'s draft is the filter as typed, and reads back as the same filter', () => {
  const filters: Filter[] = [
    { field: 'revenue', op: 'between', value: [5e8, 5e9] },
    { field: 'gross_margin', op: 'gte', value: 0.5 },
    { field: 'exchanges', op: 'in', value: ['NYSE', 'Nasdaq'] },
    { field: 'sic_description', op: 'contains', value: 'software' },
    { field: 'revenue', op: 'not_null' },
  ]
  assert.deepEqual(toDraft(filters[0]!, field('revenue')), { field: 'revenue', op: 'between', a: '$500M', b: '$5B' })
  assert.deepEqual(toDraft(filters[2]!, field('exchanges')), { field: 'exchanges', op: 'in', a: 'NYSE, Nasdaq', b: '' })
  for (const filter of filters) assert.deepEqual(fromDraft(toDraft(filter, field(filter.field)), field(filter.field)), { filter })
})

test('a draft that cannot be read says what is wrong with it', () => {
  assert.deepEqual(fromDraft({ field: '', op: 'gte', a: '', b: '' }, undefined), { error: 'Pick a field.' })
  assert.match((fromDraft({ field: 'revenue', op: 'gte', a: 'lots', b: '' }, field('revenue')) as { error: string }).error, /Cannot read "lots" \(\$, with K M B\)/)
  assert.match((fromDraft({ field: 'revenue', op: 'between', a: '1M', b: '' }, field('revenue')) as { error: string }).error, /Cannot read ""/)
  assert.match((fromDraft({ field: 'exchanges', op: 'in', a: ' , ', b: '' }, field('exchanges')) as { error: string }).error, /at least one value/)
  assert.match((fromDraft({ field: 'debt_to_equity', op: 'contains', a: 'x', b: '' }, field('debt_to_equity')) as { error: string }).error, /takes </)
})

test('tickers are read as the SEC writes them, once each', () => {
  assert.deepEqual(readTickers(' aapl, msft\nbrk-b  AAPL;nvda '), ['AAPL', 'MSFT', 'BRK-B', 'NVDA'])
  assert.deepEqual(readTickers(''), [])
})

const ANSWER = {
  session_id: 'scr_00000000000000aa',
  universe: 5378,
  count: 281,
  count_before: 1204,
  applied_filters: [
    { field: 'gross_margin', op: 'gte', value: 0.5, matches: 2011 },
    { field: 'revenue', op: 'not_null', matches: 4102 },
  ],
  tickers: null,
  unknown_tickers: ['ZZZZ'],
  include_unlisted: false,
  sort: { field: 'revenue', dir: 'desc' },
  qualitative_ready: false,
  qualitative_max: 100,
  offset: 0,
}
const LISTED = { filters: [{ field: 'gross_margin', op: 'gte', value: 0.5 }, { field: 'revenue', op: 'not_null' }] as Filter[], tickers: [] as string[], includeUnlisted: false }
const VIEW = { ...LISTED, sort: DEFAULT_SORT, page: 0, columns: ['roe'] }

test('a screen\'s answer is read from the dataset\'s meta', () => {
  const screen = readScreen(ANSWER)!
  assert.deepEqual([screen.sessionId, screen.universe, screen.count, screen.countBefore, screen.ready, screen.max], ['scr_00000000000000aa', 5378, 281, 1204, false, 100])
  assert.deepEqual(screen.applied, [{ field: 'gross_margin', op: 'gte', value: 0.5, matches: 2011 }, { field: 'revenue', op: 'not_null', matches: 4102 }])
  assert.deepEqual([screen.tickers, screen.unknownTickers], [[], ['ZZZZ']])
  // Nothing yet, or an answer that is not a screen's.
  assert.equal(readScreen({}), null)
})

test('the first call sends the whole list; one that only sorts, pages or adds columns names the session and nothing of the list', () => {
  assert.deepEqual(screenArgs({ ...VIEW, sessionId: null }, null, 200), {
    filters: LISTED.filters, tickers: [], include_unlisted: false, sort: DEFAULT_SORT, columns: ['roe'], limit: 200, offset: 0,
  })
  const echo = echoOf(readScreen(ANSWER)!)!
  assert.deepEqual(screenArgs({ ...VIEW, page: 1, sessionId: echo.sessionId }, echo, 200), {
    session_id: 'scr_00000000000000aa', sort: DEFAULT_SORT, columns: ['roe'], limit: 200, offset: 200,
  })
  // A changed list goes whole, under the same session; [] tells the server "every company again".
  const changed = screenArgs({ ...VIEW, filters: [LISTED.filters[0]!], sessionId: echo.sessionId }, echo, 200)
  assert.deepEqual([changed.session_id, changed.filters, changed.tickers, changed.include_unlisted], ['scr_00000000000000aa', [LISTED.filters[0]], [], false])
  // A session that came back from the panel's state, with no answer yet to say what it holds.
  assert.deepEqual(Object.keys(screenArgs({ ...VIEW, sessionId: 'scr_restored' }, null, 200)).sort(), ['columns', 'filters', 'include_unlisted', 'limit', 'offset', 'session_id', 'sort', 'tickers'])
})

test('the session is in step with the state whatever order a filter\'s keys were written in, and however the tickers were typed', () => {
  const echo = echoOf(readScreen({ ...ANSWER, tickers: ['AAPL', 'MSFT'] })!)!
  const reordered = [{ op: 'gte', value: 0.5, field: 'gross_margin' }, { op: 'not_null', field: 'revenue' }] as Filter[]
  assert.equal(inSync({ ...LISTED, filters: reordered, tickers: ['aapl', 'MSFT'], sessionId: echo.sessionId }, echo), true)
  assert.equal(inSync({ ...LISTED, tickers: ['AAPL'], sessionId: echo.sessionId }, echo), false)
  assert.equal(inSync({ ...LISTED, tickers: ['AAPL', 'MSFT'], includeUnlisted: true, sessionId: echo.sessionId }, echo), false)
  assert.equal(inSync({ ...LISTED, tickers: ['AAPL', 'MSFT'], sessionId: 'scr_other' }, echo), false)
  assert.equal(inSync({ ...LISTED, sessionId: null }, null), false)
})

test('a list over the limit says by how many', () => {
  assert.equal(overLimit({ count: 281, max: 100 }), 'The list has 281 companies, 181 over the 100 the qualitative stage takes. Narrow it first.')
  assert.equal(overLimit({ count: 0, max: 100 }), 'The list is empty: there is nothing to check.')
})

test('a criterion\'s id is made from its question, fits the server\'s pattern, and is its own', () => {
  assert.equal(slug('Does the company depend on a sole-source supplier?'), 'depend_sole_source_supplier')
  assert.equal(slug("Has the company's management disclosed a material cybersecurity incident?"), 'management_disclosed_material')
  assert.equal(slug('Does the company depend on a sole-source supplier?', ['depend_sole_source_supplier']), 'depend_sole_source_supplier_2')
  assert.equal(slug('Is it?'), 'is_it')
  assert.equal(slug('¿¿¿???'), 'criterion')
  for (const question of ['Does the company depend on a sole-source supplier?', 'x'.repeat(300), 'A B C D E F G', '¿?']) assert.match(slug(question, ['criterion']), /^[a-z0-9_]{1,40}$/)
})

test('a run starts when it is asked for and the view has not already started it', () => {
  const criteria = [{ id: 'sole_source', question: 'Does the company depend on a sole-source supplier?' }]
  assert.equal(needsStart(criteria, {}), true)
  // What a model fills in beside the request does not count as started.
  assert.equal(needsStart(criteria, { id: '', status: 'running', error: '' }), true)
  assert.equal(needsStart(criteria, { status: 'done' }), true)
  assert.equal(needsStart(criteria, { id: 'run_00000000000000bb', status: 'running' }), false)
  assert.equal(needsStart(criteria, { id: 'run_00000000000000bb', status: 'done' }), false)
  assert.equal(needsStart(criteria, { status: 'error', error: 'screener/jaspers is connecting' }), false)
  // Criteria alone never start a run: it costs model calls for every company.
  assert.equal(needsStart(criteria, null), false)
  assert.equal(needsStart(criteria, undefined), false)
  assert.equal(needsStart([], {}), false)
})

test('a started run is read from the start reply', () => {
  assert.deepEqual(readStart(JSON.stringify({ run_id: 'run_00000000000000bb', session_id: 'scr_1', status: 'queued', total: 37 })), { runId: 'run_00000000000000bb', total: 37 })
  assert.throws(() => readStart('not json'), /no run id/)
  assert.throws(() => readStart(JSON.stringify({ status: 'queued' })), /no run id/)
})

const CITATION = {
  id: 'c7f3a2b1', title: 'AAPL 10-K · Item 1A Risk Factors · filed 2025-10-31', quote: 'We depend on a single supplier',
  url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm#:~:text=We%20depend',
  ticker: 'AAPL', form: '10-K', item: '1A', accession: '0000320193-25-000079',
}
const META = {
  run_id: 'run_00000000000000bb', session_id: 'scr_1', status: 'running', created_at: '2026-09-20T00:00:00Z', finished_at: null,
  criteria: [{ id: 'sole_source', question: 'Does the company depend on a sole-source supplier?' }],
  progress: { total: 3, queued: 0, running: 1, error: 1, pass: 1, fail: 0, unclear: 0, unverified: 0 },
  citations: [CITATION, { id: '', quote: 'no id' }, { id: 'cbad', title: 't', quote: 'q', url: 'http://not-https.example' }],
}
const ROWS = [
  { cik: 320193, ticker: 'AAPL', name: 'Apple Inc.', status: 'done', verdict: 'pass', error: null, criteria: [{
    id: 'sole_source', verdict: 'pass', rationale: 'It names one supplier.', verification: 'supports', confidence: 0.93, note: '', evidence: ['c7f3a2b1'],
    gathered: { searched: ['w1', 'w2', 'w3', 'w4', 'w5'], judged: 9, paragraphs: 31, good: [{ chunk_id: 'x', paragraph: 2 }, { chunk_id: 'y', paragraph: 0 }] },
  }] },
  { cik: 789019, ticker: 'MSFT', name: 'Microsoft Corp', status: 'running', verdict: null, error: null, criteria: [] },
  { cik: 1018724, ticker: 'AMZN', name: 'Amazon.com Inc', status: 'error', verdict: null, error: 'Bedrock timed out', criteria: [] },
]

test('a run is read from its answer: results from the rows, the rest from the meta, each quote once under its id', () => {
  const run = readRun(META, ROWS)
  assert.equal(run.status, 'running')
  assert.deepEqual(run.progress, META.progress)
  assert.deepEqual(run.criteria, META.criteria)
  assert.deepEqual(run.results.map((r) => [r.ticker, r.status, r.verdict, r.error]), [['AAPL', 'done', 'pass', null], ['MSFT', 'running', null, null], ['AMZN', 'error', null, 'Bedrock timed out']])
  assert.deepEqual(run.results[0]!.criteria[0], {
    id: 'sole_source', verdict: 'pass', rationale: 'It names one supplier.', verification: 'supports', confidence: 0.93, note: '', evidence: ['c7f3a2b1'],
    gathered: { searched: 5, judged: 9, paragraphs: 31, relevant: 2 },
  })
  // Only what a card shows is kept; a citation with no id is dropped, a link that is not https is not a link.
  assert.deepEqual(run.citations['c7f3a2b1'], { id: 'c7f3a2b1', title: CITATION.title, url: CITATION.url, quote: CITATION.quote })
  assert.deepEqual(Object.keys(run.citations), ['c7f3a2b1', 'cbad'])
  assert.equal(run.citations['cbad']!.url, null)
})

test('a run without evidence, a run as text, and an answer that is nothing are all read', () => {
  const brief = readRun({ ...META, status: 'done', citations: undefined }, [{ ...ROWS[0], criteria: [{ id: 'sole_source', verdict: 'pass', rationale: 'r', verification: 'supports', confidence: 0.9, note: '' }] }])
  assert.equal(brief.status, 'done')
  assert.deepEqual(brief.results[0]!.criteria[0]!.evidence, [])
  assert.equal(brief.results[0]!.criteria[0]!.gathered, null)
  assert.deepEqual(brief.citations, {})
  assert.deepEqual(readRunText(JSON.stringify({ ...META, results: ROWS })), readRun(META, ROWS))
  const nothing = readRunText('not json')
  assert.deepEqual([nothing.status, nothing.results, nothing.progress.total], ['running', [], 0])
})

test('where a run is reads in one line', () => {
  assert.equal(progressText(META.progress, 'running'), 'reading: 2 of 3 · 1 pass · 0 fail · 0 unclear · 0 unverified · 1 error')
  assert.equal(progressText({ ...META.progress, running: 0, error: 0, fail: 2 }, 'done'), '3 read · 1 pass · 2 fail · 0 unclear · 0 unverified')
})

test('a verification that did not hold is marked; one that did, or a claim of absence, is not', () => {
  assert.equal(verificationMark('supports'), null)
  assert.equal(verificationMark('not_checked'), null)
  assert.equal(verificationMark(''), null)
  assert.match(verificationMark('contradicts')!, /contradicts/)
  assert.match(verificationMark('says_nothing')!, /does not show/)
  assert.match(verificationMark('uncertain')!, /not confident/)
})

test('what was searched and read for a criterion reads in one line', () => {
  assert.equal(gatheredText({ searched: 5, judged: 9, paragraphs: 31, relevant: 2 }), '5 searches made, 9 passages judged, 31 paragraphs read, 2 relevant')
  assert.equal(gatheredText({ searched: 1, judged: 1, paragraphs: 1, relevant: 0 }), '1 search made, 1 passage judged, 1 paragraph read, 0 relevant')
})

test('the open company\'s evidence is text a model can quote: a first line that names it, and every quote with its marker', () => {
  const run = readRun(META, ROWS)
  const text = evidenceText(run.results[0]!, run.criteria, run.citations, 'run_00000000000000bb')
  assert.equal(text, [
    'Screener evidence for AAPL (Apple Inc.), qualitative run run_00000000000000bb: pass',
    '',
    '## sole_source: Does the company depend on a sole-source supplier?',
    'Verdict: pass (verification: supports, confidence 0.93)',
    'Rationale: It names one supplier.',
    '- "We depend on a single supplier" [^c7f3a2b1] (AAPL 10-K · Item 1A Risk Factors · filed 2025-10-31)',
    'Retrieval: 5 searches made, 9 passages judged, 31 paragraphs read, 2 relevant.',
  ].join('\n'))
  assert.match(evidenceText(run.results[2]!, run.criteria, run.citations, 'run_1'), /^Screener evidence for AMZN \(Amazon\.com Inc\), qualitative run run_1: error\n\nError: Bedrock timed out$/)
})

function output(over: Partial<Output>): Output {
  return { session_id: 'scr_1', universe: 5378, count: 281, applied_filters: [], tickers: [], unknown_tickers: [], sort: DEFAULT_SORT, qualitative_ready: false, qualitative_max: 100, open: '', ...over }
}

test('the output fits what the app takes: the tickers at the end of the page give way, nothing else does', () => {
  const small = output({ tickers: ['AAPL', 'MSFT'] })
  assert.equal(fitOutput(small), small)
  const big = output({ tickers: Array.from({ length: 1000 }, (_, i) => `TICK${i}`), applied_filters: ANSWER.applied_filters as Output['applied_filters'] })
  const fitted = fitOutput(big)
  assert.ok(new TextEncoder().encode(JSON.stringify(fitted)).length <= OUTPUT_BYTES)
  assert.ok(fitted.tickers.length > 100 && fitted.tickers.length < 1000)
  assert.deepEqual(fitted.tickers, big.tickers.slice(0, fitted.tickers.length))
  assert.deepEqual({ ...fitted, tickers: [] }, { ...big, tickers: [] })
})

test('the summary says how many pass, of how many, behind which screen, and where the run is', () => {
  assert.equal(summarize({ filters: LISTED.filters, sort: DEFAULT_SORT }, output({})), 'Screener: 281 of 5,378 pass 2 filters, sort revenue desc')
  assert.equal(
    summarize({ filters: [LISTED.filters[0]!], tickers: ['AAPL', 'MSFT'], sort: { field: 'roe', dir: 'asc' } }, output({ count: 2, universe: 2, qualitative_ready: true })),
    'Screener: 2 of 2 pass 1 filter, own list of 2, sort roe asc, ready for the qualitative stage',
  )
  assert.equal(
    summarize({}, output({ count: 3, qualitative: { run_id: 'run_1', status: 'running', progress: META.progress }, open: 'AAPL' })),
    'Screener: 3 of 5,378 pass, sort revenue desc, qualitative run running: reading: 2 of 3 · 1 pass · 0 fail · 0 unclear · 0 unverified · 1 error, evidence open for AAPL',
  )
  assert.equal(summarize({}, output({ qualitative: { run_id: null, status: 'error', progress: null, error: 'the list is too long' } })), 'Screener: 281 of 5,378 pass, sort revenue desc, qualitative run failed: the list is too long')
})
