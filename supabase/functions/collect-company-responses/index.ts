import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

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
    } = body;

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

    // Resolve organization_id from organization_companies (company can belong to one or more orgs)
    const { data: orgLink } = await supabase
      .from("organization_companies")
      .select("organization_id")
      .eq("company_id", companyId)
      .limit(1)
      .single();

    const organizationId = orgLink?.organization_id ?? null;

    // Get organization owner to determine subscription type (only if company is linked to an org)
    let orgMember: { user_id: string; role: string } | null = null;
    let orgMemberError: Error | null = null;
    if (organizationId) {
      const res = await supabase
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", organizationId)
        .eq("role", "owner")
        .limit(1)
        .single();
      orgMember = res.data;
      orgMemberError = res.error;
    }

    if (orgMemberError) {
      console.warn("Could not determine subscription, defaulting to free models");
    }

    let isProUser = false;
    if (!orgMemberError && orgMember) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("subscription_type")
        .eq("id", orgMember.user_id)
        .single();

      isProUser = profileData?.subscription_type === "pro";
    }

    console.log(`Subscription type: ${isProUser ? "Pro" : "Free"}`);

    // Fetch prompts for this company
    let promptsQuery = supabase
      .from("confirmed_prompts")
      .select("*")
      .eq("is_active", true);

    // If promptIds are provided, use them directly
    // Otherwise, filter by company_id
    if (promptIds && promptIds.length > 0) {
      promptsQuery = promptsQuery.in("id", promptIds);
      // Note: We trust that promptIds belong to the company
      // The trigger should have set company_id, but we allow null for prompts not yet linked
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

    const { data: allPrompts, error: promptsError } = await promptsQuery;

    if (promptsError) {
      throw new Error(`Failed to fetch prompts: ${promptsError.message}`);
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

    for (let batchOffset = 0; batchOffset < totalPrompts; batchOffset += batchSize) {
      const batchEnd = Math.min(batchOffset + batchSize, totalPrompts);
      const batch = allPrompts.slice(batchOffset, batchEnd);

      console.log(
        `Processing batch ${batchesProcessed + 1}: prompts ${batchOffset + 1}-${batchEnd} of ${totalPrompts} (parallel prompts + parallel models)`,
      );

      // Process all prompts in this batch in PARALLEL (each prompt runs its models in parallel)
      const promptPromises = batch.map(async (prompt: any) => {
        try {
          // Check existing responses if skipExisting is true
          let modelsToProcess = [...models];
          if (skipExisting) {
            const { data: existingResponses } = await supabase
              .from("prompt_responses")
              .select("ai_model")
              .eq("confirmed_prompt_id", prompt.id)
              .eq("company_id", companyId);

            const existingModels = new Set(
              existingResponses?.map((r: any) => r.ai_model) || [],
            );
            modelsToProcess = models.filter((m) => !existingModels.has(m));

            if (modelsToProcess.length === 0) {
              console.log(
                `Skipping prompt ${prompt.id}: all models already have responses`,
              );
              return;
            }
          }

          // Run models in PARALLEL for this prompt
          const modelPromises = modelsToProcess.map(async (modelName: string) => {
            try {
              let responseText = "";
              let citations: any[] = [];

              // Call edge function for each model (same pattern: test-prompt-openai, test-prompt-perplexity, test-prompt-google-ai-overviews)
              const functionName = `test-prompt-${modelName}`;
              const modelResponse = await fetch(
                `${supabaseUrl}/functions/v1/${functionName}`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ prompt: prompt.prompt_text }),
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
                      modelName === "bing-copilot"
                        ? citations
                        : null,
                    confirmed_prompt_id: prompt.id,
                    ai_model: modelName,
                    company_id: companyId,
                    isTalentXPrompt: prompt.is_pro_prompt || false,
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

    // Refresh materialized views so dashboard metrics (sentiment, relevance) include new data
    try {
      const { error: refreshError } = await supabase.rpc("refresh_company_metrics");
      if (refreshError) {
        console.warn("refresh_company_metrics failed (non-fatal):", refreshError.message);
      }
    } catch (refreshErr: any) {
      console.warn("refresh_company_metrics error (non-fatal):", refreshErr?.message);
    }

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
