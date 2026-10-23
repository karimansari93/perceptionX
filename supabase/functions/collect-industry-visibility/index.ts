import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { SOURCES_SECTION_REGEX, unwrapTranslateUrl } from "../_shared/citation-extraction.ts";
import { COUNTRY_CODE_TO_NAME } from "../_shared/countries.ts";
import { claudeFetch } from "../_shared/claude-keys.ts";

// OpenAI model for bulk industry collection. The client-facing collection path
// (test-prompt-openai) deliberately runs gpt-5.5 to mirror ChatGPT's live
// default; this internal rankings pipeline just needs mention/citation data at
// minimum cost, so it runs OpenAI's cheapest tier (nano) instead.
const OPENAI_MODEL = "gpt-5-nano";
// Claude leg (October 2026): replaces Perplexity Sonar, whose $5 per 1,000
// requests search fee was ~85% of the pipeline's cost. Haiku answers from the
// model's own knowledge (no web search), like the OpenAI and Gemini legs.
const CLAUDE_MODEL = "claude-haiku-5-5";
// Models collected when the caller doesn't pass `models`. Perplexity stays
// selectable explicitly but is no longer part of a default run.
const DEFAULT_MODEL_TYPES = ["openai", "claude", "gemini"];
// Index prompts and answers live in index_prompts / index_responses, apart
// from client data in confirmed_prompts / prompt_responses. Index answers are
// never themed. job_function null = industry-wide prompt; otherwise the prompt
// asks about that function's roles within the industry.

/**
 * Apply `unwrapTranslateUrl` to every citation in a list so the stored
 * index_responses.citations never contains translate.google.com redirects.
 * Re-derives `domain` from the unwrapped URL so analytics aggregates correctly.
 */
function unwrapCitations(citations: any[]): any[] {
  if (!Array.isArray(citations)) return [];
  return citations
    .filter((c) => c && typeof c.url === "string" && c.url.trim().length > 0)
    .map((c) => {
      const originalUrl = (c.url as string).trim();
      const url = unwrapTranslateUrl(originalUrl);
      const wasUnwrapped = url !== originalUrl;
      let domain = wasUnwrapped ? undefined : c.domain;
      if (!domain) {
        try {
          domain = new URL(url).hostname.replace("www.", "");
        } catch {
          domain = url;
        }
      }
      return { ...c, url, domain };
    });
}

// Extract citations from OpenAI response (all app languages)
function extractCitationsFromResponse(text: string): any[] {
  const citations: any[] = [];
  const seenUrls = new Set<string>();
  const urlPattern = /https?:\/\/([^\s\)]+)/g;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(text)) !== null) {
    const url = match[0].replace(/[.,;:!?]+$/, "");
    if (!seenUrls.has(url)) {
      try {
        const domain = new URL(url).hostname.replace("www.", "");
        citations.push({ url, domain, title: `Source from ${domain}` });
        seenUrls.add(url);
      } catch (_e) {}
    }
  }
  const citationPattern = /\[(\d+)\][\s]*([^\[]*?)(?:https?:\/\/[^\s\)]+)?/g;
  while ((match = citationPattern.exec(text)) !== null) {
    const num = match[1];
    const context = match[2]?.trim();
    const nearbyText = text.substring(Math.max(0, match.index - 50), match.index + 200);
    const urlMatch = nearbyText.match(/https?:\/\/([^\s\)]+)/);
    const citationKey = `citation-${num}`;
    if (!seenUrls.has(citationKey)) {
      citations.push({
        domain: context || "unknown",
        title: `Citation [${num}]${context ? `: ${context}` : ""}`,
        url: urlMatch ? urlMatch[0] : undefined,
      });
      seenUrls.add(citationKey);
    }
  }
  const sourcesMatch = text.match(SOURCES_SECTION_REGEX);
  if (sourcesMatch) {
    const sourcesText = sourcesMatch[1];
    const sourceUrls = sourcesText.match(/https?:\/\/([^\s\n\)]+)/g) || [];
    sourceUrls.forEach((url: string) => {
      if (!seenUrls.has(url)) {
        try {
          const domain = new URL(url).hostname.replace("www.", "");
          citations.push({ url, domain, title: `Source from ${domain}` });
          seenUrls.add(url);
        } catch (_e) {}
      }
    });
  }
  return citations;
}

