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
  /** The one "Where to act next" recommendation. */
  action: string;
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
  metrics: {
    eps: DigestMetric & { grade: string };
    sentiment: DigestMetric;
    visibility: DigestMetric;
    relevance: DigestMetric;
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
