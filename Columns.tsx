import { useState, type ReactElement } from 'react'
import { fieldLabel, groupFields, MAX_COLUMNS, type Field } from './screener'

// Which fields the table shows besides the ones filtered and sorted on, which are shown whatever is
// picked here. The list is the server's guide, group by group; what is picked goes into the panel's
// state, and from there into the screen's arguments, since the server sends only the columns asked for.

interface Props {
  columns: string[]
  fields: Field[]
  fieldsError: string | null
  onApply: (columns: string[]) => void
  onClose: () => void
}

export function ColumnsDialog({ columns, fields, fieldsError, onApply, onClose }: Props): ReactElement {
  const [picked, setPicked] = useState<string[]>(columns)
  // The identity columns are the company cell; the table draws them whatever is asked for.
  const groups = groupFields(fields.filter((field) => !['cik', 'name', 'sic_description'].includes(field.field)))

  function toggle(name: string, on: boolean): void {
    setPicked((previous) => (on ? [...previous, name] : previous.filter((item) => item !== name)))
  }

  return (
    <div className="sc-dialog" onMouseDown={onClose}>
      <div className="sc-dialog-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="sc-dialog-head">
          <span>Columns</span>
          <button type="button" className="sc-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="sc-dialog-body">
          {fields.length === 0 && <p className="sc-error">{fieldsError ?? 'The server sent no list of fields.'}</p>}
          {groups.map(([group, members]) => (
            <div key={group} className="sc-section">
              <span className="sc-label">{group}</span>
              <div className="sc-columns">
                {members.map((field) => (
                  <label key={field.field} className="sc-check" title={field.description}>
                    <input type="checkbox" checked={picked.includes(field.field)} onChange={(event) => toggle(field.field, event.target.checked)} />
                    <span>{fieldLabel(field.field)}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="sc-dialog-foot">
          <span className="sc-status" style={{ marginRight: 'auto' }}>
            {picked.length} picked{picked.length > MAX_COLUMNS ? `, ${MAX_COLUMNS} at most` : ''}
          </span>
          <button type="button" className="sc-btn" onClick={() => setPicked([])}>
            None
          </button>
          <button type="button" className="sc-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="sc-btn" disabled={picked.length > MAX_COLUMNS} onClick={() => onApply(picked)}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
