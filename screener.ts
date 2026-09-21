// The screener's pure half: what the panel's state means, what goes to the server and what its
// answers hold, how a value reads and how a typed one is read back, and the text a model is given.
// The server (screener-mcp) owns the fields: their names, kinds, units and ops come from its guide,
// so there is no list of them here. No React and no SDK: it is imported by the view and read by the
// tests, which run under Node on their own.

export type Kind = 'number' | 'text' | 'date' | 'list'
/** How a number field reads: raw USD, a fraction shown as a percentage, a year, or a plain number. */
export type Unit = 'usd' | 'fraction' | 'year' | 'number'

export const OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'ne', 'between', 'in', 'contains', 'is_null', 'not_null'] as const
export type Op = (typeof OPS)[number]

export const VERDICTS = ['pass', 'fail', 'unclear', 'unverified'] as const
export type Verdict = (typeof VERDICTS)[number]

/** One field a filter, a sort or a column may name, as the server's guide describes it. */
export interface Field {
  field: string
  group: string
  kind: Kind
  unit: Unit | null
  ops: Op[]
  sortable: boolean
  description: string
}

/** The server's filter language: raw units, joined by AND. */
export interface Filter {
  field: string
  op: Op
  value?: number | string | (number | string)[]
}

export interface Sort {
  field: string
  dir: 'asc' | 'desc'
}

export interface Criterion {
  id: string
  question: string
}

/** The qualitative run of this panel. Present with no id, it is a request to start one. */
export interface Run {
  id?: string
  status?: 'running' | 'done' | 'error'
  error?: string
}

/** What the panel holds, and so what the orchestrator sets. */
export interface State {
  filters: Filter[]
  /** The user's own list; empty for every company. */
  tickers: string[]
  includeUnlisted: boolean
  sort: Sort
  page: number
  columns: string[]
  /** The server's session, written by the view from its first answer. */
  sessionId: string | null
  criteria: Criterion[]
  run: Run | null
  /** Which verdicts the table shows once a run has results; empty for all. */
  verdicts: Verdict[]
  /** The ticker whose evidence is open; empty for none. */
  open: string
}

export const DEFAULT_SORT: Sort = { field: 'revenue', dir: 'desc' }

/** The columns a new screener shows. The fields filtered and sorted on are shown whatever this says. */
export const DEFAULT_COLUMNS = [
  'revenue',
  'revenue_growth_yoy',
  'gross_margin',
  'operating_margin',
  'net_margin',
  'net_income',
  'free_cash_flow',
  'roe',
  'debt_to_equity',
  'insider_net_buy_value_6m',
  'inst_holders',
  'fiscal_year',
]

/** What the server allows in one run, for the editor to stop at. */
export const MAX_CRITERIA = 8
/** The most columns the panel's state takes. */
export const MAX_COLUMNS = 40

// The guide's field rows.

const KINDS: Kind[] = ['number', 'text', 'date', 'list']
const UNITS: Unit[] = ['usd', 'fraction', 'year', 'number']

/** The rows of get_guide("fields"), read leniently: a row that names no field is dropped, a number field with no unit is a plain number. */
export function readFields(rows: Record<string, unknown>[] | undefined): Field[] {
  const fields: Field[] = []
  for (const row of rows ?? []) {
    if (typeof row.field !== 'string' || !row.field) continue
    const kind = KINDS.includes(row.kind as Kind) ? (row.kind as Kind) : 'number'
    const unit = UNITS.includes(row.unit as Unit) ? (row.unit as Unit) : kind === 'number' ? 'number' : null
    fields.push({
      field: row.field,
      group: typeof row.group === 'string' ? row.group : '',
      kind,
      unit,
      ops: Array.isArray(row.ops) ? row.ops.filter((op): op is Op => OPS.includes(op as Op)) : [],
      sortable: typeof row.sortable === 'boolean' ? row.sortable : kind !== 'list',
      description: typeof row.description === 'string' ? row.description : '',
    })
  }
  return fields
}

/** The fields by group, in the guide's order. */
export function groupFields(fields: Field[]): [string, Field[]][] {
  const groups = new Map<string, Field[]>()
  for (const field of fields) groups.set(field.group, [...(groups.get(field.group) ?? []), field])
  return [...groups.entries()]
}

