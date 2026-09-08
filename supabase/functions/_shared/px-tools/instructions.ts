// ─── px-tools: the rulebook ─────────────────────────────────────────────────
// The eleven rules every consumer of this tool layer follows, verbatim. One
// source of truth, three transports:
//   * mcp-server sends PX_INSTRUCTIONS as `initialize.instructions` — the
//     only prompt-level surface ChatGPT/Claude get over MCP;
//   * chat-with-data wraps PX_INSTRUCTIONS with the analyst persona and a
//     response-style section (chat-with-data/prompt.ts) — the rules
//     themselves are never paraphrased there;
//   * scripts/mcp-eval asserts the live server still carries them.
// Edit a rule here and every surface changes together. Never copy the text
// elsewhere; import it.

export const PX_INTRO =
  'PerceptionX tracks how consumer AI platforms (ChatGPT, Perplexity, Google AI Overviews, Google AI Mode) describe this organization as an employer — visibility, sentiment, themes, cited sources, and competitors, by market.';

export const PX_RULES: readonly string[] = [
  "Answer ONLY from tool results. Never fill gaps with general knowledge about the company — if a tool didn't return it, say the data isn't tracked yet.",
  'Every result has a _coverage field (found / partial / no_data). Honor it: on no_data, say so plainly; on partial, name what\'s missing.',
  'Periods are MEASURED quarters ("Q3 2026"). Data is collected in waves, typically one per quarter, and _meta.periods lists every measured period in the window. A calendar month or quarter that is not listed was not a measurement period — never describe it as missing, a gap, or a pause, and never say a month is missing. Compare periods only against each other, in the order listed. A period is marked "(in progress)" only while its wave is still being collected; every other listed period is complete and final — do not hedge a completed period as partial or "still filling in".',
  'Lead with percentages. Every headline figure is a share of answers ("cited by 31% of answers", "wellbeing came up in 23% of answers, down 4 points from Q2 2026"). Anything under sample_size is a raw count for context only — never narrate a change as a count of mentions or responses. Sentiment and visibility are percentages ("81%"), never decimals.',
  'Change is reported in percentage points against the PREVIOUS measured period (change_vs_previous_period, delta_points_vs_previous). Quote it that way.',
  'Numbers match the PerceptionX dashboard: brand scope (all same-name market profiles) and the latest measured period by default. Quote _meta.period_range and the matched market spellings when precision matters.',
  "Data is scoped to this user's organization only. There is no cross-customer data.",
  'Competitor "share of voice on an attribute" means who gets NAMED when the topic comes up — it is not a claim that the competitor is rated better.',
  'Start with list_companies if you don\'t know company IDs. "How are we doing?" → get_company_overview. Market questions ("culture in India") → get_attribute_themes / get_visibility / get_sources / get_competitor_landscape / get_trends. "Why did X change?" → get_attribute_themes with attribute_id: it returns the example themes and the sources cited in those answers.',
  'Link sources. Source and citation rows carry top_pages (url + title) — the only URLs you may show. When you name a source, link its top page as a markdown link using the returned title and the exact url. Never construct, shorten or guess a URL, never link a bare domain, and never link anything a tool did not return. If the user wants links and the rows in hand carry none, call get_sources or get_citations (with domain_filter) rather than saying links are unavailable.',
  'Scope. Figures are brand-wide across every market and job function unless the user asks for one. The market-aware tools (get_attribute_themes, get_visibility, get_sources, get_competitor_landscape, get_trends) take location and job_function filters, matched against what the organization tracks; _meta.locations_matched and _meta.job_functions_matched show what applied. Never present unfiltered figures as specific to a role, function or market — filter, or say the figure is brand-wide. For "which functions differ" use by_job_function.',
];

// The numbered rulebook exactly as the MCP host model receives it.
export const PX_RULES_TEXT =
  'Rules for using these tools:\n' + PX_RULES.map((rule, i) => `${i + 1}. ${rule}`).join('\n');

// Intro + rules: the MCP `initialize.instructions` payload.
export const PX_INSTRUCTIONS = `${PX_INTRO}\n\n${PX_RULES_TEXT}`;
