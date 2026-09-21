import type { ReactElement } from 'react'
import { gatheredText, verificationMark, type Citation, type CompanyResult, type Criterion } from './screener'

// One company's answers and what they rest on: per criterion the verdict, the rationale, what the
// verifier made of it, and the quotes as citations. The server has already checked every quote
// against the paragraph it cites, so a card shows it as it came, with the link the server built:
// the filing on sec.gov, scrolled to the quote.

/** What one evidence call brought back for a company. */
export interface Evidenced {
  company: CompanyResult
  citations: Record<string, Citation>
}

interface Props {
  ticker: string
  evidence: Evidenced | null
  error: string | null
  questions: Criterion[]
  onClose: () => void
  /** Opens an https link in the browser; the view's own frame cannot. */
  onLink: (url: string) => void
}

export function EvidencePane({ ticker, evidence, error, questions, onClose, onLink }: Props): ReactElement {
  const company = evidence?.company
  return (
    <div className="sc-evidence">
      <div className="sc-evidence-head">
        <span className="sc-ticker">{ticker}</span>
        {company?.name && <span className="sc-status">{company.name}</span>}
        {company?.verdict && <span className={`sc-v-${company.verdict}`}>{company.verdict}</span>}
        <button type="button" className="sc-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close the evidence">
          ×
        </button>
      </div>
      <div className="sc-evidence-body">
        {error && <p className="sc-error">{error}</p>}
        {!error && !company && <p className="sc-status">Reading the evidence…</p>}
        {company?.error && <p className="sc-error">{company.error}</p>}
        {company && company.status !== 'done' && !company.error && <p className="sc-status">This company has not been read yet.</p>}
        {company?.criteria.map((answer) => {
          const mark = verificationMark(answer.verification)
          return (
            <section key={answer.id} className="sc-criterion">
              <p className="sc-question">{questions.find((q) => q.id === answer.id)?.question ?? answer.id}</p>
              <p>
                <span className={`sc-v-${answer.verdict}`}>{answer.verdict}</span>
                <span className="sc-status">
                  {' '}
                  · {answer.verification || 'not verified'}
                  {answer.confidence !== null && ` · confidence ${answer.confidence.toFixed(2)}`}
                </span>
              </p>
              {answer.rationale && <p>{answer.rationale}</p>}
              {mark && <p className="sc-error">{mark}</p>}
              {answer.note && <p className="sc-status">{answer.note}</p>}
              {answer.evidence.map((id) => {
                const citation = evidence?.citations[id]
                return citation ? <Card key={id} citation={citation} onLink={onLink} /> : null
              })}
              {answer.gathered && <p className="sc-hint">{gatheredText(answer.gathered)}</p>}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Card({ citation, onLink }: { citation: Citation; onLink: (url: string) => void }): ReactElement {
  const { url } = citation
  return (
    <blockquote className="sc-cite">
      <p className="sc-quote">“{citation.quote}”</p>
      <p className="sc-cite-foot">
        <span>{citation.title}</span>
        {url && (
          <button type="button" className="sc-link" title="Opens the filing on sec.gov with the quote highlighted." onClick={() => onLink(url)}>
            Open the filing
          </button>
        )}
      </p>
    </blockquote>
  )
}
