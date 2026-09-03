// Helpers for consumers that COUNT responses.
//
// The dashboard's response stream carries, for every attribute-tagged prompt,
// a second copy of its newest response per model (see stitchResponses in
// useDashboardData: the reformatted duplicate the Thematic/Overview attribute
// views consume). Both copies share the response id, citations, competitors
// and response_month, and — being the newest response — the copy always
// lands in the LATEST period, never the previous one. Any tab that tallies
// rows therefore overstates the current period by up to 2x while the prior
// period stays exact, which skews every period-over-period delta upward
// (observed on Ford Business Solutions: a page cited by 218 responses showed
// 437, "+13%" against a real −43%).
//
// Consumers that count responses run their input through this first. First
// occurrence wins: stitchResponses emits the base rows (full prompt object,
// including prompt_theme/attribute_id) before the reformatted copies.

export const dedupeResponsesById = <T extends { id?: string | null }>(rows: T[]): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const id = r?.id;
    if (id == null) {
      out.push(r);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
};
