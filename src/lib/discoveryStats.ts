// Discovery prompts ask the AI an open question (e.g. "best employers in
// Germany") without naming the target company. The mention rate on these
// prompts is the real "visibility" signal — whether the AI chooses to surface
// the company unprompted. Mention rates on competitive/experience/informational
// prompts are softball comparisons because the prompt names the company.
//
// This module computes:
//   - the target company's discovery visibility (% of discovery responses
//     where company_mentioned = true)
//   - the top N other entities the AI surfaces in those same responses,
//     parsed from detected_competitors. Each entity's pct is mentions /
//     total discovery responses, so the numbers are directly comparable
//     to the target's visibility.

const DISCOVERY_PROMPT_TYPES = new Set(["discovery", "talentx_discovery"]);

export interface SurfacedEntity {
  name: string;
  mentions: number;
  pct: number;
}

export interface DiscoveryStats {
  totalResponses: number;
  targetVisibilityPct: number;
  topEntities: SurfacedEntity[];
}

interface ResponseLike {
  company_mentioned?: boolean | null;
  detected_competitors?: string | string[] | null;
  confirmed_prompts?: { prompt_type?: string | null } | null;
}

function parseCompetitors(raw: ResponseLike["detected_competitors"]): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeKey(name: string): string {
  return name.toLowerCase().trim();
}

export function computeDiscoveryStats(
  responses: ResponseLike[],
  targetCompanyName: string,
  topN = 5,
): DiscoveryStats | null {
  const discovery = responses.filter((r) =>
    DISCOVERY_PROMPT_TYPES.has(r.confirmed_prompts?.prompt_type ?? ""),
  );
  if (discovery.length === 0) return null;

  const targetMentions = discovery.filter((r) => r.company_mentioned === true).length;
  const targetVisibilityPct = (targetMentions / discovery.length) * 100;

  // Aggregate detected_competitors. Dedupe within each response so a
  // single response that mentions "Microsoft" three times counts once.
  // Across responses we count occurrences. We keep the first-seen casing
  // for display but match case-insensitively.
  const counts = new Map<string, { display: string; n: number }>();
  const targetKey = normalizeKey(targetCompanyName);

  for (const r of discovery) {
    const items = parseCompetitors(r.detected_competitors);
    const seenInResponse = new Set<string>();
    for (const item of items) {
      const key = normalizeKey(item);
      if (!key || seenInResponse.has(key)) continue;
      // Drop the target itself if it shows up in detected_competitors
      if (key === targetKey || key.includes(targetKey)) continue;
      seenInResponse.add(key);
      const existing = counts.get(key);
      if (existing) {
        existing.n += 1;
      } else {
        counts.set(key, { display: item, n: 1 });
      }
    }
  }

  const topEntities: SurfacedEntity[] = [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, topN)
    .map(({ display, n }) => ({
      name: display,
      mentions: n,
      pct: (n / discovery.length) * 100,
    }));

  return {
    totalResponses: discovery.length,
    targetVisibilityPct,
    topEntities,
  };
}