/** Parts of a field's name that do not read as words. */
const WORDS: Record<string, string> = {
  yoy: 'YoY',
  cagr: 'CAGR',
  roe: 'ROE',
  roa: 'ROA',
  eps: 'EPS',
  fcf: 'FCF',
  ocf: 'OCF',
  sga: 'SG&A',
  rnd: 'R&D',
  ebitda: 'EBITDA',
  sic: 'SIC',
  cik: 'CIK',
  hq: 'HQ',
  lt: 'LT',
  st: 'ST',
  wa: 'avg',
  inst: 'Inst.',
  pct: '%',
  '3y': '3Y',
}

/** A field's name as a column header and a chip say it: revenue_growth_yoy is "Revenue growth YoY". */
export function fieldLabel(field: string): string {
  const words = field.split('_').map((word) => WORDS[word] ?? word)
  const first = words[0] ?? ''
  // A word that was replaced is already written the way it reads; any other opens with a capital.
  if (first === field.split('_')[0]) words[0] = first.charAt(0).toUpperCase() + first.slice(1)
  return words.join(' ')
}

/** The columns the table draws after the company: the fields filtered on, the sort, then the ones asked for — the server's own rule. */
export function shownColumns(filters: Filter[], sort: Sort, columns: string[]): string[] {
  const identity = new Set(['cik', 'name', 'ticker', 'tickers', 'sic_description'])
  return [...new Set([...filters.map((f) => f.field), sort.field, ...columns])].filter((field) => !identity.has(field))
}

// Formatting. A cell says a number the way a screener does (B, M, K); a chip and the dialog say a
// threshold in the unit the user types it in, so what is typed and what is shown agree.

/** A number with K, M, B or T behind it when that says it exactly, so what is shown reads back as the same value. */
function scaled(value: number, thousands: boolean): string {
  const a = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  for (const [suffix, scale] of SCALES) {
    if (a < scale || (suffix === 'K' && !thousands)) continue
    const short = String(clean(a / scale))
    if (short.length <= 7) return `${sign}${short}${suffix}`
    break
  }
  return `${sign}${clean(a)}`
}

const SCALES: [string, number][] = [
  ['T', 1e12],
  ['B', 1e9],
  ['M', 1e6],
  ['K', 1e3],
]

