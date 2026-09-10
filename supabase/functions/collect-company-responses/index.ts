import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Fallback strings the Google edge functions return in `response` instead of
// a 500 (see _shared/google-serp.ts serpapi*/scrapingdog* return paths and
// the last-resort catch in both wrappers). None of these is an answer.
const PROVIDER_FAILURE_RE =
  /^(?:Google (?:search|AI Mode|AI Overviews?) (?:API |temporary )?error|Google AI Mode error|AI Overview error|Failed to fetch|No AI overview available|No response generated|.+ is not configured\.)/i;

export function isProviderFailureText(text: string): boolean {
  return PROVIDER_FAILURE_RE.test((text || "").trim());
}

// Keep an auditable record of what failed and why, out of prompt_responses.
// Best-effort: a failure to log must not mask the collection error itself.
async function recordCollectionFailure(
  supabase: any,
  f: { companyId: string; promptId: string; model: string; errorText: string; collectionMonth: string | null },
): Promise<void> {
  try {
    await supabase.from("prompt_response_failures").insert({
      company_id: f.companyId,
      confirmed_prompt_id: f.promptId,
      ai_model: f.model,
      error_text: f.errorText.slice(0, 2000),
      collection_cycle: f.collectionMonth ? f.collectionMonth.slice(0, 10) : null,
    });
  } catch (e: any) {
    console.error("recordCollectionFailure:", e?.message);
  }
}

