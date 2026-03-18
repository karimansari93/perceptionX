import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveCountryName } from "../_shared/countries.ts";

// ---------------------------------------------------------------------------
// Prompt generation — server-side port of src/hooks/usePromptsLogic.ts
// ---------------------------------------------------------------------------

interface GeneratedPrompt {
  id: string;
  text: string;
  type: "informational" | "experience" | "competitive" | "discovery";
  industryContext: string;
  jobFunctionContext?: string;
  locationContext?: string;
  promptCategory: "General" | "Employee Experience" | "Candidate Experience";
  promptTheme: string;
  talentxAttributeId?: string;
}

// Matches TALENTX_PROMPT_TEMPLATES from src/config/talentXAttributes.ts
const TALENTX_PROMPT_TEMPLATES: {
  attributeId: string;
  type: string;
  prompt: string;
  category: "Employee Experience" | "Candidate Experience";
  theme: string;
}[] = [
  // Mission & Purpose
  { attributeId: "mission-purpose", type: "informational", prompt: "What does {companyName} communicate about its mission and purpose?", category: "Employee Experience", theme: "Mission & Purpose" },
  { attributeId: "mission-purpose", type: "experience", prompt: "How well does {companyName} communicate its mission and purpose to employees, and how does this resonate with their personal values?", category: "Employee Experience", theme: "Mission & Purpose" },
  { attributeId: "mission-purpose", type: "competitive", prompt: "How do {companyName}'s mission and purpose compare to other companies in {industry}?", category: "Employee Experience", theme: "Mission & Purpose" },
  { attributeId: "mission-purpose", type: "discovery", prompt: "What companies in {industry} are known for having a strong, purpose-driven employer brand?", category: "Employee Experience", theme: "Mission & Purpose" },
  // Rewards & Recognition
  { attributeId: "rewards-recognition", type: "informational", prompt: "What are the compensation, benefits, and recognition details at {companyName}?", category: "Employee Experience", theme: "Rewards & Recognition" },
  { attributeId: "rewards-recognition", type: "experience", prompt: "How satisfied are employees at {companyName} with the rewards and recognition programs, and what specific aspects drive positive or negative sentiment?", category: "Employee Experience", theme: "Rewards & Recognition" },
  { attributeId: "rewards-recognition", type: "competitive", prompt: "How do rewards and recognition programs at {companyName} compare to other companies in {industry}?", category: "Employee Experience", theme: "Rewards & Recognition" },
  { attributeId: "rewards-recognition", type: "discovery", prompt: "What companies in {industry} are known for having exceptional rewards and recognition for employees?", category: "Employee Experience", theme: "Rewards & Recognition" },
  // Company Culture
  { attributeId: "company-culture", type: "informational", prompt: "What does {companyName} communicate about its culture and values?", category: "Employee Experience", theme: "Company Culture" },
  { attributeId: "company-culture", type: "experience", prompt: "How do employees at {companyName} describe the actual company culture versus the promoted culture?", category: "Employee Experience", theme: "Company Culture" },
  { attributeId: "company-culture", type: "competitive", prompt: "How does {companyName}'s company culture compare to other companies in {industry}?", category: "Employee Experience", theme: "Company Culture" },
  { attributeId: "company-culture", type: "discovery", prompt: "What companies in {industry} are known for outstanding workplace culture?", category: "Employee Experience", theme: "Company Culture" },
  // Social Impact
  { attributeId: "social-impact", type: "informational", prompt: "What social impact programs and commitments does {companyName} offer?", category: "Employee Experience", theme: "Social Impact" },
  { attributeId: "social-impact", type: "experience", prompt: "How do employees at {companyName} perceive the company's commitment to social impact and community responsibility?", category: "Employee Experience", theme: "Social Impact" },
  { attributeId: "social-impact", type: "competitive", prompt: "How does {companyName}'s social impact compare to other companies in {industry}?", category: "Employee Experience", theme: "Social Impact" },
  { attributeId: "social-impact", type: "discovery", prompt: "What companies in {industry} are recognized for meaningful social impact and community engagement?", category: "Employee Experience", theme: "Social Impact" },
  // Inclusion
  { attributeId: "inclusion", type: "informational", prompt: "What diversity, equity, and inclusion programs does {companyName} offer?", category: "Employee Experience", theme: "Inclusion" },
  { attributeId: "inclusion", type: "experience", prompt: "How do employees from diverse backgrounds at {companyName} rate the inclusivity of the workplace culture and practices?", category: "Employee Experience", theme: "Inclusion" },
  { attributeId: "inclusion", type: "competitive", prompt: "How do {companyName}'s inclusion and diversity efforts compare to other companies in {industry}?", category: "Employee Experience", theme: "Inclusion" },
  { attributeId: "inclusion", type: "discovery", prompt: "What companies in {industry} are most recognized for diversity, equity, and inclusion?", category: "Employee Experience", theme: "Inclusion" },
  // Innovation
  { attributeId: "innovation", type: "informational", prompt: "What does {companyName} offer in terms of innovation and technology?", category: "Employee Experience", theme: "Innovation" },
  { attributeId: "innovation", type: "experience", prompt: "How do employees at {companyName} perceive the company's commitment to innovation and opportunities for creative work?", category: "Employee Experience", theme: "Innovation" },
  { attributeId: "innovation", type: "competitive", prompt: "How does {companyName}'s innovation culture compare to other companies in {industry}?", category: "Employee Experience", theme: "Innovation" },
  { attributeId: "innovation", type: "discovery", prompt: "What companies in {industry} are known for fostering innovation and creative thinking?", category: "Employee Experience", theme: "Innovation" },
  // Wellbeing & Balance
  { attributeId: "wellbeing-balance", type: "informational", prompt: "What are the work-life balance, flexibility, and wellbeing offerings at {companyName}?", category: "Employee Experience", theme: "Wellbeing & Balance" },
  { attributeId: "wellbeing-balance", type: "experience", prompt: "How do employees at {companyName} rate work-life balance and the overall wellbeing support provided by the company?", category: "Employee Experience", theme: "Wellbeing & Balance" },
  { attributeId: "wellbeing-balance", type: "competitive", prompt: "How do {companyName}'s wellbeing and work-life balance offerings compare to other companies in {industry}?", category: "Employee Experience", theme: "Wellbeing & Balance" },
  { attributeId: "wellbeing-balance", type: "discovery", prompt: "What companies in {industry} are recognized for exceptional employee wellbeing and work-life balance?", category: "Employee Experience", theme: "Wellbeing & Balance" },
  // Leadership
  { attributeId: "leadership", type: "informational", prompt: "What does {companyName} communicate about its leadership and structure?", category: "Employee Experience", theme: "Leadership" },
  { attributeId: "leadership", type: "experience", prompt: "How do employees at {companyName} rate the quality and effectiveness of leadership within the organization?", category: "Employee Experience", theme: "Leadership" },
  { attributeId: "leadership", type: "competitive", prompt: "How does {companyName}'s leadership quality compare to other companies in {industry}?", category: "Employee Experience", theme: "Leadership" },
  { attributeId: "leadership", type: "discovery", prompt: "What companies in {industry} are respected for outstanding leadership and management?", category: "Employee Experience", theme: "Leadership" },
  // Security & Perks
  { attributeId: "security-perks", type: "informational", prompt: "What are the job security, benefits, and perks at {companyName}?", category: "Employee Experience", theme: "Security & Perks" },
  { attributeId: "security-perks", type: "experience", prompt: "How do employees at {companyName} perceive job security, benefits, and additional perks provided by the company?", category: "Employee Experience", theme: "Security & Perks" },
  { attributeId: "security-perks", type: "competitive", prompt: "How do {companyName}'s security, benefits, and perks compare to other companies in {industry}?", category: "Employee Experience", theme: "Security & Perks" },
  { attributeId: "security-perks", type: "discovery", prompt: "What companies in {industry} are known for providing comprehensive benefits and job security?", category: "Employee Experience", theme: "Security & Perks" },
  // Career Opportunities
  { attributeId: "career-opportunities", type: "informational", prompt: "What career development and growth opportunities does {companyName} offer?", category: "Employee Experience", theme: "Career Opportunities" },
  { attributeId: "career-opportunities", type: "experience", prompt: "How do employees at {companyName} rate career development opportunities and long-term growth potential?", category: "Employee Experience", theme: "Career Opportunities" },
  { attributeId: "career-opportunities", type: "competitive", prompt: "How do career progression opportunities at {companyName} compare to other companies in {industry}?", category: "Employee Experience", theme: "Career Opportunities" },
  { attributeId: "career-opportunities", type: "discovery", prompt: "What companies in {industry} are most recognized for exceptional career development and progression opportunities?", category: "Employee Experience", theme: "Career Opportunities" },
  // Application Process
  { attributeId: "application-process", type: "informational", prompt: "What is the application process at {companyName}?", category: "Candidate Experience", theme: "Application Process" },
  { attributeId: "application-process", type: "experience", prompt: "How is the application process at {companyName}?", category: "Candidate Experience", theme: "Application Process" },
  { attributeId: "application-process", type: "competitive", prompt: "How does the application process at {companyName} compare to other employers in {industry}?", category: "Candidate Experience", theme: "Application Process" },
  { attributeId: "application-process", type: "discovery", prompt: "What companies in {industry} have the best application process?", category: "Candidate Experience", theme: "Application Process" },
  // Communication
  { attributeId: "candidate-communication", type: "informational", prompt: "What can candidates expect in terms of communication from {companyName}?", category: "Candidate Experience", theme: "Candidate Communication" },
  { attributeId: "candidate-communication", type: "experience", prompt: "How do candidates feel about receiving updates from {companyName}?", category: "Candidate Experience", theme: "Candidate Communication" },
  { attributeId: "candidate-communication", type: "competitive", prompt: "How does recruiter communication at {companyName} compare to other companies in {industry}?", category: "Candidate Experience", theme: "Candidate Communication" },
  { attributeId: "candidate-communication", type: "discovery", prompt: "What companies in {industry} are recognized for strong candidate communication?", category: "Candidate Experience", theme: "Candidate Communication" },
  // Interview
  { attributeId: "interview-experience", type: "informational", prompt: "What is the interview process at {companyName}?", category: "Candidate Experience", theme: "Interview Experience" },
  { attributeId: "interview-experience", type: "experience", prompt: "How do candidates describe their interview experience at {companyName}?", category: "Candidate Experience", theme: "Interview Experience" },
  { attributeId: "interview-experience", type: "competitive", prompt: "How does the interview process at {companyName} compare to other companies in {industry}?", category: "Candidate Experience", theme: "Interview Experience" },
  { attributeId: "interview-experience", type: "discovery", prompt: "What companies in {industry} have the best interview experience?", category: "Candidate Experience", theme: "Interview Experience" },
  // Feedback
  { attributeId: "candidate-feedback", type: "informational", prompt: "What feedback do candidates receive from {companyName}?", category: "Candidate Experience", theme: "Candidate Feedback" },
  { attributeId: "candidate-feedback", type: "experience", prompt: "How do candidates rate the feedback from {companyName} after interviews or applications?", category: "Candidate Experience", theme: "Candidate Feedback" },
  { attributeId: "candidate-feedback", type: "competitive", prompt: "How does candidate feedback at {companyName} compare to other employers in {industry}?", category: "Candidate Experience", theme: "Candidate Feedback" },
  { attributeId: "candidate-feedback", type: "discovery", prompt: "What companies in {industry} are known for providing valuable candidate feedback?", category: "Candidate Experience", theme: "Candidate Feedback" },
  // Onboarding
  { attributeId: "onboarding-experience", type: "informational", prompt: "What does onboarding look like at {companyName}?", category: "Candidate Experience", theme: "Onboarding Experience" },
  { attributeId: "onboarding-experience", type: "experience", prompt: "How do new hires feel about onboarding at {companyName}?", category: "Candidate Experience", theme: "Onboarding Experience" },
  { attributeId: "onboarding-experience", type: "competitive", prompt: "How does onboarding at {companyName} compare to other organizations in {industry}?", category: "Candidate Experience", theme: "Onboarding Experience" },
  { attributeId: "onboarding-experience", type: "discovery", prompt: "What companies in {industry} have the best onboarding experience?", category: "Candidate Experience", theme: "Onboarding Experience" },
  // Overall Candidate Experience
  { attributeId: "overall-candidate-experience", type: "informational", prompt: "What can candidates expect from the hiring experience at {companyName}?", category: "Candidate Experience", theme: "Overall Candidate Experience" },
  { attributeId: "overall-candidate-experience", type: "experience", prompt: "How do candidates perceive the overall journey at {companyName}?", category: "Candidate Experience", theme: "Overall Candidate Experience" },
  { attributeId: "overall-candidate-experience", type: "competitive", prompt: "Does {companyName} stand out for candidate experience in {industry}?", category: "Candidate Experience", theme: "Overall Candidate Experience" },
  { attributeId: "overall-candidate-experience", type: "discovery", prompt: "What companies in {industry} have the best overall candidate reputation?", category: "Candidate Experience", theme: "Overall Candidate Experience" },
];

