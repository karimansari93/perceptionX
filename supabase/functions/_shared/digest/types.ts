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
    visibility: DigestMetric & { grade: string | null };
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
  sources: DigestBarRow[];
  attributes: DigestAttributeRow[];
  /** Published report actions for this reader's markets (organisation-wide ones included). */
  actions: DigestActionRow[];
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