function money(value: number): string {
  const a = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`
  return `${sign}$${a.toFixed(2)}`
}

function plain(value: number): string {
  const a = Math.abs(value)
  if (a >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (Number.isInteger(value)) return value.toLocaleString('en-US')
  return value.toFixed(2)
}

/** What one cell says. A value the company never reported is a dash, not a zero. */
export function cellText(value: unknown, field?: Pick<Field, 'kind' | 'unit'>): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.length > 0 ? value.join(' ') : '—'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—'
    if (field?.unit === 'usd') return money(value)
    if (field?.unit === 'fraction') return `${(value * 100).toFixed(1)}%`
    if (field?.unit === 'year') return String(value)
    return plain(value)
  }
  return String(value)
}

/** Growth and returns read faster with a sign on them; nothing else is coloured. */
export function signOf(field: string, value: unknown): 'up' | 'down' | null {
  if (!/growth|cagr|change|^ro[ae]$/.test(field)) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return null
  return value > 0 ? 'up' : 'down'
}

/** What the dialog writes beside a value, so the user knows what the number they type means. */
export function unitHint(field: Pick<Field, 'kind' | 'unit'>): string {
  if (field.kind === 'date') return 'YYYY-MM-DD'
  if (field.kind !== 'number') return ''
  if (field.unit === 'usd') return '$, with K M B'
  if (field.unit === 'fraction') return '%'
  if (field.unit === 'year') return 'year'
  return 'K M B allowed'
}

const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }

/**
 * A value as the user types it, in the server's raw units, or null when it cannot be read: "500M" and
 * "$2B" are dollars, "20" on a fraction is 0.2, a date is ISO. Text is taken as it is.
 */
export function parseValue(text: string, field: Pick<Field, 'kind' | 'unit'>): number | string | null {
  const typed = text.trim()
  if (!typed) return null
  if (field.kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(typed) ? typed : null
  if (field.kind !== 'number') return typed
  if (field.unit === 'year') return /^\d{4}$/.test(typed) ? Number(typed) : null
  const match = /^(-)?\s*\$?\s*(-)?\s*(\d[\d,]*\.?\d*|\.\d+)\s*([kmbt])?\s*(%)?$/i.exec(typed)
  if (!match) return null
  const number = Number(match[3]!.replace(/,/g, ''))
  if (!Number.isFinite(number)) return null
  const fraction = field.unit === 'fraction'
  // A percent sign belongs on a fraction and a scale does not; anywhere else it is the other way round.
  if (fraction ? match[4] : match[5]) return null
  const signed = match[1] || match[2] ? -number : number
  return clean(fraction ? signed / 100 : signed * (SCALE[match[4]?.toLowerCase() ?? ''] ?? 1))
}

/** A raw value as the user would type it, so a filter reads in the dialog the way it was entered. */
export function valueText(raw: number | string, field: Pick<Field, 'kind' | 'unit'> | undefined): string {
  if (typeof raw !== 'number') return raw
  if (field?.unit === 'fraction') return `${clean(raw * 100)}%`
  if (field?.unit === 'year') return String(raw)
  if (field?.unit === 'usd') return raw < 0 ? `-$${scaled(-raw, true)}` : `$${scaled(raw, true)}`
  return scaled(raw, false)
}

const OP_TEXT: Record<Op, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  ne: '≠',
  between: 'between',
  in: 'in',
  contains: 'contains',
  is_null: 'is empty',
  not_null: 'has a value',
}

/** An op as the dialog's list and a chip say it. */
export function opText(op: Op): string {
  return OP_TEXT[op]
}

/** One filter in words: "Revenue ≥ $500M", "Gross margin 20% to 40%", "HQ state in TX, FL". */
export function filterText(filter: Filter, field: Pick<Field, 'kind' | 'unit'> | undefined): string {
  const label = fieldLabel(filter.field)
  const say = (value: number | string): string =>
    typeof value === 'string' && field?.kind !== 'date' ? `"${value}"` : valueText(value, field)
  const { op, value } = filter
  if (op === 'is_null' || op === 'not_null') return `${label} ${OP_TEXT[op]}`
  if (op === 'between' && Array.isArray(value) && value.length === 2) return `${label} ${say(value[0]!)} to ${say(value[1]!)}`
  if (Array.isArray(value)) return `${label} ${OP_TEXT[op]} ${value.map((v) => valueText(v, field)).join(', ')}`
  return `${label} ${OP_TEXT[op]} ${value === undefined ? '?' : say(value)}`
}

/** A filter as the dialog edits it: what was typed, not yet read. */
export interface Draft {
  field: string
  op: Op
  a: string
  b: string
}

export function toDraft(filter: Filter, field: Pick<Field, 'kind' | 'unit'> | undefined): Draft {
  const { value } = filter
  const text = (v: number | string | undefined): string => (v === undefined ? '' : valueText(v, field))
  if (filter.op === 'between' && Array.isArray(value)) return { field: filter.field, op: filter.op, a: text(value[0]), b: text(value[1]) }
  if (Array.isArray(value)) return { field: filter.field, op: filter.op, a: value.map(text).join(', '), b: '' }
  return { field: filter.field, op: filter.op, a: text(value), b: '' }
}

/** The filter a draft says, or a sentence about what is wrong with it. */
export function fromDraft(draft: Draft, field: Field | undefined): { filter: Filter } | { error: string } {
  if (!field) return { error: 'Pick a field.' }
  if (!field.ops.includes(draft.op)) return { error: `${fieldLabel(field.field)} takes ${field.ops.map(opText).join(', ')}.` }
  const base = { field: field.field, op: draft.op }
  if (draft.op === 'is_null' || draft.op === 'not_null') return { filter: base }
  const hint = unitHint(field)
  const wrong = (text: string): { error: string } => ({ error: `Cannot read "${text}"${hint ? ` (${hint})` : ''}.` })
  if (draft.op === 'between') {
    const low = parseValue(draft.a, field)
    const high = parseValue(draft.b, field)
    if (low === null) return wrong(draft.a)
    if (high === null) return wrong(draft.b)
    return { filter: { ...base, value: [low, high] } }
  }
  // A list field is asked "any of", whatever the op's name: the server takes a list there.
  if (draft.op === 'in') {
    const parts = draft.a.split(',').map((part) => part.trim()).filter(Boolean)
    if (parts.length === 0) return { error: 'Give at least one value, separated by commas.' }
    const values: (number | string)[] = []
    for (const part of parts) {
      const value = parseValue(part, field)
      if (value === null) return wrong(part)
      values.push(value)
    }
    return { filter: { ...base, value: values } }
  }
  if (draft.op === 'contains') return draft.a.trim() ? { filter: { ...base, value: draft.a.trim() } } : { error: 'Give the text to look for.' }
  const value = parseValue(draft.a, field)
  return value === null ? wrong(draft.a) : { filter: { ...base, value } }
}

/** Tickers as typed, as the SEC writes them: upper case, once each, split on commas, spaces and lines. */
export function readTickers(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))]
}

// The screen: what one call sends, and what its answer holds.

/** What the server's session holds, as its last answer said it. */
export interface Echo {
  sessionId: string
  filters: Filter[]
  tickers: string[]
  includeUnlisted: boolean
}

/** A screen_companies answer without its rows: the dataset's meta, read leniently. */
export interface Screen {
  sessionId: string | null
  universe: number
  count: number
  countBefore: number | null
  applied: (Filter & { matches: number })[]
  tickers: string[]
  unknownTickers: string[]
  includeUnlisted: boolean
  ready: boolean
  max: number
}

export function readScreen(meta: Record<string, unknown>): Screen | null {
  if (typeof meta.count !== 'number') return null
  const applied = Array.isArray(meta.applied_filters) ? meta.applied_filters.filter(isRecord) : []
  return {
    sessionId: typeof meta.session_id === 'string' ? meta.session_id : null,
    universe: number(meta.universe),
    count: meta.count,
    countBefore: typeof meta.count_before === 'number' ? meta.count_before : null,
    applied: applied
      .filter((f) => typeof f.field === 'string' && OPS.includes(f.op as Op))
      .map((f) => ({
        field: f.field as string,
        op: f.op as Op,
        ...(f.value === undefined || f.value === null ? {} : { value: f.value as Filter['value'] }),
        matches: number(f.matches),
      })),
    tickers: strings(meta.tickers),
    unknownTickers: strings(meta.unknown_tickers),
    includeUnlisted: meta.include_unlisted === true,
    ready: meta.qualitative_ready === true,
    max: number(meta.qualitative_max),
  }
}

export function echoOf(screen: Screen): Echo | null {
  if (!screen.sessionId) return null
  return {
    sessionId: screen.sessionId,
    filters: screen.applied.map(({ matches: _matches, ...filter }) => filter),
    tickers: screen.tickers,
    includeUnlisted: screen.includeUnlisted,
  }
}

type Listed = Pick<State, 'filters' | 'tickers' | 'includeUnlisted'>

/** Whether the server's session holds the list this state asks for. A run freezes the session's list, so it waits for this. */
export function inSync(state: Listed & { sessionId: string | null }, echo: Echo | null): boolean {
  return (
    echo !== null &&
    echo.sessionId === state.sessionId &&
    same(echo.filters.map(parts), state.filters.map(parts)) &&
    same(echo.tickers, readTickers(state.tickers.join(' '))) &&
    echo.includeUnlisted === state.includeUnlisted
  )
}

/**
 * What one screen_companies call sends. The list (filters, tickers, include_unlisted) goes whole when
 * the session does not hold it yet, and is left out when only the sort, the page or the columns
 * moved: to the server a call that names the list is a change of it, and one that does not is a read.
 */
export function screenArgs(
  state: Listed & Pick<State, 'sort' | 'page' | 'columns' | 'sessionId'>,
  echo: Echo | null,
  pageSize: number,
): Record<string, unknown> {
  const read = { sort: state.sort, columns: state.columns, limit: pageSize, offset: state.page * pageSize }
  if (inSync(state, echo)) return { session_id: state.sessionId, ...read }
  return {
    ...(state.sessionId ? { session_id: state.sessionId } : {}),
    filters: state.filters,
    // An empty list is how the server is told "every company again"; left out, the session's list would stay.
    tickers: state.tickers,
    include_unlisted: state.includeUnlisted,
    ...read,
  }
}

/** How far over the qualitative stage's limit the list is, in the words the view and the orchestrator are told. */
export function overLimit(screen: Pick<Screen, 'count' | 'max'>): string {
  if (screen.count === 0) return 'The list is empty: there is nothing to check.'
  const over = screen.count - screen.max
  const n = (value: number): string => value.toLocaleString('en-US')
  return `The list has ${n(screen.count)} companies, ${n(over)} over the ${screen.max} the qualitative stage takes. Narrow it first.`
}

// The qualitative stage.

/** A criterion's id from its question: the words that say something, as the server's pattern wants them (^[a-z0-9_]{1,40}$), unlike any taken. */
export function slug(question: string, taken: string[] = []): string {
  const words = question.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  // A letter on its own is what an apostrophe left behind.
  const telling = words.filter((word) => !SMALL_WORDS.has(word) && (word.length > 1 || /\d/.test(word)))
  // Whole words, up to five, while they fit with room left for a number behind them.
  let base = ''
  for (const word of (telling.length > 0 ? telling : words).slice(0, 5)) {
    if (base && base.length + 1 + word.length > 36) break
    base = base ? `${base}_${word}` : word.slice(0, 36)
  }
  base ||= 'criterion'
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}_${n}`
  return id
}