const ENGLISH_SPEAKING_COUNTRIES = [
  "US", "GB", "CA", "AU", "NZ", "IE", "ZA", "IN", "SG", "MY", "PH", "HK", "AE", "SA",
];

/**
 * Append job function and/or location context to a prompt string.
 * Simplified server-side version of the frontend appendPromptContext().
 */
function appendPromptContext(
  text: string,
  jobFunction?: string,
  location?: string,
): string {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const parts: string[] = [];

  if (jobFunction && !lower.includes(jobFunction.toLowerCase())) {
    parts.push(`for ${jobFunction}`);
  }
  if (location && !lower.includes(location.toLowerCase())) {
    parts.push(`in ${location}`);
  }
  if (parts.length === 0) return text;

  const suffix = ` ${parts.join(" ")}`;
  if (trimmed.endsWith("?")) return trimmed.replace(/\?$/, `${suffix}?`);
  if (trimmed.endsWith(".")) return trimmed.replace(/\.$/, `${suffix}.`);
  return `${trimmed}${suffix}`;
}

/**
 * Generate the full set of prompts for a company × location × industry × jobFunction.
 * Always generates Pro-level prompts (admin context).
 */
function generatePrompts(
  companyName: string,
  industry: string,
  location?: string,
  jobFunction?: string,
): GeneratedPrompt[] {
  const locationDisplay = location && location !== "GLOBAL" ? resolveCountryName(location) : undefined;

  // 4 base prompts (General category)
  const basePrompts: GeneratedPrompt[] = [
    { id: "experience-1", text: `How is ${companyName} as an employer?`, type: "experience", promptCategory: "General", promptTheme: "General" },
    { id: "discovery-1", text: `What is the best company to work for in the ${industry} industry?`, type: "discovery", promptCategory: "General", promptTheme: "General" },
    { id: "competitive-1", text: `How does working at ${companyName} compare to other companies?`, type: "competitive", promptCategory: "General", promptTheme: "General" },
    { id: "informational-1", text: `What are the job and employment details at ${companyName}?`, type: "informational", promptCategory: "General", promptTheme: "General" },
  ].map((p) => ({
    ...p,
    text: appendPromptContext(p.text, jobFunction, locationDisplay),
    industryContext: industry,
    jobFunctionContext: jobFunction,
    locationContext: locationDisplay,
  }));

  // 64 TalentX prompts (always Pro in admin context)
  const talentxPrompts: GeneratedPrompt[] = TALENTX_PROMPT_TEMPLATES.map((t) => {
    const raw = t.prompt
      .replace(/{companyName}/g, companyName)
      .replace(/{industry}/g, industry);

    return {
      id: `talentx-${t.attributeId}-${t.type}`,
      text: appendPromptContext(raw, jobFunction, locationDisplay),
      type: t.type as GeneratedPrompt["type"],
      industryContext: industry,
      jobFunctionContext: jobFunction,
      locationContext: locationDisplay,
      promptCategory: t.category,
      promptTheme: t.theme,
      talentxAttributeId: t.attributeId,
    };
  });

  return [...basePrompts, ...talentxPrompts];
}

