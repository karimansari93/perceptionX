// Localize approved onboarding prompts into each market's language BEFORE they
// are inserted into confirmed_prompts.
//
// The batch queue has always translated at setup time (translate-prompts edge
// function). The onboarding approval path used to insert English rows for every
// market, so a German-market cell could end up with an English set from
// approval AND a German set from the queue — both matching the collection
// filters, both collected. Translating here makes the approved rows the
// canonical localized set; the queue's setup phase then dedupes against them
// by logical identity instead of generating a second wording.
//
// The market → ISO code map mirrors locationToCountryCode() in
// process-company-batch-queue. The language decision itself stays server-side
// in translate-prompts (English-language countries pass through unchanged), so
// this file never needs to know which language a country speaks.

import { supabase } from '@/integrations/supabase/client';
import type { ConfirmedPromptRow } from './types';

const MARKET_TO_ISO: Record<string, string> = {
  'united states': 'US',
  usa: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  ireland: 'IE',
  canada: 'CA',
  australia: 'AU',
  'new zealand': 'NZ',
  germany: 'DE',
  austria: 'AT',
  switzerland: 'CH',
  france: 'FR',
  belgium: 'BE',
  netherlands: 'NL',
  italy: 'IT',
  spain: 'ES',
  portugal: 'PT',
  brazil: 'BR',
  mexico: 'MX',
  poland: 'PL',
  sweden: 'SE',
  norway: 'NO',
  denmark: 'DK',
  finland: 'FI',
  japan: 'JP',
  china: 'CN',
  india: 'IN',
  singapore: 'SG',
  'united arab emirates': 'AE',
  'saudi arabia': 'SA',
};

export function marketToCountryCode(market: string): string {
  return MARKET_TO_ISO[market.trim().toLowerCase()] ?? 'GLOBAL';
}

/**
 * Translate every row's prompt_text into its market's language, grouped per
 * market through the same translate-prompts edge function the batch queue
 * uses. Unknown markets and English-language countries keep their text.
 *
 * Throws on any failed or incomplete translation call: a half-translated set
 * must never be approved — silently English rows in a German market is exactly
 * the defect this module exists to prevent.
 */
export async function localizeConfirmedRows(
  rows: ConfirmedPromptRow[],
): Promise<ConfirmedPromptRow[]> {
  const byMarket = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const market = row.location_context ?? '';
    const list = byMarket.get(market);
    if (list) list.push(i);
    else byMarket.set(market, [i]);
  });

  const out = [...rows];
  for (const [market, indexes] of byMarket) {
    const countryCode = marketToCountryCode(market);
    if (countryCode === 'GLOBAL') continue; // unknown market — keep English

    // Translate each distinct text ONCE. Discovery templates contain no
    // company name, so sibling entities sharing a (market, function, industry)
    // cell produce byte-identical English — they must stay byte-identical in
    // German too (LLM translation is non-deterministic per call), or the
    // cross-entity response-sharing at collection time can never match them.
    const uniqueTexts = [...new Set(indexes.map((i) => rows[i].prompt_text))];

    const { data, error } = await supabase.functions.invoke('translate-prompts', {
      body: { prompts: uniqueTexts, countryCode },
    });
    if (error) {
      throw new Error(`Translation failed for ${market}: ${error.message}`);
    }
    const translated: unknown = (data as { translatedPrompts?: unknown })?.translatedPrompts;
    if (!Array.isArray(translated) || translated.length !== uniqueTexts.length) {
      throw new Error(`Translation returned incomplete results for ${market}`);
    }
    const byText = new Map<string, string>();
    uniqueTexts.forEach((src, j) => {
      const t = translated[j];
      if (typeof t === 'string' && t.trim()) byText.set(src, t);
    });
    for (const rowIdx of indexes) {
      const t = byText.get(rows[rowIdx].prompt_text);
      if (t) out[rowIdx] = { ...out[rowIdx], prompt_text: t };
    }
  }
  return out;
}
