import type { ReactElement } from 'react'
import { filterText, type Field, type Screen } from './screener'

// The funnel: how many companies there are, what each filter passes on its own, and how many pass
// all of them. The server counts every filter alone, so the line shows which one does the cutting.

interface Props {
  screen: Screen | null
  fields: Map<string, Field>
}

export function Funnel({ screen, fields }: Props): ReactElement | null {
  if (!screen) return null
  const n = (value: number): string => value.toLocaleString('en-US')
  return (
    <div className="sc-bar sc-funnel">
      <span>
        <b>{n(screen.universe)}</b> {screen.tickers.length > 0 ? 'on the list' : 'companies'}
      </span>
      {screen.applied.map((filter, index) => (
        <span key={index} className="sc-step">
          <span className="sc-arrow">→</span> {filterText(filter, fields.get(filter.field))} <b>{n(filter.matches)}</b>
        </span>
      ))}
      <span className="sc-step">
        <span className="sc-arrow">→</span> <b>{n(screen.count)}</b> pass{screen.applied.length > 1 ? ' all' : ''}
        {screen.countBefore !== null && screen.countBefore !== screen.count && <> (was {n(screen.countBefore)})</>}
      </span>
      {screen.unknownTickers.length > 0 && <span className="sc-error">No company for {screen.unknownTickers.join(', ')}</span>}
    </div>
  )
}