const SMALL_WORDS = new Set(
  'a an and any are as at be been by do does for from has have in is it its of on or that the their this to was were which with company'.split(' '),
)

/**
 * Whether a run still has to be started. A `run` with no id is the request, from the Run button or
 * from the orchestrator; what a model fills in beside it (a status, an empty id) does not count as
 * started. Only what the view itself leaves does: the server's run id, or a failed start with its reason.
 */
export function needsStart(criteria: Criterion[] | undefined, run: Run | null | undefined): boolean {
  return Boolean(criteria?.length) && run !== null && run !== undefined && !run.id && !(run.status === 'error' && run.error)
}

/** What a started run answers with. */
export function readStart(text: string): { runId: string; total: number } {
  const value = parseJson(text)
  if (typeof value.run_id !== 'string' || !value.run_id) throw new Error('the run did not start: no run id came back')
  return { runId: value.run_id, total: number(value.total) }
}

export interface Progress {
  total: number
  queued: number
  running: number
  error: number
  pass: number
  fail: number
  unclear: number
  unverified: number
}

/** One quote of a filing that an answer rests on, already checked by the server. */
export interface Citation {
  id: string
  title: string
  url: string | null
  quote: string
}

export interface CriterionResult {
  id: string
  verdict: string
  rationale: string
  verification: string
  confidence: number | null
  note: string
  /** Citation ids. */
  evidence: string[]
  gathered: { searched: number; judged: number; paragraphs: number; relevant: number } | null
}

