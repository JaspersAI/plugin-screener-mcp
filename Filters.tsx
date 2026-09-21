import { useState, type KeyboardEvent, type ReactElement } from 'react'
import {
  fieldLabel,
  filterText,
  fromDraft,
  groupFields,
  opText,
  readTickers,
  toDraft,
  unitHint,
  type Draft,
  type Field,
  type Filter,
  type Op,
} from './screener'

// What is filtered, and how it is changed by hand: one chip per filter with a cross, and a dialog
// over the view to add and edit them. The dialog edits a draft and writes the list once, on Apply,
// because the orchestrator writes it the same way — the complete set, one re-run. Which fields
// there are, and what each takes, comes from the server's guide.

/** The part of the state that says which companies are on the list. */
export interface Listed {
  filters: Filter[]
  tickers: string[]
  includeUnlisted: boolean
}

interface BarProps {
  listed: Listed
  fields: Map<string, Field>
  onChange: (next: Listed) => void
  /** Opens the dialog, from its button or from a chip: a filter is edited where the rest are. */
  onOpen: () => void
  onColumns: () => void
}

export function FilterBar({ listed, fields, onChange, onOpen, onColumns }: BarProps): ReactElement {
  const { filters, tickers, includeUnlisted } = listed
  return (
    <>
      <button type="button" className="sc-btn" onClick={onOpen}>
        Filters
      </button>
      <button type="button" className="sc-btn" onClick={onColumns}>
        Columns
      </button>
      {tickers.length > 0 && (
        <Chip
          label={tickers.length <= 3 ? tickers.join(', ') : `Own list of ${tickers.length}`}
          onOpen={onOpen}
          onRemove={() => onChange({ ...listed, tickers: [] })}
        />
      )}
      {filters.map((filter, index) => (
        <Chip
          key={`${index}:${filter.field}`}
          label={filterText(filter, fields.get(filter.field))}
          onOpen={onOpen}
          onRemove={() => onChange({ ...listed, filters: filters.filter((_, i) => i !== index) })}
        />
      ))}
      {includeUnlisted && <Chip label="Incl. unlisted" onOpen={onOpen} onRemove={() => onChange({ ...listed, includeUnlisted: false })} />}
    </>
  )
}

function Chip({ label, onOpen, onRemove }: { label: string; onOpen: () => void; onRemove: () => void }): ReactElement {
  return (
    <span className="sc-chip">
      <button type="button" className="sc-chip-label" onClick={onOpen} title="Edit">
        {label}
      </button>
      <button type="button" className="sc-chip-x" aria-label={`Remove ${label}`} onClick={onRemove}>
        ×
      </button>
    </span>
  )
}

interface DialogProps {
  listed: Listed
  fields: Field[]
  /** Why there are no fields to pick from, when there are none. */
  fieldsError: string | null
  onApply: (next: Listed) => void
  onClose: () => void
}

/** A row of the dialog: the filter as typed, and the filter it came from while nobody has touched it. */
interface Row extends Draft {
  original?: Filter
}

const NEW_ROW: Row = { field: '', op: 'gte', a: '', b: '' }

