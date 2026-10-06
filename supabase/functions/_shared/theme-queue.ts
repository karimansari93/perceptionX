// Theming is batch-only (Message Batches API, half price): callers queue
// responses here and the theme-batch cron labels them, usually within the
// hour. Nothing calls Claude live for themes. See docs/methodology-sentiment.md.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export const LIVE_RUN_LABEL = "live";

export async function queueForBatchTheming(
  supabase: SupabaseClient,
  responseIds: string[],
  companyName: string,
): Promise<{ queued: number; error?: string }> {
  if (responseIds.length === 0) return { queued: 0 };
  const { error } = await supabase
    .from("theme_batch_items")
    .upsert(
      responseIds.map((id) => ({ run_label: LIVE_RUN_LABEL, response_id: id, company_name: companyName })),
      { onConflict: "run_label,response_id", ignoreDuplicates: true },
    );
  if (error) return { queued: 0, error: error.message };
  return { queued: responseIds.length };
}
