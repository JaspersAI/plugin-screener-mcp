import { useState, type ReactElement } from 'react'
import { MAX_CRITERIA, progressText, slug, VERDICTS, type Criterion, type Run, type RunSnapshot, type Screen, type Verdict } from './screener'

// The qualitative stage's bar: the criteria in words, the button that has every company on the list
// read against them, and where that run is. A run costs model calls for every company, so it starts
// on the button (or on the orchestrator's word, which is the same write), never on a criterion alone.

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
  const busy = run !== null && run.status !== 'done' && run.status !== 'error'

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
          snapshot={snapshot}
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

interface StatusProps extends Pick<Props, 'run' | 'snapshot' | 'screen' | 'settled' | 'onRun' | 'onRetry' | 'onClear'> {
  /** There is at least one criterion. */
  ready: boolean
}

function RunStatus({ run, snapshot, screen, settled, ready, onRun, onRetry, onClear }: StatusProps): ReactElement | null {
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
  return (
    <>
      <span className="sc-status">{snapshot ? progressText(snapshot.progress, snapshot.status) : run.id ? 'Reading the run…' : 'Starting…'}</span>
      {/* There is no stopping a run: clearing takes it off this panel, and the server goes on reading. */}
      {run.id && (
        <button type="button" className="sc-btn" onClick={onClear} title="Takes the run off this panel. The server keeps it, and finishes it if it is still going.">
          Clear
        </button>
      )}
    </>
  )
}