export interface CompanyResult {
  cik: number
  ticker: string | null
  name: string | null
  status: string
  verdict: Verdict | null
  error: string | null
  criteria: CriterionResult[]
}

export interface RunSnapshot {
  status: 'queued' | 'running' | 'done'
  progress: Progress
  criteria: Criterion[]
  results: CompanyResult[]
  citations: Record<string, Citation>
}

/**
 * One get_qualitative_screen answer: its results are the dataset's rows, the rest its meta. Read
 * leniently. A criterion's evidence is a list of citation ids, the citations themselves sit once at
 * the top; a server that still puts the quote inside the evidence is read too.
 */
export function readRun(meta: Record<string, unknown>, rows: Record<string, unknown>[]): RunSnapshot {
  const citations: Record<string, Citation> = {}
  for (const entry of Array.isArray(meta.citations) ? meta.citations : []) {
    const citation = readCitation(entry)
    if (citation) citations[citation.id] = citation
  }
  const results = rows.map((row): CompanyResult => ({
    cik: number(row.cik),
    ticker: typeof row.ticker === 'string' ? row.ticker : null,
    name: typeof row.name === 'string' ? row.name : null,
    status: typeof row.status === 'string' ? row.status : 'queued',
    verdict: VERDICTS.includes(row.verdict as Verdict) ? (row.verdict as Verdict) : null,
    error: typeof row.error === 'string' ? row.error : null,
    criteria: (Array.isArray(row.criteria) ? row.criteria.filter(isRecord) : []).map((c) => readCriterion(c, citations)),
  }))
  const progress = isRecord(meta.progress) ? meta.progress : {}
  return {
    status: meta.status === 'done' ? 'done' : meta.status === 'queued' ? 'queued' : 'running',
    progress: {
      total: number(progress.total),
      queued: number(progress.queued),
      running: number(progress.running),
      error: number(progress.error),
      pass: number(progress.pass),
      fail: number(progress.fail),
      unclear: number(progress.unclear),
      unverified: number(progress.unverified),
    },
    criteria: (Array.isArray(meta.criteria) ? meta.criteria.filter(isRecord) : [])
      .filter((c) => typeof c.id === 'string' && typeof c.question === 'string')
      .map((c) => ({ id: c.id as string, question: c.question as string })),
    results,
    citations,
  }
}

