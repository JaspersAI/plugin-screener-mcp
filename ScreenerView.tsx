import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useBridge, useData, usePanelState, usePublish, usePublishText, type Bridge, type PanelRef } from '@jaspers-ai/sdk'
import { ColumnsDialog } from './Columns'
import { EvidencePane, type Evidenced } from './Evidence'
import { FilterBar, FilterDialog, type Listed } from './Filters'
import { Funnel } from './Funnel'
import { QualitativeBar, RunProgress } from './Qualitative'
import { Table } from './Table'
import {
  DEFAULT_COLUMNS,
  DEFAULT_SORT,
  echoOf,
  evidenceText,
  fitOutput,
  followArgs,
  inSync,
  mergeRun,
  needsStart,
  overLimit,
  passedTickers,
  publishedFilters,
  readFields,
  readRun,
  readRunText,
  readScreen,
  readStart,
  screenArgs,
  shownColumns,
  stageOf,
  type Criterion,
  type Echo,
  type Filter,
  type Run,
  type RunSnapshot,
  type Sort,
  type State,
  type Verdict,
} from './screener'
import './styles.css'

// The view. Everything it shows comes out of the panel's state: the filters, the list of tickers,
// the sort, the page and the columns go into the screen source's arguments, so changing any re-runs
// it, and the criteria and the run drive the qualitative stage. What is on screen is published
// back, which is how the orchestrator reads the table without being told what is in it.

/** One server page, the most the server sends. The table scrolls it; Prev and Next ask for the next one. */
const PAGE = 200
/**
 * How long one read of a run waits on the server while the run goes on, and so how often the run on
 * screen is brought up to date. The server holds the call that long and answers with the run as it is
 * then; it tells of each company as it finishes only in progress notices, which do not reach a view.
 */
const POLL_SECONDS = 3
const FIELDS = { topic: 'fields' }
const NONE: never[] = []

