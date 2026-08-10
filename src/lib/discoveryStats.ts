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

import { parseDetectedCompetitors } from "@/utils/competitorDetection";

const DISCOVERY_PROMPT_TYPES = new Set(["discovery"]);

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
    // Shared detection rules (competitorDetection.ts): placeholder tokens
    // ("None"/"N/A"/…) out, the target company self-excluded by word-boundary
    // match, deduped per response. Job boards and other non-entities are
    // excluded at the data layer (canonical_entities.is_active = false), not
    // by hardcoded lists here.
    const raw = Array.isArray(r.detected_competitors)
      ? r.detected_competitors.join(",")
      : r.detected_competitors;
    const items = parseDetectedCompetitors(raw, targetCompanyName);
    for (const item of items) {
      const key = normalizeKey(item);
      if (key === targetKey) continue;
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
