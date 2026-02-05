import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { SOURCES_SECTION_REGEX } from "../_shared/citation-extraction.ts";

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

// Visibility prompt templates for Employee Experience and Candidate Experience
const VISIBILITY_PROMPTS = {
  "Employee Experience": [
    {
      theme: "Mission & Purpose",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} are known for having a strong, purpose-driven employer brand?`;
      },
    },
    {
      theme: "Rewards & Recognition",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} are known for having exceptional rewards and recognition for employees?`;
      },
    },
    {
      theme: "Company Culture",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} are known for outstanding workplace culture?`;
      },
    },
    {
      theme: "Social Impact",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} are recognized for meaningful social impact and community engagement?`;
      },
    },
    {
      theme: "Inclusion",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} are most recognized for diversity, equity, and inclusion?`;
      },
    },
    {
      theme: "Innovation",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} are known for fostering innovation and creative thinking?`;
      },
    },
    {
      theme: "Wellbeing & Balance",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} are recognized for exceptional employee wellbeing and work-life balance?`;
      },
    },
    {
      theme: "Leadership",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} are respected for outstanding leadership and management?`;
      },
    },
    {
      theme: "Security & Perks",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} are known for providing comprehensive benefits and job security?`;
      },
    },
    {
      theme: "Career Opportunities",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} are most recognized for exceptional career development and progression opportunities?`;
      },
    },
  ],
  "Candidate Experience": [
    {
      theme: "Application Process",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} have the best application process?`;
      },
    },
    {
      theme: "Candidate Communication",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} are recognized for strong candidate communication?`;
      },
    },
    {
      theme: "Interview Experience",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} have the best interview experience?`;
      },
    },
    {
      theme: "Candidate Feedback",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} are known for providing valuable candidate feedback?`;
      },
    },
    {
      theme: "Onboarding Experience",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} have the best onboarding experience?`;
      },
    },
    {
      theme: "Overall Candidate Experience",
      text: (industry: string, country?: string) => {
        const location =
          country && country !== "GLOBAL" ? ` in ${country}` : "";
        return `What companies in ${industry}${location} have the best overall candidate reputation?`;
      },
    },
  ],
};

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
    } = body;

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

    // Map country codes to their full English names.
    // This is required because the AI models generate better responses with full country names,
    // and we want to store readable location contexts in the database.
    const COUNTRY_CODE_TO_NAME: Record<string, string> = {
      US: "United States",
      GB: "United Kingdom",
      CA: "Canada",
      AU: "Australia",
      DE: "Germany",
      FR: "France",
      IT: "Italy",
      ES: "Spain",
      NL: "Netherlands",
      SE: "Sweden",
      NO: "Norway",
      DK: "Denmark",
      FI: "Finland",
      CH: "Switzerland",
      AT: "Austria",
      BE: "Belgium",
      IE: "Ireland",
      NZ: "New Zealand",
      SG: "Singapore",
      JP: "Japan",
      KR: "South Korea",
      CN: "China",
      IN: "India",
      BR: "Brazil",
      MX: "Mexico",
      AR: "Argentina",
      ZA: "South Africa",
      AE: "United Arab Emirates",
      SA: "Saudi Arabia",
      GLOBAL: "Global (All Countries)",
    };

    // If we have a country name provided, use it. Otherwise, look up the code in our map.
    // Fallback to the code itself if it's not in our list (though it should be).
    const resolvedCountryName =
      countryName || COUNTRY_CODE_TO_NAME[country] || country;

    // Set the location context for the database.
    // If 'GLOBAL' is selected, we store null to indicate no specific country constraint.
    const dbLocationContext = country === "GLOBAL" ? null : resolvedCountryName;

    // This name will be inserted into the natural language prompts.
    const promptLocationName = resolvedCountryName;

    // Visibility prompt templates for Employee Experience and Candidate Experience
    const VISIBILITY_PROMPTS = {
      "Employee Experience": [
        {
          theme: "Mission & Purpose",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} are known for having a strong, purpose-driven employer brand?`;
          },
        },
        {
          theme: "Rewards & Recognition",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} are known for having exceptional rewards and recognition for employees?`;
          },
        },
        {
          theme: "Company Culture",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} are known for outstanding workplace culture?`;
          },
        },
        {
          theme: "Social Impact",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} are recognized for meaningful social impact and community engagement?`;
          },
        },
        {
          theme: "Inclusion",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} are most recognized for diversity, equity, and inclusion?`;
          },
        },
        {
          theme: "Innovation",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} are known for fostering innovation and creative thinking?`;
          },
        },
        {
          theme: "Wellbeing & Balance",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} are recognized for exceptional employee wellbeing and work-life balance?`;
          },
        },
        {
          theme: "Leadership",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} are respected for outstanding leadership and management?`;
          },
        },
        {
          theme: "Security & Perks",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} are known for providing comprehensive benefits and job security?`;
          },
        },
        {
          theme: "Career Opportunities",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} are most recognized for exceptional career development and progression opportunities?`;
          },
        },
      ],
      "Candidate Experience": [
        {
          theme: "Application Process",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} have the best application process?`;
          },
        },
        {
          theme: "Candidate Communication",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} are recognized for strong candidate communication?`;
          },
        },
        {
          theme: "Interview Experience",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} have the best interview experience?`;
          },
        },
        {
          theme: "Candidate Feedback",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} are known for providing valuable candidate feedback?`;
          },
        },
        {
          theme: "Onboarding Experience",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} have the best onboarding experience?`;
          },
        },
        {
          theme: "Overall Candidate Experience",
          text: (industry: string, country?: string) => {
            const location =
              country && country !== "GLOBAL"
                ? ` in ${promptLocationName}`
                : "";
            return `What companies in ${industry}${location} have the best overall candidate reputation?`;
          },
        },
      ],
    };

    const promptLocation =
      country === "GLOBAL" ? undefined : resolvedCountryName;

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

    // Create industry-wide prompts (NOT tied to specific companies)
    // These prompts ask the AI which companies are visible in the industry/market
    const allPrompts: Array<{ category: string; theme: string; text: string }> =
      [];

    // Add Employee Experience prompts
    console.log(
      `Adding Employee Experience prompts. Total in array: ${VISIBILITY_PROMPTS["Employee Experience"].length}`,
    );
    for (const prompt of VISIBILITY_PROMPTS["Employee Experience"]) {
      allPrompts.push({
        category: "Employee Experience",
        theme: prompt.theme,
        text: prompt.text(industry, promptLocation),
      });
      console.log(`  - Added: ${prompt.theme}`);
    }
    console.log(
      `Employee Experience prompts added. allPrompts.length = ${allPrompts.length}`,
    );

    // Add Candidate Experience prompts
    console.log(
      `Adding Candidate Experience prompts. Total in array: ${VISIBILITY_PROMPTS["Candidate Experience"].length}`,
    );
    for (const prompt of VISIBILITY_PROMPTS["Candidate Experience"]) {
      allPrompts.push({
        category: "Candidate Experience",
        theme: prompt.theme,
        text: prompt.text(industry, promptLocation),
      });
      console.log(`  - Added: ${prompt.theme}`);
    }
    console.log(
      `Prompt list:`,
      allPrompts.map((p) => `${p.theme} (${p.category})`).join(", "),
    );

    // PHASE 1: Create/Fetch prompts
    // We only need to run the creation logic ONCE.
    // If this is a subsequent batch (batchOffset > 0), we can skip the heavy creation logic
    // and just fetch the IDs we need for this specific batch.
    
    console.log(`PHASE 1: Resolving prompts (batchOffset: ${batchOffset})`);

    const promptsWithIds: Array<{
      promptData: { category: string; theme: string; text: string };
      promptId: string;
    }> = [];

    // If we are processing a specific batch (offset > 0), we only need to resolve the prompts FOR THAT BATCH.
    // However, to keep logic simple and consistent, we'll just resolve ALL prompts if batchOffset == 0 (First Run),
    // and for subsequent runs, we'll try to just FETCH them efficiently without "creation" attempts if possible.
    
    // Actually, the safest and most robust way is:
    // 1. If batchOffset == 0: Run the full "Create if not exists" logic.
    // 2. If batchOffset > 0: Run a "Fetch only" logic. If missing, THEN create.
    
    // To ensure we don't break anything, let's keep the logic but optimize it:
    // Only attempt to CREATE if we can't find it. This is what the code already does.
    // But we can skip the loop entirely if we just want to fetch.
    
    for (let i = 0; i < allPrompts.length; i++) {
      // Optimization: If we are using batching, and this prompt is NOT in our batch,
      // we don't technically need to resolve its ID right now.
      // BUT the original logic returned "results.promptsCreated" for the whole set.
      // Let's stick to the core requirement: PREVENT DUPLICATES.
      
      const promptData = allPrompts[i];
      let promptId: string | null = null;

      try {
        // Step 1: ALWAYS check if prompt exists first.
        // This is the read-only path that should happen 99% of the time.
        // IMPORTANT: We need to handle company_id correctly.
        // If we are running for a specific company context (adminUser.company_id),
        // we should check for prompts that match that ID (if they are company specific)
        // OR check for global prompts (company_id is null) if that's the intention.
        // However, based on the DB state, it seems we are creating prompts WITH company_id.
        // So we must include it in our search to find the matches.
        
        let query = supabase
          .from("confirmed_prompts")
          .select("id")
          .eq("prompt_text", promptData.text)
          .eq("prompt_type", "discovery");

        // Use the company_id we are about to insert with (which is null in code, but seems to be populated in DB?)
        // Wait, line 619 says `company_id: null`.
        // BUT the user found `company_id: a1c9...` in the DB.
        // This means `adminUser.company_id` might be getting used somewhere or I am misreading line 619.
        // Line 619 explicitly says `company_id: null`.
        
        // Let's look at how `adminUser` is fetched. 
        // If the DB has `company_id` set, it means previous runs inserted it that way.
        // If we want to support both (generic and company-specific), we should be careful.
        // But for "Industry Visibility", it SHOULD be null.
        
        // If the unique index includes company_id, then (text, type, ind, loc, NULL) is different from (text, type, ind, loc, UUID).
        // The user's DB showed company_id was NOT null.
        // This implies that `collect-industry-visibility` might have been modified before or I am looking at the wrong version?
        // OR, the `insert` below is using `company_id: null` but maybe there is a trigger?
        // OR, maybe the user was looking at prompts created by a DIFFERENT function?
        
        // Regardless, to be robust, we should check for BOTH cases or just match the text.
        // Since we decided "Text is King", let's relax the company_id check for finding existing prompts.
        // If we find a prompt with the same text, we should use it, regardless of company_id.
        
        // query = query.is("company_id", null); // REMOVED strict check
        
        const { data: existingPrompts, error: searchError } = await query.limit(1);

        if (searchError) {
          console.error(
            `[${i + 1}/${allPrompts.length}] Error searching for existing prompt:`,
            searchError.message
          );
        }

        if (existingPrompts && existingPrompts.length > 0) {
          promptId = existingPrompts[0].id;
          // Only log on the first batch to reduce noise
          if (batchOffset === 0) {
             console.log(
              `[${i + 1}/${allPrompts.length}] Found existing prompt ${promptId} by TEXT match.`
            );
          }
          
          // Only update timestamp on the first batch to avoid 16 writes for the same row
          if (batchOffset === 0) {
             const { error: updateError } = await supabase
              .from("confirmed_prompts")
              .update({ 
                updated_at: new Date().toISOString(),
                industry_context: industry,
                location_context: dbLocationContext,
                prompt_category: promptData.category,
                prompt_theme: promptData.theme
                // We do NOT update company_id here to preserve whatever it was
              })
              .eq("id", promptId);
              
             if (updateError) {
               console.error(`Error updating timestamp for prompt ${promptId}:`, updateError.message);
             }
          }
        } else {
          // Step 2: Create ONLY if not found AND we are in the first batch (or forced).
          // If we are in batch > 0, we expect prompts to exist from batch 0. 
          // But if they are missing, we MUST create them to proceed.
          
          const { data: newPrompt, error: insertError } = await supabase
            .from("confirmed_prompts")
            .insert({
              user_id: adminUser.id,
              company_id: null, // We explicitly set this to NULL for industry visibility
              onboarding_id: null,
              prompt_text: promptData.text,
              prompt_type: "discovery",
              prompt_category: promptData.category,
              prompt_theme: promptData.theme,
              industry_context: industry,
              location_context: dbLocationContext,
            })
            .select("id")
            .single();

          if (insertError) {
            // Handle unique violation gracefully (Race condition catcher)
            if (insertError.code === "23505" || insertError.message?.includes("duplicate")) {
               console.log(`[${i + 1}/${allPrompts.length}] Race condition caught: Prompt created by another process. Fetching ID...`);
               // Retry fetch - RELAXED (No company_id check, just text)
               const { data: retryFetch } = await supabase
                  .from("confirmed_prompts")
                  .select("id")
                  .eq("prompt_text", promptData.text)
                  .eq("prompt_type", "discovery")
                  // .is("company_id", null) // REMOVED to find any matching prompt
                  .limit(1);
                  
               if (retryFetch && retryFetch.length > 0) {
                 promptId = retryFetch[0].id;
               }
            } else {
                console.error(
                  `[${i + 1}/${allPrompts.length}] Failed to create prompt:`,
                  insertError.message
                );
                results.errors.push(
                  `Failed to create prompt for ${promptData.theme}: ${insertError.message}`
                );
            }
          } else if (newPrompt && newPrompt.id) {
            promptId = newPrompt.id;
            results.promptsCreated++;
            console.log(
              `[${i + 1}/${allPrompts.length}] ✓ Created prompt ${promptId} for ${promptData.theme}`
            );
          }
        }
      } catch (error: any) {
        console.error(
          `[${i + 1}/${allPrompts.length}] CRITICAL ERROR processing prompt ${promptData.theme}:`,
          error.message
        );
        results.errors.push(
          `Critical error processing prompt ${promptData.theme}: ${error.message}`
        );
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
            .eq("ai_model", "gpt-5.2-chat-latest")
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
          data: existingResponseGoogle,
          error: responseCheckErrorGoogle,
        } = await supabase
          .from("prompt_responses")
          .select("id, ai_model, tested_at")
          .eq("confirmed_prompt_id", promptId)
          .eq("ai_model", "google-ai-overviews")
          .maybeSingle();

        // Collect responses for each model that doesn't exist yet
        const modelsToCollect = [
          {
            name: "gpt-5.2-chat-latest",
            exists: !!existingResponseGPT,
            type: "openai",
          },
          {
            name: "perplexity",
            exists: !!existingResponsePerplexity,
            type: "perplexity",
          },
          {
            name: "google-ai-overviews",
            exists: !!existingResponseGoogle,
            type: "google",
          },
        ].filter((m) => !m.exists);

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
                    // max_tokens: 1000, // Not supported by gpt-5.2-chat-latest (o1/o3 style models)
                    max_completion_tokens: 1000,
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
            } else if (model.type === "google") {
              // Google AI Overviews edge function
              const googleResponse = await fetch(
                `${supabaseUrl}/functions/v1/test-prompt-google-ai-overviews`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ prompt: promptData.text }),
                },
              );

              if (!googleResponse.ok) {
                const errorData = await googleResponse.json();
                throw new Error(
                  `Google AI error: ${errorData.error || "Unknown error"}`,
                );
              }

              const googleData = await googleResponse.json();
              responseText = googleData.response || "";
              citations = googleData.citations || [];
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
                      ? citations
                      : model.type === "perplexity"
                        ? citations
                        : model.type === "google"
                          ? citations
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