/** One get_qualitative_screen answer, read: its results are a dataset's rows in main, the rest its meta. */
async function readRunFrom(bridge: Bridge, args: Record<string, unknown>): Promise<RunSnapshot> {
  const result = await bridge.runSource('screener-mcp/qualitative', args, { fresh: true })
  return result.kind === 'dataset' ? readRun(result.meta, await bridge.datasetRows(result.datasetId)) : readRunText(result.text)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The panel's state arrives a round trip after the frame mounts, and the screen is nothing without
 * it: a run with the default filters would ask for the whole universe and publish it as what the
 * user is looking at, for the moment before the real filters land. So the table is a component of
 * its own, mounted once the state is here and handed it as the initial value of every key, which
 * makes its first source run the right one.
 */
export function ScreenerView({ panel }: { panel: PanelRef }): ReactElement {
  const state = useData(`workspaces/${panel.workspaceId}/panels/${panel.id}/state`) as Partial<State> | undefined
  if (state === undefined) {
    return (
      <div className="sc-root">
        <div className="sc-bar">
          <span className="sc-status">Loading…</span>
        </div>
      </div>
    )
  }
  return <Screener panel={panel} initial={state} />
}

function Screener({ panel, initial }: { panel: PanelRef; initial: Partial<State> }): ReactElement {
  const bridge = useBridge()
  const ref = useMemo(() => ({ id: panel.id, workspaceId: panel.workspaceId }), [panel.id, panel.workspaceId])
  // The list and the sort change together with the page, in one write (write, below), so these four are only read here.
  const [filters] = usePanelState<Filter[]>(panel, 'filters', initial.filters ?? NONE)
  const [tickers] = usePanelState<string[]>(panel, 'tickers', initial.tickers ?? NONE)
  const [includeUnlisted] = usePanelState<boolean>(panel, 'includeUnlisted', initial.includeUnlisted ?? false)
  const [sort] = usePanelState<Sort>(panel, 'sort', initial.sort ?? DEFAULT_SORT)
  const [page, setPage] = usePanelState<number>(panel, 'page', initial.page ?? 0)
  const [columns, setColumns] = usePanelState<string[]>(panel, 'columns', initial.columns ?? DEFAULT_COLUMNS)
  const [criteria, setCriteria] = usePanelState<Criterion[]>(panel, 'criteria', initial.criteria ?? NONE)
  // A key that holds null reads as its initial value, so "no run" is the initial value: a run that
  // is in the state arrives with the first push, a moment later, and nothing acts on its absence.
  const [run, setRun] = usePanelState<Run | null>(panel, 'run', null)
  const [verdicts, setVerdicts] = usePanelState<Verdict[]>(panel, 'verdicts', initial.verdicts ?? NONE)
  const [open, setOpen] = usePanelState<string>(panel, 'open', initial.open ?? '')
  const [dialog, setDialog] = useState<'filters' | 'columns' | null>(null)

  // The connections' statuses, so a run asked for while the server is still connecting starts once
  // it is ready instead of failing.
  const connections = useData('connections') as Record<string, { status?: string }> | undefined
  const connectionsKey = JSON.stringify(Object.values(connections ?? {}).map((c) => c.status))

  // The fields are the server's: what can be filtered, how, and in which unit a number reads.
  const guide = useData('screener-mcp/guide', FIELDS)
  const fields = useMemo(() => readFields(guide.data), [guide.data])
  const fieldMap = useMemo(() => new Map(fields.map((field) => [field.field, field])), [fields])
  const fieldsError = guide.error ?? (guide.text !== undefined ? 'This server\'s guide does not list its fields as rows.' : null)

  // The screen. The server keeps the list in a session, so what one call sends depends on what the
  // session already holds (screenArgs). The arguments are made when what is asked for changes, not
  // when an answer lands: the session id an answer brings is for the next call and must not cause one.
  const session = useRef<string | null>(initial.sessionId ?? null)
  const echo = useRef<Echo | null>(null)
  const [again, setAgain] = useState(0)
  const asked = JSON.stringify([filters, tickers, includeUnlisted, sort, page, columns, again])
  const args = useMemo(
    () => screenArgs({ filters, tickers, includeUnlisted, sort, page, columns, sessionId: session.current }, echo.current, PAGE),
    [asked],
  )
  const { data, loading, error, meta } = useData('screener-mcp/screen', args)
  const screen = useMemo(() => readScreen(meta), [meta])
  const rows = data ?? NONE
  /** The session holds the list on screen and no call is out: what a run would freeze is what the user sees. */
  const settled = !loading && !error && screen !== null && inSync({ filters, tickers, includeUnlisted, sessionId: screen.sessionId }, echoOf(screen))

  useEffect(() => {
    if (!screen?.sessionId) return
    echo.current = echoOf(screen)
    if (session.current === screen.sessionId) return
    session.current = screen.sessionId
    void bridge.setState(ref, ['sessionId'], screen.sessionId)
  }, [bridge, ref, screen])

  // A session the server no longer has (another server, a database set up again): start a new one.
  useEffect(() => {
    if (!error || !session.current || !/No screening session/.test(error)) return
    session.current = null
    echo.current = null
    void bridge.setState(ref, ['sessionId'], null)
    setAgain((n) => n + 1)
  }, [bridge, ref, error])

  // A list that got shorter than the page it is on, as when the orchestrator sets filters and not the page.
  useEffect(() => {
    if (screen && !loading && page > 0 && page * PAGE >= screen.count) setPage(0)
  }, [screen, loading, page, setPage])

  /**
   * Several keys in one write, so a change of two things is one re-run and not two. The rest of the
   * state is read from the app at that moment, not from this render: a run's id that landed a
   * moment ago must not be written over by what the view knew before it.
   */
  async function write(patch: Partial<State>): Promise<void> {
    const current = (await bridge.get(`workspaces/${ref.workspaceId}/panels/${ref.id}/state`)) as Partial<State> | undefined
    await bridge.setState(ref, [], { ...current, ...patch })
  }

  /** A new list starts at its first page, whichever control asked for it. */
  function changeListed(next: Listed): void {
    void write({ ...next, page: 0 })
  }

  /** A failed start is asked for again; a run that could not be read is read again. */
  function retry(): void {
    if (!run?.id) {
      setRun({})
      return
    }
    setRun({ id: run.id, status: 'running' })
    setReadAgain((n) => n + 1)
  }

  function toggleSort(field: string): void {
    void write({ sort: sort.field === field && sort.dir === 'desc' ? { field, dir: 'asc' } : { field, dir: 'desc' }, page: 0 })
  }

  // The qualitative stage. A `run` with no id is the request (needsStart); the view starts it over
  // the session's list, once that list is the one on screen. It costs model calls for every company,
  // so nothing here may start one twice: the latch holds from the call until the run's id is in the state.
  const starting = useRef(false)
  useEffect(() => {
    if (run === null || run.id) starting.current = false
    if (!needsStart(criteria, run) || starting.current || !screen || !settled) return
    if (!screen.ready || !screen.sessionId) {
      setRun({ status: 'error', error: overLimit(screen) })
      return
    }
    starting.current = true
    void (async () => {
      try {
        const result = await bridge.runSource('screener-mcp/qualitative-start', { session_id: screen.sessionId, criteria })
        const started = readStart(result.kind === 'text' ? result.text : JSON.stringify(result.meta))
        // Written whether or not the view is still mounted: a run that was started must not be lost.
        setRun({ id: started.runId, status: 'running' })
      } catch (err) {
        starting.current = false
        const text = err instanceof Error ? err.message : String(err)
        // Not ready yet: the request stays as it is and this runs again when a connection changes.
        if (/connection_unavailable/.test(text) && /connecting/.test(text)) return
        setRun({ status: 'error', error: text })
      }
    })()
  }, [bridge, criteria, run, screen, settled, setRun, connectionsKey])

  // A run is followed until it is done. The first read is the whole run, at once, so a panel that
  // comes back to a run shows where it is; each one after waits on the server a few seconds and asks
  // only for the companies not yet over (followArgs), so the loop is one small request in flight at a
  // time, never a burst, and a company's answers are fetched once. Results come without evidence:
  // that is asked for one company at a time, below.
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null)
  const [readAgain, setReadAgain] = useState(0)
  /** Each opened company's evidence, and the answer it was read for. */
  const evidence = useRef(new Map<string, { key: string; found: Evidenced }>())
  const runId = run?.id
  const status = useRef(run?.status)
  status.current = run?.status
  const chosen = useRef(verdicts)
  chosen.current = verdicts
  useEffect(() => {
    if (!runId) {
      setSnapshot(null)
      evidence.current.clear()
      return
    }
    let live = true
    void (async () => {
      let seen: RunSnapshot | null = null
      while (live) {
        const asked = Date.now()
        let next: RunSnapshot
        try {
          const read = await readRunFrom(bridge, followArgs(runId, seen, POLL_SECONDS))
          if (!live) return
          next = seen ? mergeRun(seen, read) : read
          // A run that ended while it was followed is read whole once more: the reads before this one each held some of its companies.
          if (seen && next.status === 'done') {
            next = await readRunFrom(bridge, followArgs(runId, null, 0))
            if (!live) return
          }
        } catch (err) {
          if (!live) return
          const text = err instanceof Error ? err.message : String(err)
          if (/connection_unavailable/.test(text) && /connecting/.test(text)) return
          setRun({ id: runId, status: 'error', error: text })
          return
        }
        setSnapshot(next)
        const now = next.status === 'done' ? 'done' : 'running'
        // A run that finishes shows who passed: until then the rows were only the list being read, and
        // left as they are they read as the answer. A verdict filter somebody already chose stays.
        if (status.current !== now && now === 'done' && chosen.current.length === 0) void write({ run: { id: runId, status: now }, verdicts: ['pass'] })
        else if (status.current !== now) setRun({ id: runId, status: now })
        if (next.status === 'done') return
        // The pace is the server's, which holds each read after the first. One that answers sooner is not asked again at once.
        if (seen) await sleep(POLL_SECONDS * 1000 - (Date.now() - asked))
        seen = next
      }
    })()
    return () => {
      live = false
    }
  }, [bridge, runId, readAgain, setRun, connectionsKey])

  // The open company's evidence: one call for that company, when its row is opened and again when
  // its answer changes. Quotes stay here, not in state: a company's worth is most of the output
  // budget, and a list's worth is far past it.
  const [shown, setShown] = useState<{ ticker: string; found: Evidenced | null; error: string | null } | null>(null)
  const openResult = open ? snapshot?.results.find((result) => result.ticker === open) : undefined
  const openKey = open && runId && snapshot ? `${runId}|${open}|${openResult?.status ?? ''}|${openResult?.verdict ?? ''}` : ''
  useEffect(() => {
    if (!openKey || !runId) {
      setShown(null)
      return
    }
    const kept = evidence.current.get(open)
    setShown({ ticker: open, found: kept?.found ?? null, error: null })
    if (kept?.key === openKey) return
    let live = true
    void (async () => {
      try {
        const read = await readRunFrom(bridge, { run_id: runId, tickers: [open], evidence: true })
        if (!live) return
        const company = read.results[0]
        if (!company) throw new Error(`The run has no company with the ticker ${open}.`)
        evidence.current.set(open, { key: openKey, found: { company, citations: read.citations } })
        setShown({ ticker: open, found: { company, citations: read.citations }, error: null })
      } catch (err) {
        if (live) setShown({ ticker: open, found: null, error: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      live = false
    }
  }, [bridge, runId, open, openKey])

  const results = useMemo(() => new Map((snapshot?.results ?? []).map((result) => [result.cik, result])), [snapshot])
  const visible = useMemo(() => {
    if (!snapshot || verdicts.length === 0) return rows
    return rows.filter((row) => {
      const verdict = results.get(Number(row.cik))?.verdict
      return verdict !== null && verdict !== undefined && verdicts.includes(verdict)
    })
  }, [rows, snapshot, results, verdicts])

  usePublish(panel, {
    ...fitOutput({
      session_id: screen?.sessionId ?? null,
      universe: screen?.universe ?? 0,
      count: screen?.count ?? 0,
      applied_filters: publishedFilters(screen),
      tickers: visible.map((row) => row.ticker).filter((ticker): ticker is string => typeof ticker === 'string'),
      unknown_tickers: screen?.unknownTickers ?? [],
      sort,
      qualitative_ready: screen?.ready ?? false,
      qualitative_max: screen?.max ?? 0,
      qualitative: run
        ? {
            run_id: run.id ?? null,
            status: stageOf(criteria, run),
            progress: snapshot?.progress ?? null,
            ...(snapshot?.phase ? { earnings_calls: snapshot.phase } : {}),
            ...(snapshot ? { passed: passedTickers(snapshot) } : {}),
            ...(run.error ? { error: run.error } : {}),
          }
        : undefined,
      open,
    }),
  })
  // The open company's evidence as text, for a model to quote: every quote carries its [^id].
  usePublishText(panel, shown?.found && runId ? evidenceText(shown.found.company, snapshot?.criteria ?? criteria, shown.found.citations, runId) : null)

  const hasNext = (page + 1) * PAGE < (screen?.count ?? 0)
  const listed: Listed = { filters, tickers, includeUnlisted }

  return (
    <div className="sc-root">
      <div className="sc-bar sc-top">
        <FilterBar listed={listed} fields={fieldMap} onChange={changeListed} onOpen={() => setDialog('filters')} onColumns={() => setDialog('columns')} />
        <span className="sc-count">
          {visible.length} shown of {(screen?.count ?? 0).toLocaleString('en-US')}
        </span>
      </div>

      <Funnel listed={listed} screen={screen} loading={loading} fields={fieldMap}>
        <RunProgress criteria={criteria} run={run} snapshot={snapshot} />
      </Funnel>

      <QualitativeBar
        criteria={criteria}
        onCriteria={setCriteria}
        run={run}
        snapshot={snapshot}
        screen={screen}
        settled={settled}
        verdicts={verdicts}
        onVerdicts={setVerdicts}
        onRun={() => setRun({})}
        onRetry={retry}
        onClear={() => void write({ run: null, verdicts: [], open: '' })}
      />

      <Table
        rows={visible}
        columns={shownColumns(filters, sort, columns)}
        fields={fieldMap}
        sort={sort}
        onSort={toggleSort}
        loading={loading && data === undefined}
        stale={loading && data !== undefined}
        empty={snapshot && verdicts.length > 0 && rows.length > 0 ? `No company on this page is ${verdicts.join(' or ')}. The verdict buttons above show the others.` : 'No companies match.'}
        run={snapshot ? { criteria: snapshot.criteria, results } : null}
        open={open}
        onOpen={(ticker) => setOpen(ticker === open ? '' : ticker)}
      />

      {open && runId && (
        <EvidencePane
          ticker={open}
          evidence={shown?.ticker === open ? shown.found : null}
          error={shown?.ticker === open ? shown.error : null}
          questions={snapshot?.criteria ?? criteria}
          onClose={() => setOpen('')}
          onLink={(url) => void bridge.openLink(url)}
        />
      )}

      <div className="sc-bar sc-foot">
        <button type="button" className="sc-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Prev
        </button>
        <button type="button" className="sc-btn" disabled={!hasNext} onClick={() => setPage(page + 1)}>
          Next
        </button>
        <span className="sc-status">Page {page + 1}</span>
        {/* The source's own words, which is how a refused filter or a server that is not running reaches the user. */}
        <span className={error ? 'sc-error' : 'sc-status'} style={{ marginLeft: 'auto' }}>
          {error ?? (loading ? 'Loading…' : '')}
        </span>
      </div>

      {dialog === 'filters' && (
        <FilterDialog
          listed={listed}
          fields={fields}
          fieldsError={fieldsError}
          onApply={(next) => {
            changeListed(next)
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'columns' && (
        <ColumnsDialog
          columns={columns}
          fields={fields}
          fieldsError={fieldsError}
          onApply={(next) => {
            setColumns(next)
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
