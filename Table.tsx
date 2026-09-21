import type { ReactElement } from 'react'
import { cellText, fieldLabel, signOf, verificationMark, type CompanyResult, type Criterion, type Field, type Sort } from './screener'

// The table: the company, a run's verdicts when there is one, then the fields filtered, sorted and
// asked for. A header sorts, and sorting is the server's job — the sort goes into the panel's
// state, the state into the source's arguments — so a click here is a change of state like any the
// orchestrator makes.

interface Props {
  rows: Record<string, unknown>[]
  columns: string[]
  fields: Map<string, Field>
  sort: Sort
  onSort: (field: string) => void
  /** Nothing is drawn as empty while the first run is still out. */
  loading: boolean
  /** A qualitative run's criteria and what it found, by CIK. */
  run: { criteria: Criterion[]; results: Map<number, CompanyResult> } | null
  /** The ticker whose evidence is open. */
  open: string
  onOpen: (ticker: string) => void
}

export function Table({ rows, columns, fields, sort, onSort, loading, run, open, onOpen }: Props): ReactElement {
  return (
    <div className="sc-table-wrap">
      <table className="sc-table">
        <thead>
          <tr>
            <th className="sc-company">Company</th>
            {run && <th className="sc-verdict-head">Verdict</th>}
            {run?.criteria.map((criterion) => (
              <th key={criterion.id} className="sc-verdict-head" title={criterion.question}>
                {criterion.id}
              </th>
            ))}
            {columns.map((column) => {
              const field = fields.get(column)
              return (
                <th key={column} className="sc-num" title={field?.description}>
                  {/* The server refuses a sort on a list, so its header is not a button. */}
                  {field && !field.sortable ? (
                    <span className="sc-sort">{fieldLabel(column)}</span>
                  ) : (
                    <button type="button" className="sc-sort" onClick={() => onSort(column)}>
                      {fieldLabel(column)}
                      {sort.field === column ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </button>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const ticker = typeof row.ticker === 'string' ? row.ticker : null
            const result = run?.results.get(Number(row.cik))
            return (
              <tr key={String(row.cik ?? ticker ?? index)} className={ticker !== null && ticker === open ? 'sc-row-open' : undefined}>
                <td className="sc-company">
                  {result && ticker ? (
                    <button type="button" className="sc-ticker sc-ticker-open" title="Show the evidence" onClick={() => onOpen(ticker)}>
                      {ticker}
                    </button>
                  ) : (
                    <span className="sc-ticker">{ticker ?? '—'}</span>
                  )}
                  <span className="sc-name" title={typeof row.sic_description === 'string' ? row.sic_description : undefined}>
                    {String(row.name ?? '')}
                  </span>
                </td>
                {run && <Verdict result={result} />}
                {run?.criteria.map((criterion) => <CriterionCell key={criterion.id} result={result} id={criterion.id} />)}
                {columns.map((column) => {
                  const sign = signOf(column, row[column])
                  return (
                    <td key={column} className={sign ? `sc-num sc-${sign}` : 'sc-num'}>
                      {cellText(row[column], fields.get(column))}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && !loading && <p className="sc-empty">No companies match.</p>}
    </div>
  )
}

/** A company's verdict over all its criteria, or where it is in the run. */
function Verdict({ result }: { result: CompanyResult | undefined }): ReactElement {
  if (!result) return <td className="sc-verdict sc-status">—</td>
  if (result.status === 'error') {
    return (
      <td className="sc-verdict sc-error" title={result.error ?? undefined}>
        error
      </td>
    )
  }
  if (result.status !== 'done') return <td className="sc-verdict sc-status">{result.status === 'running' ? 'reading…' : 'queued'}</td>
  const verdict = result.verdict ?? 'unverified'
  return <td className={`sc-verdict sc-v-${verdict}`}>{verdict}</td>
}

/** One criterion's answer; a verification that did not hold is marked, with what was wrong as its tooltip. */
function CriterionCell({ result, id }: { result: CompanyResult | undefined; id: string }): ReactElement {
  const answer = result?.criteria.find((criterion) => criterion.id === id)
  if (!answer) return <td className="sc-verdict sc-status">—</td>
  const mark = verificationMark(answer.verification)
  return (
    <td className={`sc-verdict sc-v-${answer.verdict}`} title={mark ?? answer.rationale}>
      {answer.verdict}
      {mark && <span className="sc-mark"> !</span>}
    </td>
  )
}
