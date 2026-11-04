// ─── Quarterly update email: payload ────────────────────────────────────────
// Everything the email template renders, as plain data. The numbers come
// from the same stats cubes the dashboard and the analyst tools read
// (payload.ts); the prose comes from the analyst model writing against those
// numbers (narrative.ts). The template never computes a figure.

export interface DigestMetric {
  value: number | null;
  /** Points vs the previous measured quarter; null when there is no comparison. */
  delta: number | null;
}

export interface DigestBarRow {
  /** Domain the mark is looked up under (logo.dev). */
  domain: string;
  name: string;
  /** Share of answers, 0-100. */
  pct: number;
  delta: number | null;
  /** Client-owned site (rendered in navy). */
  owned?: boolean;
  /** The client itself in the employers list. */
  you?: boolean;
}

export interface DigestAttributeRow {
  attributeId: string;
  name: string;
  /** % of answers raising the attribute. */
  raisedPct: number;
  positivePct: number | null;
  /** Sentiment change in points; null when hidden or unavailable. */
  delta: number | null;
}

/** One job function or one market. */
export interface DigestGroupRow {
  name: string;
  positivePct: number | null;
  sentimentDelta: number | null;
  /** % of answers naming the company. */
  namedPct: number | null;
  visibilityDelta: number | null;
}

export interface DigestCallout {
  title: string;
  body: string;
}

export interface DigestNarrative {
  /** Inbox preview line, under 120 characters. */
  preheader: string;
  callouts: DigestCallout[];
  /** Short paragraph under the job-function table. */
  functionsNote: string | null;
  /** Short paragraph under the market table (multi-market views only). */
  marketsNote: string | null;
  /** The one "Where to focus" recommendation. */
  action: string;
}

/** One action from the client's published report, scoped to this reader's markets. */
export interface DigestActionRow {
  /** company_actions.id, for the link to the action's card on the Actions tab. */
  id: string;
  /** "05" as printed in the report, or "" for an action without a number. */
  number: string;
  title: string;
  /** Expected effect on what AI tells candidates: high, medium, low, or null when unlabelled. Not timing. */
  priority: 'high' | 'medium' | 'low' | null;
  /** One sentence on why, in the client's own figures. */
  priorityReason: string | null;
  markets: string[];
  /** The report's "Why" (problem). */
  why: string | null;
  /** The report's "What to do". */
  whatToDo: string;
  owner: string | null;
  /** "Sentiment (Compensation) in Hungary" style lines. */
  lifts: string[];
}

export interface DigestPayload {
  recipient: { firstName: string; email: string };
  brand: { name: string; domain: string | null };
  scope: {
    /** "India", "EMEA", "India, United States". */
    locationLabel: string;
    /** "in" for one market, "across" for a region or a set. */
    preposition: 'in' | 'across';
    /** The tracked market spellings behind the label. */
    markets: string[];
    jobFunctions: string[];
  };
  period: {
    /** "Q4 2026" */
    quarter: string;
    /** "Q4 26" */
    short: string;
    /** "Q3 2026", or null for a first collection. */
    previousQuarter: string | null;
    /** How the previous collection is named in prose: "July". */
    previousLabel: string | null;
  };
  /** Each metric carries its band label (Excellent, Strong, Fair, Needs improvement), or null when the value is missing. */
  metrics: {
    eps: DigestMetric & { grade: string };
    sentiment: DigestMetric & { grade: string | null };
    visibility: DigestMetric & { grade: string | null; likeForLike?: DigestLikeForLike | null };
    relevance: DigestMetric & { grade: string | null };
  };
  /** One line under the scope card explaining how change is measured. */
  comparisonNote: string;
  /** True when sentiment and theme changes are withheld (classifier change). */
  sentimentChangeHidden: boolean;
  byFunction: DigestGroupRow[];
  byMarket: DigestGroupRow[];
  employers: DigestBarRow[];
  /** What the employers shares are measured on, for the section subtitle and the prose. */
  employersNote: string;
  /** One sentence on what drives the employers list, shown under its note; null when not needed. */
  employersContext?: string | null;
  sources: DigestBarRow[];
  attributes: DigestAttributeRow[];
  /** Published report actions for this reader's markets (organisation-wide ones included). */
  actions: DigestActionRow[];
  /** Actions for this reader's markets completed this quarter: good news, never a cause of a figure. */
  doneActions?: Array<{ id: string; title: string; markets: string[] }>;
  narrative: DigestNarrative | null;
  /** Where the button goes: the pre-created chat, or the chat page. */
  chatUrl: string;
  chatNote: string;
}

export interface DigestRenderOptions {
  /** Where the app serves /logos and /email/attributes from. */
  appUrl: string;
  /** logo.dev publishable token (pk_...). */
  logoDevToken: string;
}

/**
 * Visibility on the questions asked in both quarters, set when the question
 * set changed (new questions are at least 5% of this quarter's answers), so
 * a headline change can be explained by the question set rather than guessed.
 */
export interface DigestLikeForLike {
  /** Visibility on questions asked in both quarters, this quarter and last. */
  latest: number;
  previous: number;
  delta: number;
  /** Share of this quarter's answers that come from questions not asked last quarter. */
  newQuestionsSharePct: number;
  /**
   * Internal only, never quoted: visibility on the new questions, which
   * blends open employer questions (client rarely named) with questions
   * about the client (always named), so it describes neither.
   */
  newQuestionsVisibilityPct: number | null;
  /** Share of answers that are open employer questions ("which companies..."), this quarter and last. */
  openQuestionsSharePct: number;
  openQuestionsSharePrevPct: number;
  /** Visibility on open employer questions, this quarter and last. */
  openQuestionsVisibilityPct: number | null;
  openQuestionsVisibilityPrevPct: number | null;
  /** Visibility on questions that ask about the client, this quarter. */
  clientQuestionsVisibilityPct: number | null;
  /** A few of the new questions, so the prose can say what they are about. */
  newQuestionExamples: string[];
}
