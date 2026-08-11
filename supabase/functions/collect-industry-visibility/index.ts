import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { SOURCES_SECTION_REGEX, unwrapTranslateUrl } from "../_shared/citation-extraction.ts";
import { COUNTRY_CODE_TO_NAME } from "../_shared/countries.ts";

// OpenAI model for bulk industry collection. The client-facing collection path
// (test-prompt-openai) deliberately runs gpt-5.5 to mirror ChatGPT's live
// default; this internal rankings pipeline just needs mention/citation data at
// minimum cost, so it runs OpenAI's cheapest tier (nano) instead.
const OPENAI_MODEL = "gpt-5-nano";
// Earlier runs stored OpenAI responses under these names; a response under any
// of them still counts as "already collected" so we don't pay to re-collect.
const LEGACY_OPENAI_MODELS = ["gpt-5.2-chat-latest"];

/**
 * Apply `unwrapTranslateUrl` to every citation in a list so the stored
 * prompt_responses.citations never contains translate.google.com redirects.
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
      // Optional subset of models to collect — defaults to all 3.
      // Valid values: 'openai', 'perplexity', 'gemini'
      models = null,
    } = body;
    // The admin UI shipped 'google-ai-overviews' as the Google-leg id before
    // that leg moved to Gemini (Aug 2026) — accept it as an alias so older
    // clients still collect the leg instead of silently skipping it.
    const MODEL_ID_ALIASES: Record<string, string> = {
      "google-ai-overviews": "gemini",
    };
    const KNOWN_MODEL_IDS = ["openai", "perplexity", "gemini"];
    const modelsFilter: string[] | null =
      Array.isArray(models) && models.length > 0
        ? models.map((m: string) => MODEL_ID_ALIASES[m] ?? m)
        : null;
    const unknownModelIds = (modelsFilter ?? []).filter(
      (m) => !KNOWN_MODEL_IDS.includes(m) && m !== OPENAI_MODEL,
    );

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

    // Get or create a system user for these prompts (or use first admin user)
    const { data: adminUser, error: adminUserError } = await supabase
      .from("profiles")
      .select("id")
      .limit(1)
      .single();

    if (adminUserError) {
      console.error("Error fetching admin user:", adminUserError);
      throw new Error(`Failed to get admin user: ${adminUserError.message}`);
    }

    if (!adminUser) {
      console.error("No admin user found");
      throw new Error("No user found to associate prompts with");
    }

    console.log("Using admin user:", adminUser.id);

    const results = {
      promptsCreated: 0,
      responsesCollected: 0,
      errors: [] as string[],
    };

    if (unknownModelIds.length > 0) {
      // A model id that matches nothing must be loud: a typo here silently
      // drops an entire collection leg otherwise.
      console.error("Unknown model id(s) in request:", unknownModelIds);
      results.errors.push(
        `Unknown model id(s) in models filter: ${unknownModelIds.join(", ")} — known ids: ${KNOWN_MODEL_IDS.join(", ")}`,
      );
    }

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
        t.text.replace(/{industry}/g, industry),
        promptLocation,
      ),
    }));

    console.log(
      `Prompt list:`,
      allPrompts.map((p) => `${p.theme} (${p.category})`).join(", "),
    );

    // PHASE 1: Create all prompts first (fast, no API calls)
    console.log(`PHASE 1: Creating all ${allPrompts.length} prompts`);

    const promptsWithIds: Array<{
      promptData: {
        attributeId: string;
        category: string;
        theme: string;
        text: string;
      };
      promptId: string;
    }> = [];

    for (let i = 0; i < allPrompts.length; i++) {
      const promptData = allPrompts[i];

      let promptId: string | null = null;

      try {
        // Try to insert directly - faster than checking first
        // If it's a duplicate, we'll catch the error and get the existing ID
        try {
          const { data: newPrompt, error: promptError } = await supabase
            .from("confirmed_prompts")
            .insert({
              user_id: adminUser.id,
              company_id: null,
              onboarding_id: null,
              prompt_text: promptData.text,
              prompt_type: "discovery",
              prompt_category: promptData.category,
              prompt_theme: promptData.theme,
              attribute_id: promptData.attributeId,
              industry_context: industry,
              location_context: dbLocationContext,
              is_active: true,
              prompt_version: 2,
            })
            .select("id")
            .single();

          if (promptError) {
            // If it's a unique constraint violation, the prompt already exists - get the existing ID
            if (
              promptError.code === "23505" ||
              promptError.message?.includes("duplicate") ||
              promptError.message?.includes("unique")
            ) {
              console.log(
                `[${i + 1}/${allPrompts.length}] Prompt already exists, fetching existing ID...`,
              );

              let query = supabase
                .from("confirmed_prompts")
                .select("id")
                .is("company_id", null)
                .eq("prompt_type", "discovery")
                .eq("prompt_category", promptData.category)
                .eq("prompt_theme", promptData.theme)
                // Pin to the v2 row — legacy pre-attribute rows share some
                // theme names (e.g. "Company Culture") but have null attribute_id.
                .eq("attribute_id", promptData.attributeId)
                .eq("industry_context", industry);

              if (dbLocationContext) {
                query = query.eq("location_context", dbLocationContext);
              } else {
                query = query.is("location_context", null);
              }

              const { data: existingPrompts } = await query.limit(1);

              if (existingPrompts && existingPrompts.length > 0) {
                promptId = existingPrompts[0].id;
                console.log(
                  `[${i + 1}/${allPrompts.length}] → Using existing prompt ${promptId} for ${promptData.theme}`,
                );
              } else {
                console.error(
                  `[${i + 1}/${allPrompts.length}] Duplicate error but couldn't find existing prompt`,
                );
                results.errors.push(
                  `Duplicate error for ${promptData.theme} but couldn't retrieve ID`,
                );
              }
            } else {
              // Some other error
              console.error(
                `[${i + 1}/${allPrompts.length}] Failed to create prompt:`,
                {
                  error: promptError.message,
                  code: promptError.code,
                },
              );
              results.errors.push(
                `Failed to create prompt for ${promptData.theme}: ${promptError.message}`,
              );
            }
          } else if (newPrompt && newPrompt.id) {
            promptId = newPrompt.id;
            results.promptsCreated++;
            console.log(
              `[${i + 1}/${allPrompts.length}] ✓ Created prompt ${promptId} for ${promptData.theme}`,
            );
          } else {
            console.error(
              `[${i + 1}/${allPrompts.length}] Prompt creation returned no ID`,
            );
            results.errors.push(
              `Prompt creation failed for ${promptData.theme}: No ID returned`,
            );
          }
        } catch (insertError: any) {
          console.error(
            `[${i + 1}/${allPrompts.length}] Exception during prompt creation:`,
            insertError.message,
          );
          results.errors.push(
            `Exception creating prompt ${promptData.theme}: ${insertError.message}`,
          );
        }
      } catch (error: any) {
        console.error(
          `[${i + 1}/${allPrompts.length}] CRITICAL ERROR processing prompt ${promptData.theme}:`,
          error.message,
          error.stack,
        );
        results.errors.push(
          `Critical error processing prompt ${promptData.theme}: ${error.message}`,
        );
        // Continue to next prompt - don't let one failure stop the whole process
      }

      // Only add to promptsWithIds if we have a valid promptId
      if (promptId) {
        promptsWithIds.push({ promptData, promptId });
        console.log(
          `[${i + 1}/${allPrompts.length}] ✓ Added ${promptData.theme} to collection list (ID: ${promptId})`,
        );
      } else {
        console.warn(
          `[${i + 1}/${allPrompts.length}] ⚠ Skipping ${promptData.theme} - no prompt ID available`,
        );
      }

      // Log completion of this iteration
      console.log(
        `[${i + 1}/${allPrompts.length}] Iteration ${i + 1} COMPLETE. Total processed so far: ${promptsWithIds.length} prompts with IDs`,
      );

      // Force a small delay to prevent overwhelming the database
      if (i < allPrompts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    console.log(
      `✅ LOOP COMPLETE: Processed all ${allPrompts.length} prompts. Total with IDs: ${promptsWithIds.length}`,
    );
    console.log(
      `Prompts processed:`,
      promptsWithIds.map((p) => p.promptData.theme).join(", "),
    );

    if (promptsWithIds.length < allPrompts.length) {
      const missing = allPrompts.filter(
        (p) => !promptsWithIds.find((pid) => pid.promptData.theme === p.theme),
      );
      console.warn(
        `⚠️ WARNING: Only ${promptsWithIds.length} of ${allPrompts.length} prompts were processed!`,
      );
      console.warn(`Missing prompts:`, missing.map((p) => p.theme).join(", "));
    }

    console.log(
      `PHASE 1 COMPLETE: Processed ${allPrompts.length} prompts, successfully created/found ${promptsWithIds.length} prompts`,
    );
    console.log(`  - Prompts created: ${results.promptsCreated}`);
    console.log(`  - Errors encountered: ${results.errors.length}`);
    console.log(
      `  - Prompts ready for response collection: ${promptsWithIds.length}`,
    );

    if (promptsWithIds.length === 0) {
      console.error("WARNING: No prompts were created or found!");
      return new Response(
        JSON.stringify({
          success: false,
          error: "No prompts were created or found",
          results,
          message: `Failed to create any prompts. Errors: ${results.errors.length}`,
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
        // Check if we already have responses for each model
        const { data: existingResponseGPT, error: responseCheckErrorGPT } =
          await supabase
            .from("prompt_responses")
            .select("id, ai_model, tested_at")
            .eq("confirmed_prompt_id", promptId)
            .in("ai_model", [OPENAI_MODEL, ...LEGACY_OPENAI_MODELS])
            .limit(1)
            .maybeSingle();

        const {
          data: existingResponsePerplexity,
          error: responseCheckErrorPerplexity,
        } = await supabase
          .from("prompt_responses")
          .select("id, ai_model, tested_at")
          .eq("confirmed_prompt_id", promptId)
          .eq("ai_model", "perplexity")
          .maybeSingle();

        const {
          data: existingResponseGemini,
          error: responseCheckErrorGemini,
        } = await supabase
          .from("prompt_responses")
          .select("id, ai_model, tested_at")
          .eq("confirmed_prompt_id", promptId)
          .eq("ai_model", "gemini")
          .maybeSingle();

        // Collect responses for each model that doesn't exist yet
        const modelsToCollect = [
          {
            name: OPENAI_MODEL,
            exists: !!existingResponseGPT,
            type: "openai",
          },
          {
            name: "perplexity",
            exists: !!existingResponsePerplexity,
            type: "perplexity",
          },
          {
            name: "gemini",
            exists: !!existingResponseGemini,
            type: "gemini",
          },
        ]
          .filter((m) => !m.exists)
          // If caller passed `models`, restrict to that subset. Match by `type`
          // (e.g. 'openai') so the UI can pass simple identifiers.
          .filter((m) => !modelsFilter || modelsFilter.includes(m.type) || modelsFilter.includes(m.name));

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
                    max_completion_tokens: 1000,
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
            }

            if (!responseText) {
              throw new Error(`No response from ${model.name}`);
            }

            console.log(
              `Received response from ${model.name} for ${promptData.theme} (${responseText.length} chars)`,
            );

            // Store response
            const { data: insertedResponse, error: insertError } =
              await supabase
                .from("prompt_responses")
                .insert({
                  confirmed_prompt_id: promptId,
                  ai_model: model.name,
                  response_text: responseText,
                  citations:
                    model.type === "openai"
                      ? unwrapCitations(citations)
                      : model.type === "perplexity"
                        ? unwrapCitations(citations)
                        : model.type === "gemini"
                          ? unwrapCitations(citations)
                          : [],
                  company_id: null, // Industry-wide response
                  company_mentioned: false,
                  detected_competitors: "",
                  for_index: true,
                })
                .select()
                .single();

            if (insertError) {
              throw new Error(`Error storing response: ${insertError.message}`);
            }

            // Extract ALL companies mentioned from the response
            let detectedCompetitors = "";
            try {
              console.log(
                `Calling detect-competitors for ${promptData.theme} (${model.name})...`,
              );
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

            // Update the response with detected competitors
            if (detectedCompetitors) {
              const { error: updateError } = await supabase
                .from("prompt_responses")
                .update({ detected_competitors: detectedCompetitors })
                .eq("id", insertedResponse.id);

              if (updateError) {
                console.error(
                  `Error updating competitors: ${updateError.message}`,
                );
              }
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