serve(async (req) => {
  console.log("collect-company-responses function called", {
    method: req.method,
    url: req.url,
  });

  if (req.method === "OPTIONS") {
    console.log("Handling OPTIONS request");
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json();
    console.log("Request body:", body);
    const {
      companyId,
      promptIds,
      models,
      promptTypes,
      promptCategories,
      batchSize = 5,
      skipExisting = true,
      // When set ("YYYY-MM", e.g. "2026-04"), a prompt is only considered
      // "already collected" for a given model if a response exists WITHIN
      // THAT MONTH. Prompts with no response in that month — even if they
      // have responses in earlier/later months — will be re-run. Use case:
      // "fill April's Perplexity gap" — set to "2026-04" and only prompts
      // missing an April response get run, regardless of Jan/Feb/May data.
      skipIfCollectedInMonth = null,
    } = body;

    // Derive the period window [start, end) from "YYYY-MM" or "YYYY-Qn".
    let skipMonthStart: string | null = null;
    let skipMonthEnd: string | null = null;
    if (skipIfCollectedInMonth) {
      const quarter = String(skipIfCollectedInMonth).match(/^(\d{4})-Q([1-4])$/i);
      if (quarter) {
        const y = Number(quarter[1]);
        const firstMonth = (Number(quarter[2]) - 1) * 3; // Q1→0, Q2→3, Q3→6, Q4→9
        skipMonthStart = new Date(Date.UTC(y, firstMonth, 1)).toISOString();
        skipMonthEnd = new Date(Date.UTC(y, firstMonth + 3, 1)).toISOString();
      } else if (/^\d{4}-\d{2}$/.test(skipIfCollectedInMonth)) {
        const [y, m] = String(skipIfCollectedInMonth).split("-").map(Number);
        skipMonthStart = new Date(Date.UTC(y, m - 1, 1)).toISOString();
        skipMonthEnd = new Date(Date.UTC(y, m, 1)).toISOString();
      }
    }

    if (!companyId) {
      console.error("Company ID is required but not provided");
      return new Response(
        JSON.stringify({ error: "Company ID is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!models || !Array.isArray(models) || models.length === 0) {
      console.error("Models array is required");
      return new Response(
        JSON.stringify({ error: "Models array is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Initialize Supabase with service role key
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get company details (companies table has no organization_id; link is via organization_companies)
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, name")
      .eq("id", companyId)
      .single();

    if (companyError || !company) {
      throw new Error(`Company not found: ${companyError?.message}`);
    }

    console.log(`Processing company: ${company.name} (${companyId})`);

    // Sibling companies (same organization) for cross-entity response sharing.
    // Discovery prompts contain no company name, so sibling entities that share
    // a (market, function, industry) cell ask the byte-identical question —
    // the model should be asked ONCE per cycle, with each company running its
    // own analysis (mention detection is per-company) over the same response.
    const { data: orgLinks } = await supabase
      .from("organization_companies")
      .select("organization_id")
      .eq("company_id", companyId);
    const orgIds = [...new Set((orgLinks || []).map((r: any) => r.organization_id))];
    let siblingCompanyIds: string[] = [];
    if (orgIds.length > 0) {
      const { data: sibs } = await supabase
        .from("organization_companies")
        .select("company_id")
        .in("organization_id", orgIds)
        .neq("company_id", companyId);
      siblingCompanyIds = [...new Set((sibs || []).map((r: any) => r.company_id))];
    }

    // Reuse window: the collection month being filled (explicit when the
    // monthly-refresh cron passes skipIfCollectedInMonth, else the current
    // calendar month). A sibling's response from a previous cycle is stale
    // evidence and must NOT suppress a fresh ask.
    const nowForWindow = new Date();
    const reuseWindowStart =
      skipMonthStart ??
      new Date(Date.UTC(nowForWindow.getUTCFullYear(), nowForWindow.getUTCMonth(), 1)).toISOString();
    const reuseWindowEnd =
      skipMonthEnd ??
      new Date(Date.UTC(nowForWindow.getUTCFullYear(), nowForWindow.getUTCMonth() + 1, 1)).toISOString();

    // Resolve organization_id from organization_companies (company can belong to one or more orgs)
    // Fetch prompts for this company. Built as a factory because pagination
    // needs a fresh builder per page (builders are mutable).
    const buildPromptsQuery = () => {
      let promptsQuery = supabase
        .from("confirmed_prompts")
        .select("*")
        .eq("is_active", true);

      // If promptIds are provided, use them — but ALSO constrain by company_id
      // as defense-in-depth. A buggy or malicious caller must not be able to run
      // responses for another organization's prompts under this company_id
      // (previously this was a "trust me" comment with no enforcement).
      if (promptIds && promptIds.length > 0) {
        promptsQuery = promptsQuery.in("id", promptIds).eq("company_id", companyId);
      } else {
        promptsQuery = promptsQuery.eq("company_id", companyId);
      }

      // Filter by prompt types if provided
      if (promptTypes && promptTypes.length > 0) {
        promptsQuery = promptsQuery.in("prompt_type", promptTypes);
      }

      // Filter by prompt categories if provided (PostgREST or syntax: comma = OR)
      if (promptCategories && promptCategories.length > 0) {
        const orParts: string[] = [];
        for (const cat of promptCategories) {
          if (cat === "General") {
            orParts.push("prompt_category.eq.General", "prompt_category.is.null");
          } else {
            orParts.push(`prompt_category.eq.${cat}`);
          }
        }
        promptsQuery = promptsQuery.or(orParts.join(","));
      }
      return promptsQuery;
    };

    // Paginate past PostgREST's 1000-row response cap. Without this, any
    // company with >1000 active prompts silently collected an arbitrary 1000
    // of them (CSL Behring: 300 of 1300 prompts never collected). The stable
    // .order("id") is required for correct .range() paging.
    const PROMPT_PAGE_SIZE = 1000;
    const allPrompts: any[] = [];
    for (let page = 0; ; page++) {
      const from = page * PROMPT_PAGE_SIZE;
      const { data: promptPage, error: promptsError } = await buildPromptsQuery()
        .order("id", { ascending: true })
        .range(from, from + PROMPT_PAGE_SIZE - 1);
      if (promptsError) {
        throw new Error(`Failed to fetch prompts: ${promptsError.message}`);
      }
      allPrompts.push(...(promptPage ?? []));
      if (!promptPage || promptPage.length < PROMPT_PAGE_SIZE) break;
    }

    if (!allPrompts || allPrompts.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No prompts found matching criteria",
          results: {
            promptsProcessed: 0,
            responsesCollected: 0,
            errors: [],
          },
          summary: {
            batchesProcessed: 0,
            totalPrompts: 0,
            totalOperations: 0,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`Found ${allPrompts.length} prompts to process`);

    const results = {
      promptsProcessed: 0,
      responsesCollected: 0,
      errors: [] as string[],
    };

    // Process prompts in batches
    const totalPrompts = allPrompts.length;
    const totalOperations = totalPrompts * models.length;
    let batchesProcessed = 0;

    // TODO [12.8]: Add data_collection_last_heartbeat timestamptz column updated every ~10s
    // so the UI can detect stale progress (heartbeat older than 60s = likely failed).
    // Also define a shared TypeScript type for the progress JSON shape.
    const updateProgress = async (
      completed: number,
      currentPrompt: string,
      currentModel: string
    ) => {
      const truncated = currentPrompt.slice(0, 80) + (currentPrompt.length > 80 ? "…" : "");
      await supabase
        .from("companies")
        .update({
          data_collection_progress: {
            completed,
            total: totalOperations,
            currentPrompt: truncated,
            currentModel,
          },
        })
        .eq("id", companyId);
    };

    // Write initial progress so the frontend can show 0 / total immediately
    await updateProgress(0, "Starting AI analysis…", "Multiple models");

    // TODO [12.7]: batchSize fires more parallel calls than expected — batchSize N runs
    // N prompts × M models simultaneously via Promise.all. Consider processing prompts
    // sequentially within each batch, or keep batchSize at 2 from queue processors.
    for (let batchOffset = 0; batchOffset < totalPrompts; batchOffset += batchSize) {
      const batchEnd = Math.min(batchOffset + batchSize, totalPrompts);
      const batch = allPrompts.slice(batchOffset, batchEnd);

      console.log(
        `Processing batch ${batchesProcessed + 1}: prompts ${batchOffset + 1}-${batchEnd} of ${totalPrompts} (parallel prompts + parallel models)`,
      );

      // Process all prompts in this batch in PARALLEL (each prompt runs its models in parallel)
      const promptPromises = batch.map(async (prompt: any, promptIdx: number) => {
        try {
          // Check existing responses if skipExisting is true
          let modelsToProcess = [...models];
          if (skipExisting) {
            let existingQuery = supabase
              .from("prompt_responses")
              .select("ai_model")
              .eq("confirmed_prompt_id", prompt.id)
              .eq("company_id", companyId);

            // Month-bounded skip: a prompt is "already collected" for this
            // model only if a response exists INSIDE the specified month.
            // Responses in earlier or later months don't count. This is how
            // "fill April's Perplexity gap" actually works — Netflix prompts
            // with January + May responses but nothing from April will re-run.
            if (skipMonthStart && skipMonthEnd) {
              existingQuery = existingQuery
                .gte("created_at", skipMonthStart)
                .lt("created_at", skipMonthEnd);
            }

            const { data: existingResponses } = await existingQuery;

            const existingModels = new Set(
              existingResponses?.map((r: any) => r.ai_model) || [],
            );
            modelsToProcess = models.filter((m) => !existingModels.has(m));

            if (modelsToProcess.length === 0) {
              console.log(
                `Skipping prompt ${prompt.id}: all models already have ${skipIfCollectedInMonth ? `responses in ${skipIfCollectedInMonth}` : "responses"}`,
              );
              return;
            }
          }

          // Run models in PARALLEL for this prompt
          const modelPromises = modelsToProcess.map(async (modelName: string) => {
            try {
              let responseText = "";
              let citations: any[] = [];

              // Cross-entity reuse: if a sibling company already collected this
              // model's answer to the byte-identical discovery question in this
              // cycle, reuse its response instead of asking the model again.
              // Restricted to discovery prompts — every other type embeds the
              // company name, so cross-company text collisions are impossible.
              if (prompt.prompt_type === "discovery" && siblingCompanyIds.length > 0) {
                const { data: shared } = await supabase
                  .from("prompt_responses")
                  .select("response_text, citations, confirmed_prompts!inner(prompt_text)")
                  .eq("ai_model", modelName)
                  .in("company_id", siblingCompanyIds)
                  .eq("confirmed_prompts.prompt_text", prompt.prompt_text)
                  .gte("created_at", reuseWindowStart)
                  .lt("created_at", reuseWindowEnd)
                  .not("response_text", "is", null)
                  .order("created_at", { ascending: false })
                  .limit(1)
                  .maybeSingle();

                if (shared?.response_text) {
                  responseText = shared.response_text;
                  citations = Array.isArray(shared.citations) ? shared.citations : [];
                  console.log(
                    `[SharedPrompt] Reusing sibling ${modelName} response for discovery prompt ${prompt.id} — no model call`,
                  );
                }
              }

              if (!responseText) {
                // Stagger Claude calls to avoid token rate limit bursts.
                // Web search is now enabled for citations, so use longer delays.
                if (modelName === "claude" && promptIdx > 0) {
                  await new Promise(r => setTimeout(r, Math.min(promptIdx, 5) * 4000));
                }

                // Call edge function for each model
                const functionName = `test-prompt-${modelName}`;
                const modelResponse = await fetch(
                  `${supabaseUrl}/functions/v1/${functionName}`,
                  {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${supabaseKey}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      prompt: prompt.prompt_text,
                      // Used by the Google functions (Scrapingdog `country`
                      // geo-targeting); ignored by every other model function.
                      location_context: prompt.location_context ?? null,
                    }),
                  },
                );

                if (!modelResponse.ok) {
                  const errorData = await modelResponse.json();
                  throw new Error(
                    `${modelName} error: ${errorData.error || "Unknown error"}`,
                  );
                }

                const modelData = await modelResponse.json();
                responseText = modelData.response || "";
                citations = modelData.citations || [];

                if (!responseText) {
                  throw new Error(`No response from ${modelName}`);
                }

                // The Google functions answer 200 with a failure STRING in
                // `response` by design (so a queue run never aborts). Until
                // now that string was stored as if it were the model's answer:
                // it counted in visibility denominators and citation totals,
                // and the per-month unique index then blocked a real re-run
                // (PepsiCo Sep-2026: 6 such rows). Detect the fallback shapes
                // and skip the row; the prompt stays "missing" for the month,
                // so the coverage panel surfaces it and a recollect fills it.
                if (isProviderFailureText(responseText)) {
                  await recordCollectionFailure(supabase, {
                    companyId, promptId: prompt.id, model: modelName,
                    errorText: responseText, collectionMonth: skipMonthStart,
                  });
                  throw new Error(`${modelName} returned a failure string, not an answer: ${responseText.slice(0, 120)}`);
                }
              }

              // Analyze response using analyze-response function
              const analyzeResponse = await fetch(
                `${supabaseUrl}/functions/v1/analyze-response`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    response: responseText,
                    companyName: company.name,
                    promptType: prompt.prompt_type,
                    perplexityCitations:
                      modelName === "perplexity" ? citations : null,
                    citations:
                      modelName === "openai" ||
                      modelName === "google-ai-overviews" ||
                      modelName === "google-ai-mode" ||
                      modelName === "bing-copilot" ||
                      modelName === "claude"
                        ? citations
                        : null,
                    confirmed_prompt_id: prompt.id,
                    ai_model: modelName,
                    company_id: companyId,
                    isAttributePrompt: prompt.attribute_id != null,
                  }),
                },
              );

              if (!analyzeResponse.ok) {
                const errorData = await analyzeResponse.json();
                throw new Error(
                  `Analysis error: ${errorData.error || "Unknown error"}`,
                );
              }

              results.responsesCollected++;
              return { success: true, model: modelName };
            } catch (error: any) {
              console.error(
                `ERROR in model ${modelName} for prompt ${prompt.id}:`,
                error.message,
              );
              results.errors.push(
                `Error collecting ${modelName} response for prompt ${prompt.id}: ${error.message}`,
              );
              return { success: false, model: modelName, error: error.message };
            }
          });

          await Promise.all(modelPromises);
          results.promptsProcessed++;
        } catch (error: any) {
          console.error(`Error processing prompt ${prompt.id}:`, error.message);
          results.errors.push(
            `Error processing prompt ${prompt.id}: ${error.message}`,
          );
        }
      });

      await Promise.all(promptPromises);
      batchesProcessed++;

      // Update progress so the frontend can poll and show live progress
      const lastPrompt = batch[batch.length - 1];
      const promptLabel = lastPrompt?.prompt_text ?? "Collecting AI responses…";
      await updateProgress(
        results.responsesCollected,
        promptLabel,
        "Multiple models"
      );
    }

    // Update last_updated timestamp
    await supabase
      .from("companies")
      .update({ last_updated: new Date().toISOString() })
      .eq("id", companyId);

    // Dashboard rollup MVs are refreshed by the staleness-driven pg_cron tick
    // (refresh_metrics_tick), not here. The old synchronous refresh_company_metrics()
    // call refreshed all 13 MVs in one statement and reliably hit the edge/cron
    // statement timeout BEFORE reaching the 6 by-location MVs, which is what left
    // newly-collected companies/locations showing null when filtered by location.
    // Landing the responses above bumps mv_refresh_watermark via a trigger, so the
    // tick picks the affected MVs up within minutes. See migration
    // 20260628000001_metrics_refresh_tick.sql.
    // (This block was hotfixed in the deployed bundle on ~2026-07-14 without a
    // matching commit; adopted into the repo 2026-07-29 to close the drift.)

    console.log("Collection complete:", results);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${results.promptsProcessed} prompts and collected ${results.responsesCollected} responses for ${company.name}`,
        results,
        summary: {
          batchesProcessed,
          totalPrompts,
          totalOperations: totalPrompts * models.length,
          promptsProcessed: results.promptsProcessed,
          responsesCollected: results.responsesCollected,
          errorsCount: results.errors.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("Error collecting company responses:", error);
    console.error("Error stack:", error.stack);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Failed to collect company responses",
        details:
          process.env.DENO_ENV === "development" ? error.stack : undefined,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