/** The same answer when it came back as text rather than rows. */
export function readRunText(text: string): RunSnapshot {
  const { results, ...meta } = parseJson(text)
  return readRun(meta, Array.isArray(results) ? results.filter(isRecord) : [])
}

function readCitation(entry: unknown): Citation | null {
  if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) return null
  const url = typeof entry.url === 'string' && entry.url.startsWith('https://') ? entry.url : null
  return {
    id: entry.id,
    title: typeof entry.title === 'string' ? entry.title : '',
    url,
    quote: typeof entry.quote === 'string' ? entry.quote : '',
  }
}

function readCriterion(c: Record<string, unknown>, citations: Record<string, Citation>): CriterionResult {
  const evidence: string[] = []
  for (const entry of Array.isArray(c.evidence) ? c.evidence : []) {
    if (typeof entry === 'string') evidence.push(entry)
    else if (isRecord(entry) && typeof entry.quote === 'string') {
      // The quote inside the evidence, as the server sent it before citations had ids: it is its own citation.
      const id = typeof entry.id === 'string' && entry.id ? entry.id : `${String(entry.chunk_id ?? '')}#${evidence.length}`
      const link = entry.url ?? entry.sec_url
      citations[id] ??= {
        id,
        title: [entry.form, entry.item ? `Item ${String(entry.item)}` : ''].filter(Boolean).join(' · '),
        url: typeof link === 'string' && link.startsWith('https://') ? link : null,
        quote: entry.quote,
      }
      evidence.push(id)
    }
  }
  const gathered = isRecord(c.gathered) ? c.gathered : null
  return {
    id: typeof c.id === 'string' ? c.id : '',
    verdict: typeof c.verdict === 'string' ? c.verdict : '',
    rationale: typeof c.rationale === 'string' ? c.rationale : '',
    verification: typeof c.verification === 'string' ? c.verification : '',
    confidence: typeof c.confidence === 'number' ? c.confidence : null,
    note: typeof c.note === 'string' ? c.note : '',
    evidence,
    gathered: gathered && {
      searched: Array.isArray(gathered.searched) ? gathered.searched.length : 0,
      judged: number(gathered.judged),
      paragraphs: number(gathered.paragraphs),
      relevant: Array.isArray(gathered.good) ? gathered.good.length : 0,
    },
  }
}

/** Where a run is, in one line: how many companies are read, then the counts by verdict. */
export function progressText(progress: Progress, status: RunSnapshot['status']): string {
  const read = progress.total - progress.queued - progress.running
  const head = status === 'done' ? `${progress.total} read` : `reading: ${read} of ${progress.total}`
  const counts = VERDICTS.map((verdict) => `${progress[verdict]} ${verdict}`)
  if (progress.error > 0) counts.push(`${progress.error} error`)
  return `${head} · ${counts.join(' · ')}`
}

/** A verification that did not hold, in words; nothing for one that did, or for a claim of absence, which cites nothing. */
export function verificationMark(verification: string): string | null {
  if (!verification || verification === 'supports' || verification === 'not_checked') return null
  if (verification === 'contradicts') return 'The cited evidence contradicts this verdict.'
  if (verification === 'says_nothing') return 'The cited evidence does not show this.'
  if (verification === 'uncertain') return 'The verifier was not confident the cited evidence carries this verdict.'
  return `Verification: ${verification}.`
}

/** What was searched and read for one criterion, in one line. */
export function gatheredText(gathered: NonNullable<CriterionResult['gathered']>): string {
  const n = (count: number, one: string, many: string): string => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
  return [
    `${n(gathered.searched, 'search', 'searches')} made`,
    `${n(gathered.judged, 'passage', 'passages')} judged`,
    `${n(gathered.paragraphs, 'paragraph', 'paragraphs')} read`,
    `${gathered.relevant.toLocaleString('en-US')} relevant`,
  ].join(', ')
}