// ---------------------------------------------------------------------------
// Queue processor
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Optional: allow forcing a specific config (for "Start Collection" button)
    const { configId } = await req.json().catch(() => ({}));

    // If configId supplied, ensure org is created for new_org mode before processing
    if (configId) {
      const { data: config } = await supabase
        .from("company_batch_configs")
        .select("*")
        .eq("id", configId)
        .single();

      if (config && config.org_mode === "new_org" && !config.created_org_id) {
        console.log(`[BatchQueue] Creating new org "${config.new_org_name}" for config ${configId}`);
        const { data: newOrg, error: orgError } = await supabase
          .from("organizations")
          .insert({ name: config.new_org_name, created_by: config.user_id })
          .select("id")
          .single();

        if (orgError || !newOrg) {
          console.error("[BatchQueue] Failed to create org:", orgError);
          return new Response(
            JSON.stringify({ error: `Failed to create organization: ${orgError?.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Also add admin as org owner
        await supabase.from("organization_members").insert({
          user_id: config.user_id,
          organization_id: newOrg.id,
          role: "owner",
        });

        await supabase
          .from("company_batch_configs")
          .update({ created_org_id: newOrg.id })
          .eq("id", configId);

        console.log(`[BatchQueue] Created org ${newOrg.id}`);
      }
    }

    // -----------------------------------------------------------------------
    // Pick one pending/processing job (oldest first), skip cancelled
    // -----------------------------------------------------------------------
    const { data: jobs, error: jobError } = await supabase
      .from("company_batch_queue")
      .select("*, company_batch_configs!inner(user_id, organization_id, created_org_id, org_mode)")
      .in("status", ["pending", "processing"])
      .or("is_cancelled.is.null,is_cancelled.eq.false")
      .order("created_at", { ascending: true })
      .limit(1);

    if (jobError) throw jobError;

    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: "No pending jobs" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const job = jobs[0];
    const config = job.company_batch_configs;
    const now = new Date().toISOString();

    console.log(`[BatchQueue] Processing job ${job.id}: ${job.company_name} / ${job.location} / ${job.industry} / ${job.job_function || "(all)"} — phase: ${job.phase}`);

    // Mark pending → processing
    if (job.status === "pending") {
      await supabase
        .from("company_batch_queue")
        .update({ status: "processing", updated_at: now })
        .eq("id", job.id);
    }

    let result = { processed: 0, message: "Idle" };

    try {
      // =======================================================================
      // PHASE: setup
      // =======================================================================
      if (job.phase === "setup") {
        console.log(`[BatchQueue] Phase: setup`);

        // 1. Insert user_onboarding row
        const { data: onboarding, error: onbError } = await supabase
          .from("user_onboarding")
          .insert({
            user_id: config.user_id,
            company_name: job.company_name,
            industry: job.industry,
            country: job.location,
            job_function: job.job_function || null,
            session_id: crypto.randomUUID(),
          })
          .select("id")
          .single();

        if (onbError) throw new Error(`Onboarding insert failed: ${onbError.message}`);

        // 2. Wait for DB trigger to create companies row (poll up to 10× with backoff)
        let companyId: string | null = null;
        for (let attempt = 0; attempt < 10; attempt++) {
          const delay = Math.min(500 * Math.pow(2, attempt), 10000);
          await new Promise((r) => setTimeout(r, delay));

          const { data: onbRow } = await supabase
            .from("user_onboarding")
            .select("company_id")
            .eq("id", onboarding.id)
            .single();

          if (onbRow?.company_id) {
            companyId = onbRow.company_id;
            break;
          }
          console.log(`[BatchQueue] Waiting for company... attempt ${attempt + 1}`);
        }

        if (!companyId) {
          throw new Error("Company was not created by DB trigger after 10 attempts");
        }

        // 3. Generate prompts
        const prompts = generatePrompts(
          job.company_name,
          job.industry,
          job.location,
          job.job_function || undefined,
        );

        // 4. Translate if non-English location
        // Check if location is a known country code that needs translation
        const needsTranslation =
          job.location !== "GLOBAL" &&
          !ENGLISH_SPEAKING_COUNTRIES.includes(job.location);

        let finalPrompts = prompts;
        if (needsTranslation) {
          console.log(`[BatchQueue] Translating ${prompts.length} prompts for ${job.location}...`);
          const { data: translationData, error: translationError } =
            await supabase.functions.invoke("translate-prompts", {
              body: { prompts: prompts.map((p) => p.text), countryCode: job.location },
            });

          if (translationError) {
            throw new Error(`Translation failed: ${translationError.message}`);
          }

          if (translationData?.translatedPrompts?.length === prompts.length) {
            finalPrompts = prompts.map((p, i) => ({
              ...p,
              text: translationData.translatedPrompts[i] || p.text,
            }));
          } else {
            throw new Error("Translation returned incomplete results");
          }
        }

        // 5. Insert confirmed_prompts
        const promptRows = finalPrompts.map((p) => ({
          onboarding_id: onboarding.id,
          user_id: config.user_id,
          company_id: companyId,
          prompt_text: p.text,
          prompt_category: p.promptCategory,
          prompt_theme: p.promptTheme,
          prompt_type: p.talentxAttributeId ? `talentx_${p.type}` : p.type,
          talentx_attribute_id: p.talentxAttributeId || null,
          industry_context: p.industryContext,
          job_function_context: p.jobFunctionContext || null,
          location_context: p.locationContext || null,
          is_active: true,
        }));

        const { error: insertError } = await supabase
          .from("confirmed_prompts")
          .insert(promptRows);

        if (insertError) throw new Error(`Prompt insert failed: ${insertError.message}`);

        // 6. Link company to organization
        const orgId = config.org_mode === "new_org" ? config.created_org_id : config.organization_id;
        if (orgId) {
          await supabase
            .from("organization_companies")
            .insert({ organization_id: orgId, company_id: companyId, added_by: config.user_id })
            .select()
            .maybeSingle(); // ignore duplicate

          await supabase
            .from("company_members")
            .insert({ user_id: config.user_id, company_id: companyId, role: "owner" })
            .select()
            .maybeSingle();
        }

        // 7. Advance phase
        await supabase
          .from("company_batch_queue")
          .update({
            phase: "search_insights",
            company_id: companyId,
            onboarding_id: onboarding.id,
            total_prompts: finalPrompts.length,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        result = { processed: 1, message: `Setup complete: ${finalPrompts.length} prompts, company ${companyId}` };
      }

      // =======================================================================
      // PHASE: search_insights
      // =======================================================================
      else if (job.phase === "search_insights") {
        console.log(`[BatchQueue] Phase: search_insights`);

        try {
          const { error: searchError } = await supabase.functions.invoke("search-insights", {
            body: {
              companyName: job.company_name,
              company_id: job.company_id,
              onboarding_id: job.onboarding_id,
            },
          });

          if (searchError) {
            // search-insights timeout is non-fatal per spec §8
            console.warn(`[BatchQueue] search-insights error (non-fatal): ${searchError.message}`);
          }
        } catch (err: any) {
          console.warn(`[BatchQueue] search-insights exception (non-fatal): ${err.message}`);
        }

        // Advance to llm_collection regardless of search-insights outcome
        await supabase
          .from("company_batch_queue")
          .update({ phase: "llm_collection", updated_at: new Date().toISOString() })
          .eq("id", job.id);

        result = { processed: 1, message: "Search insights done, advancing to LLM collection" };
      }

      // =======================================================================
      // PHASE: llm_collection
      // =======================================================================
      else if (job.phase === "llm_collection") {
        console.log(`[BatchQueue] Phase: llm_collection (batch_index=${job.batch_index})`);

        // Fetch prompt IDs for this company
        const { data: promptRows } = await supabase
          .from("confirmed_prompts")
          .select("id")
          .eq("company_id", job.company_id)
          .eq("is_active", true);

        const promptIds = promptRows?.map((r: any) => r.id) || [];

        if (promptIds.length === 0) {
          console.warn("[BatchQueue] No prompts found for company, marking done");
          await supabase
            .from("company_batch_queue")
            .update({ phase: "done", status: "completed", updated_at: new Date().toISOString() })
            .eq("id", job.id);
          result = { processed: 0, message: "No prompts, marked complete" };
        } else {
          // Call collect-company-responses with claude added as 4th model
          const { data: collectData, error: collectError } = await supabase.functions.invoke(
            "collect-company-responses",
            {
              body: {
                companyId: job.company_id,
                promptIds,
                models: ["openai", "perplexity", "google-ai-overviews", "google-ai-mode"],
                batchSize: 2,
                skipExisting: true,
              },
            },
          );

          if (collectError) throw new Error(`LLM collection failed: ${collectError.message}`);
          if (!collectData?.success) throw new Error(collectData?.error || "LLM collection failed");

          // Mark completed
          await supabase
            .from("company_batch_queue")
            .update({
              phase: "done",
              status: "completed",
              batch_index: promptIds.length,
              updated_at: new Date().toISOString(),
              error_log: null,
            })
            .eq("id", job.id);

          result = {
            processed: 1,
            message: `LLM collection complete: ${collectData.summary?.responsesCollected || 0} responses`,
          };
        }
      }

      // =======================================================================
      // PHASE: done (shouldn't normally reach here, but handle gracefully)
      // =======================================================================
      else if (job.phase === "done") {
        await supabase
          .from("company_batch_queue")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", job.id);
        result = { processed: 0, message: "Already done" };
      }

      // =======================================================================
      // Self-chain: check for more pending work
      // =======================================================================
      const { count } = await supabase
        .from("company_batch_queue")
        .select("*", { count: "exact", head: true })
        .in("status", ["pending", "processing"])
        .or("is_cancelled.is.null,is_cancelled.eq.false");

      if (count && count > 0) {
        console.log(`[BatchQueue] ${count} jobs remaining, self-chaining...`);
        fetch(`${supabaseUrl}/functions/v1/process-company-batch-queue`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
        }).catch((e) => console.error("[BatchQueue] Failed to chain:", e));
      }
    } catch (err: any) {
      console.error(`[BatchQueue] Error processing job ${job.id}:`, err);

      const retryCount = (job.retry_count || 0) + 1;
      const newStatus = retryCount >= 3 ? "failed" : "pending";

      await supabase
        .from("company_batch_queue")
        .update({
          status: newStatus,
          retry_count: retryCount,
          error_log: err.message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      // If not failed, chain to retry
      if (newStatus === "pending") {
        fetch(`${supabaseUrl}/functions/v1/process-company-batch-queue`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
        }).catch((e) => console.error("[BatchQueue] Failed to chain after error:", e));
      }

      result = { processed: 0, message: `Error (retry ${retryCount}/3): ${err.message}` };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[BatchQueue] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
