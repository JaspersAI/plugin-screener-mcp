import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { Listed } from './Filters'
import { commonPrefix, filterText, funnelRows, funnelStates, removedText, type Field, type FunnelRow, type RowState, type Screen } from './screener'

// The funnel: the screen as it goes. A row for the universe and one for each filter in its turn —
// how many companies it left, how many it removed, and the first of those by name — and under them
// the row of the stage after the filters. The rows are the state's, so they are on screen before the
// server has answered, and they fill in from the top: the rows of an answer are shown one after
// another, so a list that was narrowed in one call still reads as the narrowing it was.

/** How long a row of an answer waits for the row before it. */
const ROW_MS = 320

interface Props {
  listed: Listed
  screen: Screen | null
  /** A screen call is out. */
  loading: boolean
  fields: Map<string, Field>
  /** The row of the stage after the filters. */
  children?: ReactNode
}

export function Funnel({ listed, screen, loading, fields, children }: Props): ReactElement {
  const { filters, tickers, includeUnlisted } = listed
  const rows = useMemo(() => funnelRows({ filters, tickers, includeUnlisted }, screen), [filters, tickers, includeUnlisted, screen])
  const unanswered = rows.findIndex((row) => !row.answer)
  const answered = unanswered < 0 ? rows.length : unanswered
  const shown = useShown(rows.slice(0, answered).map((row) => row.key))
  const states = funnelStates(rows.length, answered, shown, loading)
  // What the list was before its last change is said of the list, so on its last row, and only by an answer that is of this list.
  const whole = screen !== null && answered === rows.length && screen.applied.length === filters.length
  const before = whole && screen.countBefore !== screen.count ? screen.countBefore : null
  return (
    <div className="sc-funnel" aria-busy={states.includes('working')}>
      {rows.map((row, at) => (
        <Step key={row.key} row={row} state={states[at]!} fields={fields} before={at === rows.length - 1 ? before : null}>
          {at === 0 && (
            <>
              {tickers.length > 0 ? 'Own list' : includeUnlisted ? 'All companies, unlisted too' : 'Listed companies'}
              {screen && screen.unknownTickers.length > 0 && <span className="sc-error"> · no company for {screen.unknownTickers.join(', ')}</span>}
            </>
          )}
        </Step>
      ))}
      {children}
    </div>
  )
}

/**
 * How many of the rows with an answer are on screen. The ones that were there stay; the rest come one
 * at a time, the first of an answer at once. Someone who asked for less motion gets them all at once.
 */
function useShown(keys: string[]): number {
  const [seen, setSeen] = useState<string[]>([])
  const shown = commonPrefix(seen, keys)
  const all = keys.join('\n')
  /** The answer whose first row has been shown. */
  const begun = useRef<string | null>(null)
  useEffect(() => {
    if (shown >= keys.length) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = setTimeout(
      () => {
        begun.current = all
        setSeen(keys.slice(0, still ? keys.length : shown + 1))
      },
      begun.current === all ? ROW_MS : 0,
    )
    return () => clearTimeout(timer)
    // `keys` is read through `all`, its value: it is a new list every render.
  }, [all, shown])
  return shown
}

interface StepProps {
  row: FunnelRow
  state: RowState
  fields: Map<string, Field>
  /** What the list was before its last change, on the row that says what it is now. */
  before: number | null
  /** What the row of the universe says it is. */
  children?: ReactNode
}

function Step({ row, state, fields, before, children }: StepProps): ReactElement {
  const field = row.filter ? fields.get(row.filter.field) : undefined
  const what = row.filter ? filterText(row.filter, field) : null
  const answer = state === 'done' ? row.answer : null
  const named = answer?.removed ?? []
  const more = answer && answer.out !== null ? answer.out - named.length : 0
  return (
    <div className={`sc-step sc-step-${state}`}>
      <Mark state={state} />
      <span className="sc-step-what" title={what ?? undefined}>
        {what ?? children}
      </span>
      {state === 'working' && <span className="sc-step-note">screening…</span>}
      {answer && (
        <>
          <span className="sc-step-n" title={answer.matches === null ? undefined : `${n(answer.matches)} pass this filter on its own`}>
            {answer.left !== null ? (
              <>
                <b>{n(answer.left)}</b>
                {row.filter && ' left'}
              </>
            ) : (
              // A server that does not say what a filter left says what it passes alone.
              answer.matches !== null && (
                <>
                  <b>{n(answer.matches)}</b> on its own
                </>
              )
            )}
            {before !== null && <> (was {n(before)})</>}
          </span>
          <span className="sc-step-n">{answer.out !== null && `${n(answer.out)} out`}</span>
          <span className="sc-step-names">
            {named.length > 0 && (
              <span className="sc-names" title={`The first of them in the table's order: ${named.map((company) => company.name ?? company.ticker ?? '—').join(', ')}`}>
                {named.map((company) => removedText(company, field)).join(' · ')}
              </span>
            )}
            {named.length > 0 && more > 0 && <span className="sc-names-more">+{n(more)}</span>}
          </span>
        </>
      )}
    </div>
  )
}

/** A row's mark: a tick once it is in, a square while it is at work (CSS has it pulse) or still to come. */
export function Mark({ state }: { state: RowState }): ReactElement {
  return (
    <span className="sc-step-mark" aria-hidden="true">
      {state === 'done' && '✓'}
    </span>
  )
}

function n(value: number): string {
  return value.toLocaleString('en-US')
}
