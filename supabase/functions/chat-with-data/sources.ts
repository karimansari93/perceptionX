// ─── chat-with-data: the sources SSE event ──────────────────────────────────
// Walks every tool result of a turn for rows shaped { domain, top_pages:
// [{url, title, *_pct_of_answers}] } — get_sources, get_citations and the
// attribute-source breakdown all carry them — and returns one flat list, so
// the UI renders a sources footer from data rather than from the model's text
// and the eval can check every link the analyst wrote against it.

export interface SourceLink { title: string; url: string; domain: string; share?: number | null; domainAnswers?: number | null; domainPct?: number | null }

export function collectSources(payload: unknown, out: Map<string, SourceLink>): void {
  if (Array.isArray(payload)) { for (const v of payload) collectSources(v, out); return; }
  if (!payload || typeof payload !== 'object') return;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.domain === 'string' && Array.isArray(obj.top_pages)) {
    const domainAnswers = Number((obj.sample_size as any)?.answers_citing) || null;
    // The domain's share of answers — the headline the UI shows (shares lead,
    // counts nest). Whichever *_pct_of_*answers key the tool used.
    const domainPctKey = Object.keys(obj).find(k => /_pct_of_.*answers$/.test(k));
    const domainPct = domainPctKey && typeof obj[domainPctKey] === 'number' ? (obj[domainPctKey] as number) : null;
    for (const page of obj.top_pages as any[]) {
      const url = String(page?.url || '');
      if (!/^https?:\/\//i.test(url) || out.has(url)) continue;
      const shareKey = Object.keys(page || {}).find(k => /_pct(_|$)/.test(k));
      out.set(url, {
        // Page titles arrive with backslash-escaped quotes from the page cube.
        title: page?.title ? String(page.title).replace(/\\(["'])/g, '$1') : url,
        url,
        domain: obj.domain,
        share: shareKey ? (page[shareKey] as number | null) : null,
        domainAnswers,
        domainPct,
      });
    }
  }
  for (const v of Object.values(obj)) collectSources(v, out);
}

// ─── Competitors named this turn ────────────────────────────────────────────
// Every competitor row a tool returned ({ name | competitor, named_in_pct_of_
// answers }) — get_company_overview, get_competitors and
// get_competitor_landscape all carry them — so the UI can decorate the names
// in the answer with their logos.
export function collectCompetitors(payload: unknown, out: Set<string>): void {
  if (Array.isArray(payload)) { for (const v of payload) collectCompetitors(v, out); return; }
  if (!payload || typeof payload !== 'object') return;
  const obj = payload as Record<string, unknown>;
  if ('named_in_pct_of_answers' in obj) {
    const name = [obj.name, obj.competitor, obj.competitor_name].find(v => typeof v === 'string' && v.trim());
    if (name) out.add(String(name).trim());
  }
  for (const v of Object.values(obj)) collectCompetitors(v, out);
}
