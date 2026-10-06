import { useEffect, useState, type ReactElement } from 'react'
import { Mark } from './Funnel'
import {
  doingText,
  elapsedText,
  finished,
  MAX_CRITERIA,
  slug,
  stageOf,
  verdictTickers,
  VERDICTS,
  type Criterion,
  type Progress,
  type RowState,
  type Run,
  type RunSnapshot,
  type Screen,
  type Verdict,
} from './screener'

// The qualitative stage, in two parts. Its bar: the criteria in words, and the button that has every
// company on the list read against them. A run costs model calls for every company, so it starts on
// the button (or on the orchestrator's word, which is the same write), never on a criterion alone.
// And where a run is, which is the funnel's last row (RunProgress): the list goes on being narrowed
// there, by reading instead of by a filter.

interface Props {
  criteria: Criterion[]
  onCriteria: (next: Criterion[]) => void
  run: Run | null
  snapshot: RunSnapshot | null
  screen: Screen | null
  /** The server's session holds the list on screen and no screen call is out, so a run would freeze the right list. */
  settled: boolean
  verdicts: Verdict[]
  onVerdicts: (next: Verdict[]) => void
  onRun: () => void
  onRetry: () => void
  onClear: () => void
}

export function QualitativeBar(props: Props): ReactElement {
  const { criteria, onCriteria, run, snapshot, screen, settled, verdicts, onVerdicts, onRun, onRetry, onClear } = props
  const [question, setQuestion] = useState('')
  const [problem, setProblem] = useState('')
  // The criteria stand while a run is starting or going on. A run asked for with none is waiting for one, so the editor stays.
  const stage = stageOf(criteria, run)
  const busy = stage === 'starting' || stage === 'running'

  function add(): void {
    const typed = question.trim()
    // The server's own bounds on a criterion, said before it has to refuse.
    if (typed.length < 5 || typed.length > 500) {
      setProblem('A criterion is a question of 5 to 500 characters.')
      return
    }
    onCriteria([...criteria, { id: slug(typed, criteria.map((c) => c.id)), question: typed }])
    setQuestion('')
    setProblem('')
  }

  return (
    <div className="sc-bar">
      <span className="sc-status">Criteria</span>
      {criteria.map((criterion) => (
        <span key={criterion.id} className="sc-chip sc-q" title={`${criterion.id}: ${criterion.question}`}>
          <span className="sc-q-text">{criterion.question}</span>
          <button
            type="button"
            className="sc-chip-x"
            aria-label={`Remove ${criterion.question}`}
            disabled={busy}
            onClick={() => onCriteria(criteria.filter((c) => c.id !== criterion.id))}
          >
            ×
          </button>
        </span>
      ))}
      {!busy && criteria.length < MAX_CRITERIA && (
        <>
          <input
            className="sc-input sc-q-input"
            aria-label="A criterion, as a yes or no question"
            placeholder="A yes/no question the filings can answer, e.g. Does the company depend on a sole-source supplier?"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add()
            }}
          />
          <button type="button" className="sc-btn" disabled={!question.trim()} onClick={add}>
            Add
          </button>
        </>
      )}
      {problem && <span className="sc-error">{problem}</span>}

      <span className="sc-run">
        <RunStatus
          run={run}
          screen={screen}
          settled={settled}
          ready={criteria.length > 0}
          onRun={onRun}
          onRetry={onRetry}
          onClear={onClear}
        />
      </span>

      {snapshot && (
        <span className="sc-verdicts">
          {VERDICTS.map((verdict) => {
            const on = verdicts.includes(verdict)
            return (
              <button
                key={verdict}
                type="button"
                className={on ? `sc-btn sc-toggle sc-on sc-v-${verdict}` : `sc-btn sc-toggle sc-v-${verdict}`}
                aria-pressed={on}
                title={on ? `Showing ${verdict}; click to stop filtering on it` : `Show only ${verdict}`}
                onClick={() => onVerdicts(on ? verdicts.filter((v) => v !== verdict) : [...verdicts, verdict])}
              >
                {verdict} {snapshot.progress[verdict]}
              </button>
            )
          })}
        </span>
      )}
    </div>
  )
}

interface StatusProps extends Pick<Props, 'run' | 'screen' | 'settled' | 'onRun' | 'onRetry' | 'onClear'> {
  /** There is at least one criterion. */
  ready: boolean
}