export function FilterDialog({ listed, fields, fieldsError, onApply, onClose }: DialogProps): ReactElement {
  const byName = new Map(fields.map((field) => [field.field, field]))
  // The dialog is mounted when it opens, so the draft is seeded once, here, rather than in an effect.
  const [rows, setRows] = useState<Row[]>(() => listed.filters.map((filter) => ({ ...toDraft(filter, byName.get(filter.field)), original: filter })))
  const [tickers, setTickers] = useState(listed.tickers.join(' '))
  const [includeUnlisted, setIncludeUnlisted] = useState(listed.includeUnlisted)
  const [errors, setErrors] = useState<Record<number, string>>({})
  const groups = groupFields(fields.filter((field) => field.ops.length > 0))

  function change(index: number, patch: Partial<Draft>): void {
    setRows((previous) => previous.map((row, i) => (i === index ? { ...row, ...patch, original: undefined } : row)))
    setErrors((previous) => ({ ...previous, [index]: '' }))
  }

  /** A new field keeps the op when it takes it, and never the value: a percentage is not a dollar figure. */
  function changeField(index: number, name: string): void {
    const ops = byName.get(name)?.ops ?? []
    const op = rows[index]!.op
    change(index, { field: name, op: ops.includes(op) ? op : (ops[0] ?? 'eq'), a: '', b: '' })
  }

  function apply(): void {
    const filters: Filter[] = []
    const found: Record<number, string> = {}
    rows.forEach((row, index) => {
      // A row nobody filled in is not a filter, and one nobody touched is the filter it was: the
      // orchestrator may have set one on a field the guide does not list, or the guide may be out.
      if (!row.field) return
      if (row.original) {
        filters.push(row.original)
        return
      }
      const read = fromDraft(row, byName.get(row.field))
      if ('error' in read) found[index] = read.error
      else filters.push(read.filter)
    })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    onApply({ filters, tickers: readTickers(tickers), includeUnlisted })
  }

  /** A form never submits in a view's frame, so Enter is read here. */
  function onEnter(event: KeyboardEvent): void {
    if (event.key === 'Enter') apply()
  }

  return (
    <div className="sc-dialog" onMouseDown={onClose}>
      <div className="sc-dialog-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="sc-dialog-head">
          <span>Screener filters</span>
          <button type="button" className="sc-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="sc-dialog-body">
          <div className="sc-section">
            <span className="sc-label">Filters (a company passes every one)</span>
            {fields.length === 0 && <p className="sc-error">{fieldsError ?? 'The server sent no list of fields.'}</p>}
            {rows.map((row, index) => {
              const field = byName.get(row.field)
              const valued = row.op !== 'is_null' && row.op !== 'not_null'
              return (
                <div key={index} className="sc-filter">
                  <div className="sc-filter-row">
                    <select
                      className="sc-input sc-filter-field"
                      aria-label="Field"
                      value={row.field}
                      title={field?.description}
                      onChange={(event) => changeField(index, event.target.value)}
                    >
                      <option value="">Pick a field…</option>
                      {/* A filter on a field the guide does not list still shows what it is. */}
                      {row.field && !field && <option value={row.field}>{row.field}</option>}
                      {groups.map(([group, members]) => (
                        <optgroup key={group} label={group}>
                          {members.map((member) => (
                            <option key={member.field} value={member.field}>
                              {fieldLabel(member.field)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <select
                      className="sc-input"
                      aria-label="Comparison"
                      value={row.op}
                      onChange={(event) => change(index, { op: event.target.value as Op })}
                    >
                      {(field?.ops ?? [row.op]).map((op) => (
                        <option key={op} value={op}>
                          {opText(op)}
                        </option>
                      ))}
                    </select>
                    {valued && (
                      <input
                        className="sc-input sc-filter-value"
                        aria-label={row.op === 'between' ? 'From' : 'Value'}
                        placeholder={row.op === 'in' ? 'values, separated by commas' : row.op === 'between' ? 'from' : 'value'}
                        value={row.a}
                        onChange={(event) => change(index, { a: event.target.value })}
                        onKeyDown={onEnter}
                      />
                    )}
                    {row.op === 'between' && (
                      <input
                        className="sc-input sc-filter-value"
                        aria-label="To"
                        placeholder="to"
                        value={row.b}
                        onChange={(event) => change(index, { b: event.target.value })}
                        onKeyDown={onEnter}
                      />
                    )}
                    {valued && field && <span className="sc-unit">{unitHint(field)}</span>}
                    <button
                      type="button"
                      className="sc-chip-x"
                      style={{ marginLeft: 'auto' }}
                      aria-label="Remove this filter"
                      onClick={() => {
                        setRows((previous) => previous.filter((_, i) => i !== index))
                        setErrors({})
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {field && <p className="sc-hint">{field.description}</p>}
                  {errors[index] && <p className="sc-error">{errors[index]}</p>}
                </div>
              )
            })}
            <button type="button" className="sc-btn" disabled={fields.length === 0} onClick={() => setRows((previous) => [...previous, NEW_ROW])}>
              Add a filter
            </button>
          </div>

          <div className="sc-section">
            <label className="sc-label" htmlFor="sc-tickers">
              Own list: screen only these tickers, as the SEC writes them (BRK-B)
            </label>
            <textarea
              id="sc-tickers"
              className="sc-input sc-tickers"
              rows={2}
              value={tickers}
              onChange={(event) => setTickers(event.target.value)}
              placeholder="Empty for every company. AAPL MSFT NVDA …"
            />
          </div>

          <div className="sc-section">
            <label className="sc-check">
              <input type="checkbox" checked={includeUnlisted} onChange={(event) => setIncludeUnlisted(event.target.checked)} />
              <span>Include companies without a ticker (trusts, non-traded REITs, shells)</span>
            </label>
          </div>
        </div>

        <div className="sc-dialog-foot">
          <button type="button" className="sc-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="sc-btn" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