/**
 * The open company's evidence as text a model can quote. The first line names what it is, since a
 * citation of the panel takes that line as its title; each quote is followed by its marker, [^id],
 * which the chat resolves against the citations of the same tool result.
 */
export function evidenceText(company: CompanyResult, questions: Criterion[], citations: Record<string, Citation>, runId: string): string {
  const name = company.name ? ` (${company.name})` : ''
  const lines = [`Screener evidence for ${company.ticker ?? `CIK ${company.cik}`}${name}, qualitative run ${runId}: ${company.verdict ?? company.status}`]
  if (company.error) lines.push('', `Error: ${company.error}`)
  for (const c of company.criteria) {
    const question = questions.find((q) => q.id === c.id)?.question
    const confidence = c.confidence === null ? '' : `, confidence ${c.confidence.toFixed(2)}`
    lines.push('', `## ${c.id}${question ? `: ${question}` : ''}`, `Verdict: ${c.verdict} (verification: ${c.verification || 'none'}${confidence})`)
    if (c.rationale) lines.push(`Rationale: ${c.rationale}`)
    if (c.note) lines.push(`Note: ${c.note}`)
    for (const id of c.evidence) {
      const citation = citations[id]
      if (citation) lines.push(`- "${citation.quote}" [^${citation.id}]${citation.title ? ` (${citation.title})` : ''}`)
    }
    if (c.gathered) lines.push(`Retrieval: ${gatheredText(c.gathered)}.`)
  }
  return lines.join('\n')
}

// What the orchestrator reads.

/** What the view publishes: the screen behind the rows on screen, and where the run is. */
export interface Output {
  session_id: string | null
  universe: number
  count: number
  applied_filters: (Filter & { matches: number })[]
  /** The tickers on this page, in order. */
  tickers: string[]
  unknown_tickers: string[]
  sort: Sort
  qualitative_ready: boolean
  qualitative_max: number
  qualitative?: { run_id: string | null; status: string; progress: Progress | null; error?: string }
  open: string
}

/** The app takes 4,096 bytes of output: the tickers at the end of the page give way first. */
export const OUTPUT_BYTES = 3800

export function fitOutput(output: Output): Output {
  let fitted = output
  while (fitted.tickers.length > 0 && byteLength(JSON.stringify(fitted)) > OUTPUT_BYTES) {
    fitted = { ...fitted, tickers: fitted.tickers.slice(0, Math.floor(fitted.tickers.length * 0.8)) }
  }
  return fitted
}

/** The one line the model's map carries: how many pass, of how many, behind which screen, and where the run is. */
export function summarize(state: Partial<State>, output: Partial<Output>): string {
  const n = (value: number | undefined): string => (value ?? 0).toLocaleString('en-US')
  const filters = state.filters ?? []
  const parts = [`Screener: ${n(output.count)} of ${n(output.universe)} pass`]
  if (filters.length > 0) parts[0] += ` ${filters.length} filter${filters.length === 1 ? '' : 's'}`
  if (state.tickers?.length) parts.push(`own list of ${state.tickers.length}`)
  const sort = state.sort ?? DEFAULT_SORT
  parts.push(`sort ${sort.field} ${sort.dir}`)
  const q = output.qualitative
  if (q) {
    const progress = q.progress
    parts.push(
      q.status === 'error'
        ? `qualitative run failed: ${q.error ?? 'unknown error'}`
        : progress
          ? `qualitative run ${q.status}: ${progressText(progress, q.status === 'done' ? 'done' : 'running')}`
          : `qualitative run ${q.status}`,
    )
  } else if (output.qualitative_ready) parts.push('ready for the qualitative stage')
  if (output.open) parts.push(`evidence open for ${output.open}`)
  return parts.join(', ')
}

// Small things.

function parseJson(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A filter by what it says, whatever order its keys were written in. */
function parts(filter: Filter): unknown[] {
  return [filter.field, filter.op, filter.value ?? null]
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** A product or a quotient without the digits floating point adds at the end: 15.3 / 100 is 0.153. */
function clean(value: number): number {
  return Number(value.toPrecision(12))
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}
