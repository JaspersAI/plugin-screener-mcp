import { defineConnection, definePlugin, defineSource, defineView } from '@jaspers-ai/sdk'
import { z } from 'zod'
import { INSTRUCTIONS } from './instructions'
import { ScreenerView } from './ScreenerView'
import { DEFAULT_COLUMNS, DEFAULT_SORT, MAX_COLUMNS, MAX_CRITERIA, OPS, summarize, VERDICTS } from './screener'

// The screener on the Jaspers screener MCP (screener-mcp), its own connection, screener-mcp/jaspers.
// Five sources, one view. The schemas here are the contract with the orchestrator — what it may
// set, and what it may read back — so the filters are the server's filter language exactly, in raw
// units; which fields exist, and what each takes, is the server's to say (its guide), not ours.

const Filter = z.object({
  field: z.string().min(1),
  op: z.enum(OPS),
  /** between takes [low, high], in takes a list, is_null and not_null take none. Raw units. */
  value: z.union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))]).optional(),
})

const Sort = z.object({ field: z.string().min(1), dir: z.enum(['asc', 'desc']) })

/** A criterion of the qualitative stage: a question a reader of the filings can answer yes or no. The server's own shape. */
const Criterion = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  question: z.string().min(5).max(500),
})

/**
 * The panel's qualitative run. Setting `run` to {} with `criteria` in place is all the orchestrator
 * does: the view starts the run over its list, follows it, and shows the verdicts. The fields are
 * the view's own bookkeeping.
 */
const Run = z.object({
  id: z.string().optional(),
  status: z.enum(['running', 'done', 'error']).optional(),
  error: z.string().optional(),
})

const StateSchema = z.object({
  /** Always the COMPLETE set, joined by AND. */
  filters: z.array(Filter).default([]),
  /** The user's own list of tickers, as the SEC writes them; empty for every company. */
  tickers: z.array(z.string()).max(1000).default([]),
  includeUnlisted: z.boolean().default(false),
  sort: Sort.default(DEFAULT_SORT),
  page: z.number().int().min(0).default(0),
  /** Fields shown besides the ones filtered and sorted on. */
  columns: z.array(z.string()).max(MAX_COLUMNS).default(DEFAULT_COLUMNS),
  /** The server's session. The view writes it; leave it alone. */
  sessionId: z.string().nullable().default(null),
  criteria: z.array(Criterion).max(MAX_CRITERIA).default([]),
  run: Run.nullable().default(null),
  /** Which verdicts the table shows once a run has results; empty for all. */
  verdicts: z.array(z.enum(VERDICTS)).default([]),
  /** The ticker whose evidence is open; empty for none. */
  open: z.string().default(''),
})

const Progress = z.object({
  total: z.number(),
  queued: z.number(),
  running: z.number(),
  error: z.number(),
  pass: z.number(),
  fail: z.number(),
  unclear: z.number(),
  unverified: z.number(),
})

const OutputSchema = z.object({
  session_id: z.string().nullable(),
  universe: z.number(),
  count: z.number(),
  applied_filters: z.array(Filter.extend({ matches: z.number() })),
  tickers: z.array(z.string()),
  unknown_tickers: z.array(z.string()),
  sort: Sort,
  qualitative_ready: z.boolean(),
  qualitative_max: z.number(),
  qualitative: z
    .object({
      run_id: z.string().nullable(),
      status: z.string(),
      progress: Progress.nullable(),
      passed: z.array(z.string()).optional(),
      error: z.string().optional(),
    })
    .optional(),
  open: z.string(),
})

// A call on a session is not a function of its arguments alone, since the session is on the server:
// the rows of one call are never served to another.
const screen = defineSource({
  mcp: 'jaspers',
  tool: 'screen_companies',
  ttlMs: 0,
  description:
    'Screen US SEC registrants with filters {field, op, value} on any field of a company, narrowed over several calls in one session. Raw units: USD, fractions. With a screener element on screen, set its state instead.',
})

const guide = defineSource({
  mcp: 'jaspers',
  tool: 'get_guide',
  ttlMs: 600_000,
  description:
    'How to read the screener\'s data. topic "fields": every field with its kind, unit and ops. "screening": the filter language with examples, and how the qualitative stage works. "overview": coverage, limits and freshness.',
})

const qualitativeStart = defineSource({
  mcp: 'jaspers',
  tool: 'start_qualitative_screen',
  description:
    'Start the qualitative stage over a session\'s list: every company read against criteria in words, with verified quotes. Costs model calls per company. With a screener element on screen, set its state.criteria and state.run instead; it starts and follows the run itself.',
})

const qualitative = defineSource({
  mcp: 'jaspers',
  tool: 'get_qualitative_screen',
  ttlMs: 0,
  description:
    'Progress and results of a qualitative run. With evidence: true (and tickers or verdicts set) each criterion lists the ids of its citations, and citations holds each quote once with its title and link.',
})

const company = defineSource({
  mcp: 'jaspers',
  tool: 'get_company',
  description: 'One company by ticker: identity, latest-fiscal-year fundamentals, institutional holders, insiders, newest filings.',
})

export default definePlugin({
  id: 'screener-mcp',
  connections: {
    // The server signs users in itself: the terminal runs the OAuth flow (Authorize, in Settings under
    // Plugins) and sends the token it was given as a bearer on every call. Nothing to paste, and nothing
    // in the URL.
    jaspers: defineConnection({
      url: 'https://s.jsprai.com/mcp',
      auth: 'oauth',
      tools: ['screen_companies', 'start_qualitative_screen', 'get_qualitative_screen', 'get_company', 'get_guide'],
    }),
  },
  sources: { screen, guide, 'qualitative-start': qualitativeStart, qualitative, company },
  views: {
    screener: defineView(ScreenerView, {
      title: 'Screener',
      state: StateSchema,
      output: OutputSchema,
      instructions: INSTRUCTIONS,
      renders: [screen],
      summarize: (state, output) => summarize(state, output),
    }),
  },
})