serve(async (req) => {
  console.log("collect-industry-visibility function called", {
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
      industry,
      companyId,
      country = "US",
      countryName = null,
      skipResponses = false,
      batchOffset = 0,
      batchSize = null,
      // Optional subset of models to collect — defaults to DEFAULT_MODEL_TYPES.
      // Valid values: 'openai', 'claude', 'gemini', 'perplexity'
      models = null,
      // Optional job function, e.g. "Software Engineering". When set, every
      // prompt asks about that function's roles within the industry.
      jobFunction = null,
    } = body;
    const modelsFilter: string[] = Array.isArray(models) && models.length > 0 ? models : DEFAULT_MODEL_TYPES;
    const jobFunctionContext: string | null =
      typeof jobFunction === "string" && jobFunction.trim().length > 0 ? jobFunction.trim() : null;

    if (!industry) {
      console.error("Industry is required but not provided");
      return new Response(JSON.stringify({ error: "Industry is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine location text for prompt (use full name if available, e.g. "United States" instead of "US")
    // const promptLocation = (country === 'GLOBAL') ? undefined : (countryName || country);
    // Use full country name in prompt text if available, otherwise fall back to code
    // const countryNameForPrompt = countryName || country;

    // If we have a country name provided, use it. Otherwise, look up the code in our map.
    // Fallback to the code itself if it's not in our list (though it should be).
    const resolvedCountryName =
      countryName || COUNTRY_CODE_TO_NAME[country] || country;

    // Set the location context for the database.
    // If 'GLOBAL' is selected, we store null to indicate no specific country constraint.
    const dbLocationContext = country === "GLOBAL" ? null : resolvedCountryName;

    // Methodology v2 (July 2026): the industry-wide visibility set mirrors the
    // discovery-intent prompts of the 13 company-batch attributes — the same
    // ATTRIBUTE_PROMPT_TEMPLATES used by process-company-batch-queue /
    // src/config/attributes.ts. 9 Employee Experience + 4 Candidate Experience.
    // Keep wording, themes, and attribute ids in lockstep with that list.
    const DISCOVERY_PROMPTS: Array<{
      attributeId: string;
      category: string;
      theme: string;
      text: string; // {industry} placeholder, location appended separately
    }> = [
      { attributeId: "mission-purpose-impact", category: "Employee Experience", theme: "Mission, Purpose & Impact", text: "Which companies in {industry} are known for a strong sense of purpose and positive impact?" },
      { attributeId: "compensation", category: "Employee Experience", theme: "Compensation", text: "Which companies in {industry} pay the best and offer the best benefits and perks?" },
      { attributeId: "company-culture", category: "Employee Experience", theme: "Company Culture", text: "Which companies in {industry} have the best workplace culture?" },
      { attributeId: "leadership", category: "Employee Experience", theme: "Leadership", text: "Which companies in {industry} are known for great leadership and management?" },
      { attributeId: "job-security", category: "Employee Experience", theme: "Job Security", text: "Which companies in {industry} offer the most stable and secure jobs?" },
      { attributeId: "career-opportunities", category: "Employee Experience", theme: "Career Opportunities", text: "Which companies in {industry} are best for career growth and learning?" },
      { attributeId: "wellbeing-balance", category: "Employee Experience", theme: "Wellbeing & Balance", text: "Which companies in {industry} are best for work-life balance and flexible or remote work?" },
      { attributeId: "inclusion", category: "Employee Experience", theme: "Inclusion", text: "Which companies in {industry} are most recognized for diversity, equity, and inclusion?" },
      { attributeId: "innovation", category: "Employee Experience", theme: "Innovation", text: "Which companies in {industry} are the most innovative to work for?" },
      { attributeId: "application-communication", category: "Candidate Experience", theme: "Application & Communication", text: "Which companies in {industry} have the best application process and candidate communication?" },
      { attributeId: "candidate-feedback", category: "Candidate Experience", theme: "Candidate Feedback", text: "Which companies in {industry} are known for giving candidates valuable feedback?" },
      { attributeId: "interview-experience", category: "Candidate Experience", theme: "Interview Experience", text: "Which companies in {industry} have the best interview experience?" },
      { attributeId: "onboarding-experience", category: "Candidate Experience", theme: "Onboarding", text: "Which companies in {industry} have the best onboarding for new hires?" },
    ];

    const promptLocation =
      country === "GLOBAL" ? undefined : resolvedCountryName;

    // "...best workplace culture?" -> "...best workplace culture for Sales roles?"
    const appendJobFunction = (text: string, fn: string | null): string => {
      if (!fn) return text;
      const trimmed = text.trim();
      const suffix = ` for ${fn} roles`;
      if (trimmed.endsWith("?")) return trimmed.replace(/\?$/, `${suffix}?`);
      return `${trimmed}${suffix}`;
    };

    // Same behavior as the batch pipeline's appendPromptContext: append the
    // location before the trailing "?" unless the text already mentions it.
    const appendLocationContext = (text: string, location?: string): string => {
      if (!location) return text;
      const trimmed = text.trim();
      if (trimmed.toLowerCase().includes(location.toLowerCase())) return trimmed;
      const suffix = ` in ${location}`;
      if (trimmed.endsWith("?")) return trimmed.replace(/\?$/, `${suffix}?`);
      if (trimmed.endsWith(".")) return trimmed.replace(/\.$/, `${suffix}.`);
      return `${trimmed}${suffix}`;
    };

    console.log(
      "Starting collection for industry:",
      industry,
      "country:",
      country,
      "promptLocation:",
      promptLocation,
    );

    // Initialize Supabase with service role key
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const results = {
      promptsCreated: 0,
      responsesCollected: 0,
      errors: [] as string[],
    };

    // Create industry-wide prompts (NOT tied to specific companies)
    // These prompts ask the AI which companies are visible in the industry/market
    const allPrompts: Array<{
      attributeId: string;
      category: string;
      theme: string;
      text: string;
    }> = DISCOVERY_PROMPTS.map((t) => ({
      attributeId: t.attributeId,
      category: t.category,
      theme: t.theme,
      text: appendLocationContext(
        appendJobFunction(t.text.replace(/{industry}/g, industry), jobFunctionContext),
        promptLocation,
      ),
    }));

    console.log(
      `Prompt list:`,
      allPrompts.map((p) => `${p.theme} (${p.category})`).join(", "),
    );

    // PHASE 1: Create or fetch all prompts in one upsert (no API calls)
    const { data: promptRows, error: promptError } = await supabase
      .from("index_prompts")
      .upsert(
        allPrompts.map((p) => ({
          prompt_text: p.text,
          attribute_id: p.attributeId,
          prompt_category: p.category,
          prompt_theme: p.theme,
          industry,
          country: dbLocationContext,
          job_function: jobFunctionContext,
          prompt_version: 2,
        })),
        { onConflict: "industry,country,job_function,attribute_id,prompt_version" },
      )
      .select("id, attribute_id");

    if (promptError) {
      throw new Error(`Failed to create index prompts: ${promptError.message}`);
    }

    const idByAttribute = new Map(
      (promptRows || []).map((r: any) => [r.attribute_id, r.id as string]),
    );
    // Keep DISCOVERY_PROMPTS order so batchOffset is stable across calls.
    const promptsWithIds = allPrompts
      .filter((p) => idByAttribute.has(p.attributeId))
      .map((p) => ({ promptData: p, promptId: idByAttribute.get(p.attributeId)! }));
    results.promptsCreated = promptsWithIds.length;

    if (promptsWithIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No prompts were created or found",
          results,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    // Skip response collection if requested (to avoid timeouts)
    if (skipResponses) {
      console.log(
        `Skipping PHASE 2 (response collection) as requested. All ${promptsWithIds.length} prompts created successfully.`,
      );
      return new Response(
        JSON.stringify({
          success: true,
          message: `Created ${results.promptsCreated} industry-wide prompts for ${industry}${country && country !== "GLOBAL" ? ` in ${country}` : ""}. Response collection skipped.`,
          results: {
            ...results,
            skippedResponseCollection: true,
          },
          summary: {
            totalPromptsProcessed: allPrompts.length,
            promptsCreated: results.promptsCreated,
            responsesCollected: 0,
            errorsCount: results.errors.length,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Determine batch range
    const totalPrompts = promptsWithIds.length;
    const startIndex = Math.min(Math.max(0, batchOffset), totalPrompts);
    const endIndex =
      batchSize && batchSize > 0
        ? Math.min(totalPrompts, startIndex + batchSize)
        : totalPrompts;
    const batch = promptsWithIds.slice(startIndex, endIndex);
    console.log(
      `Starting PHASE 2: Response collection for batch ${startIndex + 1}-${endIndex} of ${totalPrompts} prompts (size: ${batch.length}).`,
    );
    console.log(
      `⚠️ WARNING: This may timeout if processing too many prompts × 3 models = ${batch.length * 3} API calls`,
    );

    // PHASE 2: Collect responses for the batch
    for (let i = 0; i < batch.length; i++) {
      const { promptData, promptId } = batch[i];
      const globalIndex = startIndex + i + 1;
      console.log(
        `[${globalIndex}/${totalPrompts}] Collecting responses for: ${promptData.theme} (${promptData.category}) [batch ${i + 1}/${batch.length}]`,
      );

      try {
        // Models already answered for this prompt in the current period
        const { data: existingRows, error: existingError } = await supabase
          .from("index_responses")
          .select("ai_model")
          .eq("index_prompt_id", promptId)
          .is("index_period", null);
        if (existingError) {
          throw new Error(`Error checking existing responses: ${existingError.message}`);
        }
        const existingModels = new Set((existingRows || []).map((r: any) => r.ai_model));

        // Collect responses for each requested model that doesn't exist yet.
        // Match by `type` (e.g. 'openai') so the UI can pass simple identifiers.
        const modelsToCollect = [
          { name: OPENAI_MODEL, type: "openai" },
          { name: "perplexity", type: "perplexity" },
          { name: "gemini", type: "gemini" },
          { name: CLAUDE_MODEL, type: "claude" },
        ]
          .filter((m) => modelsFilter.includes(m.type) || modelsFilter.includes(m.name))
          .filter((m) => !existingModels.has(m.name));

        // Run models in PARALLEL to avoid timeouts
        const modelPromises = modelsToCollect.map(async (model) => {
          try {
            let responseText = "";
            let citations: any[] = [];

            if (model.type === "openai") {
              // OpenAI API call
              const openaiResponse = await fetch(
                "https://api.openai.com/v1/chat/completions",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    model: model.name,
                    messages: [
                      {
                        role: "user",
                        content: promptData.text,
                      },
                    ],
                    // max_tokens: 1000, // Not supported by gpt-5.x models — use max_completion_tokens
                    // 2000, not 1000: nano's pay-and-benefits answers average
                    // ~1,000 tokens, and ~9% of them hit a 1,000 cap and came
                    // back as empty text (October 2026 index run).
                    max_completion_tokens: 2000,
                    // gpt-5-nano is a reasoning model: without this, default
                    // reasoning can eat the whole completion budget and return
                    // empty text. Minimal effort also keeps cost lowest.
                    // (Only gpt-5 series accepts reasoning_effort — drop it if
                    // switching back to a *-chat-latest model.)
                    reasoning_effort: "minimal",
                    // temperature: 0.7 // Not supported by some newer reasoning models, safer to omit if using reasoning models or set to 1
                  }),
                },
              );

              if (!openaiResponse.ok) {
                const errorText = await openaiResponse.text();
                console.error(
                  `[OpenAI] API Error (${openaiResponse.status}):`,
                  errorText,
                );
                try {
                  const errorJson = JSON.parse(errorText);
                  throw new Error(
                    `${model.name} API error: ${errorJson.error?.message || "Unknown error"}`,
                  );
                } catch (e) {
                  throw new Error(`${model.name} API error: ${errorText}`);
                }
              }

              const openaiData = await openaiResponse.json();
              responseText = openaiData.choices?.[0]?.message?.content || "";
              citations = extractCitationsFromResponse(responseText);
            } else if (model.type === "perplexity") {
              // Perplexity edge function
              const perplexityResponse = await fetch(
                `${supabaseUrl}/functions/v1/test-prompt-perplexity`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ prompt: promptData.text }),
                },
              );

              if (!perplexityResponse.ok) {
                const errorData = await perplexityResponse.json();
                throw new Error(
                  `Perplexity error: ${errorData.error || "Unknown error"}`,
                );
              }

              const perplexityData = await perplexityResponse.json();
              responseText = perplexityData.response || "";
              citations = perplexityData.citations || [];
            } else if (model.type === "gemini") {
              // Gemini edge function (gemini-2.5-flash-lite, no web grounding).
              // Prompt text is already localized per market, so no
              // location_context is needed here.
              const geminiResponse = await fetch(
                `${supabaseUrl}/functions/v1/test-prompt-gemini`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ prompt: promptData.text }),
                },
              );

              if (!geminiResponse.ok) {
                const errorData = await geminiResponse.json();
                throw new Error(
                  `Gemini error: ${errorData.error || "Unknown error"}`,
                );
              }

              const geminiData = await geminiResponse.json();
              responseText = geminiData.response || "";
              // Same as the OpenAI leg: no grounded citations, so pull any
              // URLs the model wrote into the text.
              citations = extractCitationsFromResponse(responseText);
            } else if (model.type === "claude") {
              // Claude Haiku, no web search, thinking off: same answer budget
              // as the OpenAI leg and the lowest cost per answer.
              const claudeResponse = await claudeFetch(
                "https://api.anthropic.com/v1/messages",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "anthropic-version": "2023-06-01",
                  },
                  body: JSON.stringify({
                    model: model.name,
                    max_tokens: 1000,
                    thinking: { type: "disabled" },
                    messages: [{ role: "user", content: promptData.text }],
                  }),
                },
              );
              const claudeData = await claudeResponse.json();
              if (!claudeResponse.ok) {
                throw new Error(
                  `${model.name} API error: ${claudeData?.error?.message || claudeResponse.status}`,
                );
              }
              responseText = (claudeData.content || [])
                .filter((b: any) => b.type === "text")
                .map((b: any) => b.text)
                .join("\n")
                .trim();
              citations = extractCitationsFromResponse(responseText);
            }

            if (!responseText) {
              throw new Error(`No response from ${model.name}`);
            }

            console.log(
              `Received response from ${model.name} for ${promptData.theme} (${responseText.length} chars)`,
            );

            // Extract ALL companies mentioned from the response
            let detectedCompetitors = "";
            try {
              const competitorResponse = await fetch(
                `${supabaseUrl}/functions/v1/detect-competitors`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    response: responseText,
                    companyName: "",
                  }),
                },
              );

              if (competitorResponse.ok) {
                const competitorData = await competitorResponse.json();
                detectedCompetitors = competitorData.detectedCompetitors || "";
              }
            } catch (compError: any) {
              console.warn(
                `Error detecting competitors for ${promptData.theme}:`,
                compError.message,
              );
            }

            // Store in the index tables (never prompt_responses). A duplicate
            // from an overlapping run is ignored by the unique key.
            const { error: insertError } = await supabase
              .from("index_responses")
              .upsert(
                {
                  index_prompt_id: promptId,
                  ai_model: model.name,
                  response_text: responseText,
                  citations: unwrapCitations(citations),
                  detected_competitors: detectedCompetitors,
                },
                { onConflict: "index_prompt_id,ai_model,index_period", ignoreDuplicates: true },
              );

            if (insertError) {
              throw new Error(`Error storing response: ${insertError.message}`);
            }

            results.responsesCollected++;
            return { success: true, model: model.name };
          } catch (error: any) {
            console.error(
              `ERROR in model ${model.name} for ${promptData.theme}:`,
              error.message,
            );
            results.errors.push(
              `Error collecting ${model.name} response for ${promptData.theme}: ${error.message}`,
            );
            return { success: false, model: model.name, error: error.message };
          }
        });

        // Wait for all models to complete
        await Promise.all(modelPromises);

        console.log(
          `[${i + 1}/${promptsWithIds.length}] All models processed for ${promptData.theme}. Moving to next prompt...`,
        );
      } catch (error: any) {
        console.error(
          `[${globalIndex}/${totalPrompts}] ERROR collecting responses for ${promptData.theme}:`,
          error.message,
        );
        results.errors.push(
          `Error collecting responses for ${promptData.theme}: ${error.message}`,
        );
      }

      console.log(
        `[${globalIndex}/${totalPrompts}] Completed response collection for: ${promptData.theme}`,
      );
    }

    console.log(
      `PHASE 2 COMPLETE for batch ${startIndex + 1}-${endIndex} of ${totalPrompts}. Created: ${results.promptsCreated} prompts, Collected: ${results.responsesCollected} responses, Errors: ${results.errors.length}`,
    );

    console.log("Collection complete:", results);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Created ${results.promptsCreated} prompts. Collected ${results.responsesCollected} responses for batch ${startIndex + 1}-${endIndex} of ${totalPrompts} in ${industry}${country && country !== "GLOBAL" ? `, ${country}` : ""}.`,
        results,
        summary: {
          batchStart: startIndex + 1,
          batchEnd: endIndex,
          totalPrompts,
          promptsCreated: results.promptsCreated,
          responsesCollected: results.responsesCollected,
          errorsCount: results.errors.length,
          skippedResponseCollection: false,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("Error collecting industry visibility:", error);
    console.error("Error stack:", error.stack);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Failed to collect visibility responses",
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