/** What can be done about a run: start one, try a failed one again, take one off the panel. Where a run is, the funnel says. */
function RunStatus({ run, screen, settled, ready, onRun, onRetry, onClear }: StatusProps): ReactElement | null {
  if (run === null) {
    if (!screen) return null
    if (!screen.ready) {
      const over = screen.count - screen.max
      return (
        <span className="sc-status">
          {screen.count === 0 ? 'Nothing to read' : `${over.toLocaleString('en-US')} over the ${screen.max} the qualitative stage takes`}
        </span>
      )
    }
    return (
      <button
        type="button"
        className="sc-btn sc-primary"
        disabled={!ready || !settled}
        onClick={onRun}
        title="Every company on the list is read against every criterion. It costs model calls for each."
      >
        Run on {screen.count} {screen.count === 1 ? 'company' : 'companies'}
      </button>
    )
  }
  if (run.status === 'error') {
    return (
      <>
        <span className="sc-error">{run.error ?? 'The run failed.'}</span>
        <button type="button" className="sc-btn" onClick={onRetry}>
          {run.id ? 'Read again' : 'Try again'}
        </button>
        <button type="button" className="sc-btn" onClick={onClear}>
          Clear
        </button>
      </>
    )
  }
  // There is no stopping a run: clearing takes it off this panel, and the server goes on reading.
  if (!run.id) return null
  return (
    <button type="button" className="sc-btn" onClick={onClear} title="Takes the run off this panel. The server keeps it, and finishes it if it is still going.">
      Clear
    </button>
  )
}

interface ProgressProps {
  criteria: Criterion[]
  run: Run | null
  snapshot: RunSnapshot | null
}

/**
 * The qualitative stage as a row of the funnel: still to come, at work, or in. While a run goes on it
 * says what the run is doing and for how long, draws how far it is, and names who has passed and who
 * has failed as each company's verdict lands. Why a run failed is said in the bar, beside the button
 * that tries it again.
 */
export function RunProgress({ criteria, run, snapshot }: ProgressProps): ReactElement {
  const stage = stageOf(criteria, run)
  const state: RowState = stage === 'done' ? 'done' : stage === 'starting' || stage === 'running' ? 'working' : 'pending'
  const now = useNow(stage === 'running' && snapshot?.status !== 'done')
  const clock = snapshot && elapsedText(snapshot, now)
  const fetching = snapshot?.status !== 'done' && snapshot?.phase?.status === 'fetching' ? snapshot.phase : null
  return (
    <div className={`sc-step sc-step-${state}`}>
      <Mark state={state} />
      <span className="sc-step-what">
        Criteria{criteria.length > 0 && ` · ${criteria.length} ${criteria.length === 1 ? 'question' : 'questions'}`}
      </span>
      <span className="sc-step-run">
        {stage === 'no_criteria' && <span>A run was asked for. Add a criterion and it starts.</span>}
        {stage === 'starting' && <span className="sc-step-note">starting…</span>}
        {stage === 'error' && <span className="sc-error">failed</span>}
        {(stage === 'running' || stage === 'done') && !snapshot && <span className="sc-step-note">reading the run…</span>}
        {(stage === 'running' || stage === 'done') && snapshot && (
          <>
            <span className="sc-step-note">
              {doingText(snapshot)}
              {clock && ` · ${clock}`}
            </span>
            {snapshot.phase?.status === 'off' && <span title="The run could not fetch its companies' earnings calls, so it reads their filings alone.">filings only</span>}
            {fetching ? (
              <Meter label="Companies whose earnings calls are in" done={fetching.done} parts={[['fetched', fetching.done], ['queued', fetching.total - fetching.done]]} />
            ) : (
              <Meter label="Companies read" done={finished(snapshot.progress)} parts={SEGMENTS.map((key) => [key, snapshot.progress[key]])} />
            )}
            <Names verdict="pass" count={snapshot.progress.pass} tickers={verdictTickers(snapshot, 'pass')} />
            <Names verdict="fail" count={snapshot.progress.fail} tickers={verdictTickers(snapshot, 'fail')} />
          </>
        )}
      </span>
    </div>
  )
}

/** The order a run's companies are drawn in along its meter: what was found, then what is still to be. */
const SEGMENTS = ['pass', 'unverified', 'unclear', 'fail', 'error', 'running', 'queued'] as const satisfies readonly (keyof Progress)[]

/** How far something is, as one bar cut into its parts, each as wide as its count. */
function Meter({ label, done, parts }: { label: string; done: number; parts: [key: string, count: number][] }): ReactElement {
  const total = parts.reduce((sum, [, count]) => sum + count, 0)
  return (
    <span className="sc-meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      {parts.map(([key, count]) => count > 0 && <i key={key} className={`sc-seg sc-seg-${key}`} style={{ flexGrow: count }} title={`${count} ${key}`} />)}
    </span>
  )
}

/** How many companies have one verdict, and who: the tickers in the verdict's colour, as many as there is room for. Nothing until one has it. */
function Names({ verdict, count, tickers }: { verdict: Verdict; count: number; tickers: string[] }): ReactElement | null {
  if (count === 0) return null
  return (
    <span className={`sc-step-verdict sc-v-${verdict}`} title={tickers.join(', ') || undefined}>
      <span>
        <b>{count}</b> {verdict}
      </span>
      {tickers.length > 0 && <span className="sc-names">{tickers.join(' · ')}</span>}
    </span>
  )
}

/** The time now, once a second while something is going on. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}
