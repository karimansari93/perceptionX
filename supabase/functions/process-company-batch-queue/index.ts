import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveCountryName, COUNTRY_NAME_TO_CODE } from "../_shared/countries.ts";

/**
 * Map a free-text location (e.g. "Germany", "the United Kingdom", "MX") to an
 * ISO country code understood by translate-prompts. Returns null if the input
 * doesn't correspond to a country we know about — caller should treat that as
 * "no translation needed" (pass-through English).
 */
function locationToCountryCode(location: string | null | undefined): string | null {
  if (!location) return null;
  const trimmed = location.trim();
  if (!trimmed) return null;

  // Already an ISO code?
  const upper = trimmed.toUpperCase();
  if (upper === "GLOBAL") return "GLOBAL";
  if (COUNTRY_NAME_TO_CODE[trimmed]) return COUNTRY_NAME_TO_CODE[trimmed];

  // Strip leading "the " (e.g. "the United Kingdom" → "United Kingdom").
  const withoutThe = trimmed.replace(/^the\s+/i, "");
  if (COUNTRY_NAME_TO_CODE[withoutThe]) return COUNTRY_NAME_TO_CODE[withoutThe];

  // 2-letter strings we don't recognize are almost certainly intended as codes;
  // pass them through so translate-prompts can try.
  if (/^[A-Z]{2}$/.test(upper)) return upper;

  return null;
}

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
  attributeId?: string;
}

// Matches ATTRIBUTE_PROMPT_TEMPLATES from src/config/attributes.ts
const ATTRIBUTE_PROMPT_TEMPLATES: {
  attributeId: string;
  type: string;
  prompt: string;
  category: "Employee Experience" | "Candidate Experience";
  theme: string;
}[] = [
  // Mission, Purpose & Impact
  { attributeId: "mission-purpose-impact", type: "informational", prompt: "What should I know about {companyName}'s mission, purpose, and social impact before applying?", category: "Employee Experience", theme: "Mission, Purpose & Impact" },
  { attributeId: "mission-purpose-impact", type: "experience", prompt: "What do employees say about the sense of purpose and impact of working at {companyName}?", category: "Employee Experience", theme: "Mission, Purpose & Impact" },
  { attributeId: "mission-purpose-impact", type: "competitive", prompt: "How does {companyName}'s mission and impact compare to other companies in {industry}?", category: "Employee Experience", theme: "Mission, Purpose & Impact" },
  { attributeId: "mission-purpose-impact", type: "discovery", prompt: "Which companies in {industry} are known for a strong sense of purpose and positive impact?", category: "Employee Experience", theme: "Mission, Purpose & Impact" },
  // Compensation (tactical informational)
  { attributeId: "compensation", type: "informational", prompt: "How good is the pay at {companyName}, and how should I negotiate salary and benefits there?", category: "Employee Experience", theme: "Compensation" },
  { attributeId: "compensation", type: "experience", prompt: "What do employees say about pay, benefits, and perks at {companyName}?", category: "Employee Experience", theme: "Compensation" },
  { attributeId: "compensation", type: "competitive", prompt: "Does {companyName} pay better than other companies in {industry}?", category: "Employee Experience", theme: "Compensation" },
  { attributeId: "compensation", type: "discovery", prompt: "Which companies in {industry} pay the best and offer the best benefits and perks?", category: "Employee Experience", theme: "Compensation" },
  // Company Culture
  { attributeId: "company-culture", type: "informational", prompt: "What is the company culture really like at {companyName}?", category: "Employee Experience", theme: "Company Culture" },
  { attributeId: "company-culture", type: "experience", prompt: "How do employees describe the culture at {companyName} — and do they feel valued and recognized?", category: "Employee Experience", theme: "Company Culture" },
  { attributeId: "company-culture", type: "competitive", prompt: "How does the culture at {companyName} compare to other companies in {industry}?", category: "Employee Experience", theme: "Company Culture" },
  { attributeId: "company-culture", type: "discovery", prompt: "Which companies in {industry} have the best workplace culture?", category: "Employee Experience", theme: "Company Culture" },
  // Leadership
  { attributeId: "leadership", type: "informational", prompt: "What should I know about the leadership and management at {companyName} before joining?", category: "Employee Experience", theme: "Leadership" },
  { attributeId: "leadership", type: "experience", prompt: "What do employees say about managers and senior leadership at {companyName}?", category: "Employee Experience", theme: "Leadership" },
  { attributeId: "leadership", type: "competitive", prompt: "How does the quality of leadership at {companyName} compare to other companies in {industry}?", category: "Employee Experience", theme: "Leadership" },
  { attributeId: "leadership", type: "discovery", prompt: "Which companies in {industry} are known for great leadership and management?", category: "Employee Experience", theme: "Leadership" },
  // Job Security (neutral informational)
  { attributeId: "job-security", type: "informational", prompt: "How stable and secure is a job at {companyName}?", category: "Employee Experience", theme: "Job Security" },
  { attributeId: "job-security", type: "experience", prompt: "How do employees feel about job security and stability at {companyName}?", category: "Employee Experience", theme: "Job Security" },
  { attributeId: "job-security", type: "competitive", prompt: "Is a job at {companyName} more secure than at other companies in {industry}?", category: "Employee Experience", theme: "Job Security" },
  { attributeId: "job-security", type: "discovery", prompt: "Which companies in {industry} offer the most stable and secure jobs?", category: "Employee Experience", theme: "Job Security" },
  // Career Opportunities
  { attributeId: "career-opportunities", type: "informational", prompt: "What career growth and progression can I expect at {companyName}?", category: "Employee Experience", theme: "Career Opportunities" },
  { attributeId: "career-opportunities", type: "experience", prompt: "What do employees say about career development, learning, and promotions at {companyName}?", category: "Employee Experience", theme: "Career Opportunities" },
  { attributeId: "career-opportunities", type: "competitive", prompt: "Will my career grow faster at {companyName} or at other companies in {industry}?", category: "Employee Experience", theme: "Career Opportunities" },
  { attributeId: "career-opportunities", type: "discovery", prompt: "Which companies in {industry} are best for career growth and learning?", category: "Employee Experience", theme: "Career Opportunities" },
  // Wellbeing & Balance
  { attributeId: "wellbeing-balance", type: "informational", prompt: "What are the work-life balance, flexibility, and remote work options really like at {companyName}?", category: "Employee Experience", theme: "Wellbeing & Balance" },
  { attributeId: "wellbeing-balance", type: "experience", prompt: "How do employees rate work-life balance, flexibility, and wellbeing support at {companyName}?", category: "Employee Experience", theme: "Wellbeing & Balance" },
  { attributeId: "wellbeing-balance", type: "competitive", prompt: "Is work-life balance at {companyName} better than at other companies in {industry}?", category: "Employee Experience", theme: "Wellbeing & Balance" },
  { attributeId: "wellbeing-balance", type: "discovery", prompt: "Which companies in {industry} are best for work-life balance and flexible or remote work?", category: "Employee Experience", theme: "Wellbeing & Balance" },
  // Inclusion
  { attributeId: "inclusion", type: "informational", prompt: "How inclusive and diverse is the workplace at {companyName}?", category: "Employee Experience", theme: "Inclusion" },
  { attributeId: "inclusion", type: "experience", prompt: "What do employees from diverse backgrounds say about working at {companyName}?", category: "Employee Experience", theme: "Inclusion" },
  { attributeId: "inclusion", type: "competitive", prompt: "How does {companyName} compare to other companies in {industry} on diversity and inclusion?", category: "Employee Experience", theme: "Inclusion" },
  { attributeId: "inclusion", type: "discovery", prompt: "Which companies in {industry} are most recognized for diversity, equity, and inclusion?", category: "Employee Experience", theme: "Inclusion" },
  // Innovation
  { attributeId: "innovation", type: "informational", prompt: "How innovative is {companyName}, and what would I get to work on there?", category: "Employee Experience", theme: "Innovation" },
  { attributeId: "innovation", type: "experience", prompt: "What do employees say about innovation and access to new technology at {companyName}?", category: "Employee Experience", theme: "Innovation" },
  { attributeId: "innovation", type: "competitive", prompt: "Is {companyName} a more innovative place to work than other companies in {industry}?", category: "Employee Experience", theme: "Innovation" },
  { attributeId: "innovation", type: "discovery", prompt: "Which companies in {industry} are the most innovative to work for?", category: "Employee Experience", theme: "Innovation" },
  // Application & Communication
  { attributeId: "application-communication", type: "informational", prompt: "What should I expect from the application process and recruiter communication at {companyName}?", category: "Candidate Experience", theme: "Application & Communication" },
  { attributeId: "application-communication", type: "experience", prompt: "How do candidates describe applying to {companyName} — the process, updates, and communication?", category: "Candidate Experience", theme: "Application & Communication" },
  { attributeId: "application-communication", type: "competitive", prompt: "Is applying to {companyName} a better experience than applying to other employers in {industry}?", category: "Candidate Experience", theme: "Application & Communication" },
  { attributeId: "application-communication", type: "discovery", prompt: "Which companies in {industry} have the best application process and candidate communication?", category: "Candidate Experience", theme: "Application & Communication" },
  // Candidate Feedback
  { attributeId: "candidate-feedback", type: "informational", prompt: "Will I get useful feedback after applying or interviewing at {companyName}?", category: "Candidate Experience", theme: "Candidate Feedback" },
  { attributeId: "candidate-feedback", type: "experience", prompt: "What do candidates say about the feedback they get from {companyName} after interviews and applications?", category: "Candidate Experience", theme: "Candidate Feedback" },
  { attributeId: "candidate-feedback", type: "competitive", prompt: "How does {companyName} compare to other employers in {industry} at giving candidates feedback?", category: "Candidate Experience", theme: "Candidate Feedback" },
  { attributeId: "candidate-feedback", type: "discovery", prompt: "Which companies in {industry} are known for giving candidates valuable feedback?", category: "Candidate Experience", theme: "Candidate Feedback" },
  // Interview Experience (the 70% flagship)
  { attributeId: "interview-experience", type: "informational", prompt: "How should I prepare for a job interview at {companyName}?", category: "Candidate Experience", theme: "Interview Experience" },
  { attributeId: "interview-experience", type: "experience", prompt: "How do candidates describe the interview experience at {companyName}?", category: "Candidate Experience", theme: "Interview Experience" },
  { attributeId: "interview-experience", type: "competitive", prompt: "How does the interview process at {companyName} compare to other companies in {industry}?", category: "Candidate Experience", theme: "Interview Experience" },
  { attributeId: "interview-experience", type: "discovery", prompt: "Which companies in {industry} have the best interview experience?", category: "Candidate Experience", theme: "Interview Experience" },
  // Onboarding
  { attributeId: "onboarding-experience", type: "informational", prompt: "What should I expect when I first start working at {companyName}?", category: "Candidate Experience", theme: "Onboarding" },
  { attributeId: "onboarding-experience", type: "experience", prompt: "How do new hires describe their onboarding and first months at {companyName}?", category: "Candidate Experience", theme: "Onboarding" },
  { attributeId: "onboarding-experience", type: "competitive", prompt: "How does onboarding at {companyName} compare to other companies in {industry}?", category: "Candidate Experience", theme: "Onboarding" },
  { attributeId: "onboarding-experience", type: "discovery", prompt: "Which companies in {industry} have the best onboarding for new hires?", category: "Candidate Experience", theme: "Onboarding" },
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

  // Methodology v2 (July 2026): 52 attribute prompts (13 × 4). Base "General"
  // prompts were retired. See docs/methodology-v2-prompt-taxonomy.md.
  const attributePrompts: GeneratedPrompt[] = ATTRIBUTE_PROMPT_TEMPLATES.map((t) => {
    const raw = t.prompt
      .replace(/{companyName}/g, companyName)
      .replace(/{industry}/g, industry);

    return {
      id: `attribute-${t.attributeId}-${t.type}`,
      text: appendPromptContext(raw, jobFunction, locationDisplay),
      type: t.type as GeneratedPrompt["type"],
      industryContext: industry,
      jobFunctionContext: jobFunction,
      locationContext: locationDisplay,
      promptCategory: t.category,
      promptTheme: t.theme,
      attributeId: t.attributeId,
    };
  });

  return attributePrompts;
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
    // promptTypes / models scope the llm_collection phase to a subset chosen by
    // the admin in the UI. They self-chain through subsequent invocations.
    const {
      configId,
      promptTypes,
      models,
    }: {
      configId?: string;
      promptTypes?: string[];
      models?: string[];
    } = await req.json().catch(() => ({}));

    const DEFAULT_MODELS = ["openai", "perplexity", "google-ai-overviews", "google-ai-mode", "claude"];
    const effectiveModels = Array.isArray(models) && models.length > 0 ? models : DEFAULT_MODELS;
    const promptTypeFilter: string[] | null =
      Array.isArray(promptTypes) && promptTypes.length > 0
        ? promptTypes
        : null;

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
    // Pick one pending/processing job (oldest first), skip cancelled.
    // When a specific configId was supplied, we MUST scope to that config —
    // otherwise a stale pending job from another organization can be picked up
    // (this is how GSK data leaked into a Netflix expand-coverage run).
    // -----------------------------------------------------------------------
    // Atomic claim:
    //   1. SELECT a 'pending' candidate (NOT 'processing' — we never resume
    //      another worker's in-flight row; that's the watchdog's job, when on).
    //   2. UPDATE WHERE status='pending' as a compare-and-swap — only one
    //      worker can flip the row to 'processing'. The loser gets no row
    //      back and exits cleanly so it can't double-process.
    //
    // This — combined with the unique index on prompt_responses — closes the
    // duplicate-write hole entirely. Two concurrent invocations either both
    // succeed on different rows or one wins and the other no-ops.
    let candidateQuery = supabase
      .from("company_batch_queue")
      .select("id")
      .eq("status", "pending")
      .or("is_cancelled.is.null,is_cancelled.eq.false")
      .order("created_at", { ascending: true })
      .limit(1);

    if (configId) {
      candidateQuery = candidateQuery.eq("config_id", configId);
    }

    const { data: candidate, error: candidateErr } = await candidateQuery.maybeSingle();
    if (candidateErr) throw candidateErr;

    if (!candidate) {
      return new Response(
        JSON.stringify({ processed: 0, message: "No pending jobs" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = new Date().toISOString();

    // CAS claim
    const { data: claimed, error: claimErr } = await supabase
      .from("company_batch_queue")
      .update({ status: "processing", updated_at: now })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .select("*, company_batch_configs!inner(user_id, organization_id, created_org_id, org_mode)")
      .maybeSingle();

    if (claimErr) throw claimErr;

    if (!claimed) {
      // Another worker beat us to this row. Exit cleanly — the other worker
      // will self-chain to whatever's next; no need to chain from here.
      return new Response(
        JSON.stringify({ processed: 0, message: "Lost claim race — another worker got this row" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const job = claimed;
    const config = job.company_batch_configs;

    console.log(`[BatchQueue] Claimed job ${job.id}: ${job.company_name} / ${job.location} / ${job.industry} / ${job.job_function || "(all)"} — phase: ${job.phase}`);

    let result = { processed: 0, message: "Idle" };

    try {
      // =======================================================================
      // PHASE: expand_setup
      // Append prompts to an EXISTING company_id. Unlike `setup`, this never
      // inserts user_onboarding and never invokes the auto-create-company
      // trigger (which would fork a duplicate companies row).
      // =======================================================================
      if (job.phase === "expand_setup") {
        console.log(`[BatchQueue] Phase: expand_setup (company_id=${job.company_id})`);

        if (!job.company_id) {
          throw new Error("expand_setup job is missing company_id");
        }

        // 1. Verify the company exists and is linked to this config's organization.
        // Prevents an admin from appending prompts onto a company in a different org.
        const orgId = config.org_mode === "new_org" ? config.created_org_id : config.organization_id;
        if (!orgId) {
          throw new Error("expand_setup requires an organization_id on the config");
        }

        const { data: orgLink, error: orgLinkError } = await supabase
          .from("organization_companies")
          .select("company_id")
          .eq("organization_id", orgId)
          .eq("company_id", job.company_id)
          .maybeSingle();

        if (orgLinkError) throw new Error(`Org link lookup failed: ${orgLinkError.message}`);
        if (!orgLink) {
          throw new Error(
            `Company ${job.company_id} is not linked to organization ${orgId} — refusing to append prompts`,
          );
        }

        // 2. Generate prompts for the new (location, industry, job_function) combo.
        const prompts = generatePrompts(
          job.company_name,
          job.industry,
          job.location,
          job.job_function || undefined,
        );

        // 3. Translate if non-English location. `translate-prompts` expects an
        // ISO country code (US, DE, MX, AR, BR, NL, ...) — but queue rows store
        // a free-text location name like "Germany" or "the United Kingdom".
        // Resolve to a code first; translate-prompts handles English/GLOBAL as
        // a pass-through, so we don't need to pre-filter.
        const countryCodeForTranslation = locationToCountryCode(job.location);

        let finalPrompts = prompts;
        if (countryCodeForTranslation && countryCodeForTranslation !== "GLOBAL") {
          console.log(
            `[BatchQueue] Translating ${prompts.length} prompts for ${job.location} (code=${countryCodeForTranslation})...`,
          );
          const { data: translationData, error: translationError } =
            await supabase.functions.invoke("translate-prompts", {
              body: { prompts: prompts.map((p) => p.text), countryCode: countryCodeForTranslation },
            });

          if (translationError) throw new Error(`Translation failed: ${translationError.message}`);

          if (translationData?.translatedPrompts?.length === prompts.length) {
            finalPrompts = prompts.map((p, i) => ({
              ...p,
              text: translationData.translatedPrompts[i] || p.text,
            }));
          } else {
            throw new Error("Translation returned incomplete results");
          }
        }

        // 4. Insert confirmed_prompts attached to the existing company_id.
        //    No onboarding_id — these prompts were not created via the onboarding flow.
        //
        //    Dedupe in two passes before the INSERT (can't use ON CONFLICT —
        //    the unique index is partial, PostgREST doesn't support that):
        //    a) In-memory on (prompt_text, prompt_type) — translation can
        //       occasionally produce identical output for two different attribute
        //       templates within the same batch.
        //    b) Against existing DB rows for this (company, location) — a
        //       previous run may have already inserted the same text, and the
        //       partial unique index would abort the whole batch on any hit.
        const inMemorySeen = new Set<string>();
        const candidates: any[] = [];
        for (const p of finalPrompts) {
          const promptType = p.type;
          const key = `${p.text}||${promptType}`;
          if (inMemorySeen.has(key)) continue;
          inMemorySeen.add(key);
          candidates.push({
            onboarding_id: null,
            user_id: config.user_id,
            company_id: job.company_id,
            prompt_text: p.text,
            prompt_category: p.promptCategory,
            prompt_theme: p.promptTheme,
            prompt_type: promptType,
            attribute_id: p.attributeId || null,
            industry_context: p.industryContext,
            job_function_context: p.jobFunctionContext || null,
            location_context: p.locationContext || null,
            is_active: true,
            prompt_version: 2,
          });
        }

        // Pull every already-existing prompt for this (company, location) and
        // build a set of their (prompt_text, prompt_type, industry_context)
        // signatures — same columns the partial unique index covers (minus
        // the ones we already fix above).
        const { data: existingForLocation, error: existingErr } = await supabase
          .from("confirmed_prompts")
          .select("prompt_text, prompt_type, industry_context")
          .eq("company_id", job.company_id)
          .eq("location_context", job.location);
        if (existingErr) throw new Error(`Existing prompt check failed: ${existingErr.message}`);

        const existingSig = new Set(
          (existingForLocation || []).map(
            (r: any) => `${r.prompt_text}||${r.prompt_type}||${r.industry_context || ""}`,
          ),
        );

        const promptRows = candidates.filter((r) => {
          const sig = `${r.prompt_text}||${r.prompt_type}||${r.industry_context || ""}`;
          return !existingSig.has(sig);
        });

        if (promptRows.length === 0) {
          console.log("[BatchQueue] All prompts already exist for this (company, location); skipping insert");
        } else {
          const { error: insertError } = await supabase
            .from("confirmed_prompts")
            .insert(promptRows);

          if (insertError) throw new Error(`Prompt insert failed: ${insertError.message}`);
        }

        // 5. Advance directly to llm_collection — no search_insights re-run on expand,
        //    and no re-link to org (already linked).
        await supabase
          .from("company_batch_queue")
          .update({
            phase: "llm_collection",
            total_prompts: finalPrompts.length,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        result = {
          processed: 1,
          message: `Expand setup complete: ${finalPrompts.length} prompts appended to company ${job.company_id}`,
        };
      }

      // =======================================================================
      // PHASE: setup
      // =======================================================================
      else if (job.phase === "setup") {
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

        // 2. Resolve the company. A company's identity is (name + org) ONLY.
        //    Industry, market, and function are peer *data dimensions* that make
        //    each prompt unique (industry_context / location_context /
        //    job_function_context) — they must NOT fork the company row, or the
        //    dashboard can't pivot one employer across those dimensions. Every
        //    (industry, location, function) setup job for the same employer must
        //    converge on ONE companies row. (The auto_create_company trigger that
        //    used to dedupe was dropped in migration 20260504063318, so we dedupe
        //    here.) This prevents the duplicate-company fan-out where each job
        //    spawned its own "Netflix Animation Studios".
        const setupOrgId =
          config.org_mode === "new_org" ? config.created_org_id : config.organization_id;

        let companyId: string | null = null;

        if (setupOrgId) {
          const { data: existingCompany } = await supabase
            .from("companies")
            .select("id, organization_companies!inner(organization_id)")
            .eq("name", job.company_name)
            .eq("organization_companies.organization_id", setupOrgId)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (existingCompany) companyId = existingCompany.id;
        }

        if (!companyId) {
          const { data: companyData, error: companyError } = await supabase
            .from("companies")
            .insert({
              name: job.company_name,
              industry: job.industry,
              created_by: config.user_id,
              onboarding_id: onboarding.id,
            })
            .select("id")
            .single();

          if (companyError) throw new Error(`Company insert failed: ${companyError.message}`);
          companyId = companyData.id;
        }

        // Keep user_onboarding.company_id in sync for any legacy reads.
        await supabase
          .from("user_onboarding")
          .update({ company_id: companyId })
          .eq("id", onboarding.id);

        // 3. Generate prompts
        const prompts = generatePrompts(
          job.company_name,
          job.industry,
          job.location,
          job.job_function || undefined,
        );

        // 4. Translate if non-English location. Queue rows store free-text
        // names ("Brazil", "Germany") but translate-prompts expects ISO codes
        // ("BR", "DE") — resolve first, then skip English-speaking countries.
        const countryCodeForTranslation = locationToCountryCode(job.location);
        const needsTranslation =
          countryCodeForTranslation !== null &&
          countryCodeForTranslation !== "GLOBAL" &&
          !ENGLISH_SPEAKING_COUNTRIES.includes(countryCodeForTranslation);

        let finalPrompts = prompts;
        if (needsTranslation) {
          console.log(
            `[BatchQueue] Translating ${prompts.length} prompts for ${job.location} (code=${countryCodeForTranslation})...`,
          );
          const { data: translationData, error: translationError } =
            await supabase.functions.invoke("translate-prompts", {
              body: { prompts: prompts.map((p) => p.text), countryCode: countryCodeForTranslation },
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

        // 5. Insert confirmed_prompts. Dedupe against any rows already present
        //    for this (company, location) — because the company may now be
        //    shared across sibling setup jobs (and across retries), a plain
        //    insert could otherwise collide on the partial unique index and
        //    abort the whole batch.
        const setupCandidates = finalPrompts.map((p) => ({
          onboarding_id: onboarding.id,
          user_id: config.user_id,
          company_id: companyId,
          prompt_text: p.text,
          prompt_category: p.promptCategory,
          prompt_theme: p.promptTheme,
          prompt_type: p.type,
          attribute_id: p.attributeId || null,
          industry_context: p.industryContext,
          job_function_context: p.jobFunctionContext || null,
          location_context: p.locationContext || null,
          is_active: true,
          prompt_version: 2,
        }));

        const { data: setupExisting, error: setupExistingErr } = await supabase
          .from("confirmed_prompts")
          .select("prompt_text, prompt_type, industry_context")
          .eq("company_id", companyId)
          .eq("location_context", finalPrompts[0]?.locationContext ?? null);
        if (setupExistingErr) throw new Error(`Existing prompt check failed: ${setupExistingErr.message}`);

        const setupExistingSig = new Set(
          (setupExisting || []).map(
            (r: any) => `${r.prompt_text}||${r.prompt_type}||${r.industry_context || ""}`,
          ),
        );

        const promptRows = setupCandidates.filter((r) => {
          const sig = `${r.prompt_text}||${r.prompt_type}||${r.industry_context || ""}`;
          return !setupExistingSig.has(sig);
        });

        if (promptRows.length > 0) {
          const { error: insertError } = await supabase
            .from("confirmed_prompts")
            .insert(promptRows);

          if (insertError) throw new Error(`Prompt insert failed: ${insertError.message}`);
        }

        // 6. Link company to organization (idempotent — may already be linked
        //    from a sibling setup job that created/reused the same company).
        if (setupOrgId) {
          await supabase
            .from("organization_companies")
            .insert({ organization_id: setupOrgId, company_id: companyId, added_by: config.user_id })
            .select()
            .maybeSingle(); // ignore duplicate
          // company_members retired — membership inherits from
          // organization_members for this org.
        }

        // 7. Advance phase — search_insights removed (AI prompts only)
        await supabase
          .from("company_batch_queue")
          .update({
            phase: "llm_collection",
            company_id: companyId,
            onboarding_id: onboarding.id,
            total_prompts: finalPrompts.length,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        result = { processed: 1, message: `Setup complete: ${finalPrompts.length} prompts, company ${companyId}` };
      }

      // =======================================================================
      // PHASE: llm_collection
      // Chunked to stay under the 150s edge-function timeout. Each invocation
      // processes CHUNK_SIZE prompts, advances batch_index, and self-chains
      // until every prompt for THIS job (company_id × location × industry ×
      // job_function) has been collected.
      // =======================================================================
      else if (job.phase === "llm_collection") {
        // NOTE: widening this in-invocation (CHUNK_SIZE 8 + batchSize=CHUNK_SIZE)
        // did NOT speed collection up — measured ~122 prompts/hr either way — and
        // pushed a single collect-company-responses call to ~147s, right at the
        // 150s edge-function timeout. One edge invocation can't truly parallelize
        // ~40 concurrent sub-calls (CPU/runtime serialization), so a bigger batch
        // just runs proportionally longer at the same rate, with timeout risk.
        // Reverted to the proven-stable 2. Real throughput fix = fan out across
        // multiple concurrent invocations, not a bigger single batch.
        const CHUNK_SIZE = 2;
        console.log(`[BatchQueue] Phase: llm_collection (batch_index=${job.batch_index})`);

        // Scope the prompt set to THIS job, not all of the company's prompts.
        // Otherwise sibling expand_setup jobs for the same company all fetch
        // the full superset and do redundant work.
        let promptQuery = supabase
          .from("confirmed_prompts")
          .select("id")
          .eq("company_id", job.company_id)
          .eq("is_active", true)
          .order("id", { ascending: true });

        // Only filter by location when the job specifies one. `location` is
        // NOT NULL on the queue row, but historical "Global (All Countries)"
        // may not match the stored location_context, so leave un-filtered if
        // that's the case.
        if (job.location && job.location !== "Global (All Countries)") {
          promptQuery = promptQuery.eq("location_context", job.location);
        }
        if (job.industry && job.industry !== "General") {
          promptQuery = promptQuery.eq("industry_context", job.industry);
        }
        if (job.job_function) {
          promptQuery = promptQuery.eq("job_function_context", job.job_function);
        }
        if (promptTypeFilter) {
          promptQuery = promptQuery.in("prompt_type", promptTypeFilter);
        }

        const { data: promptRows, error: promptErr } = await promptQuery;
        if (promptErr) throw new Error(`Prompt fetch failed: ${promptErr.message}`);

        const allPromptIds = promptRows?.map((r: any) => r.id) || [];
        const totalPrompts = allPromptIds.length;

        if (totalPrompts === 0) {
          console.warn("[BatchQueue] No prompts found for job scope, marking done");
          await supabase
            .from("company_batch_queue")
            .update({ phase: "done", status: "completed", updated_at: new Date().toISOString() })
            .eq("id", job.id);
          result = { processed: 0, message: "No prompts, marked complete" };
        } else {
          const offset = job.batch_index || 0;
          const chunk = allPromptIds.slice(offset, offset + CHUNK_SIZE);

          if (chunk.length === 0) {
            // Cursor past the end — finish this job.
            await supabase
              .from("company_batch_queue")
              .update({
                phase: "done",
                status: "completed",
                batch_index: totalPrompts,
                total_prompts: totalPrompts,
                updated_at: new Date().toISOString(),
                error_log: null,
              })
              .eq("id", job.id);
            result = { processed: 0, message: `LLM collection already complete (${totalPrompts}/${totalPrompts})` };
          } else {
            console.log(
              `[BatchQueue] llm_collection chunk ${offset}..${offset + chunk.length} of ${totalPrompts}`,
            );

            // If the parent config carries a skip_if_collected_in_month value
            // (set by the monthly-refresh cron), forward it so each prompt is
            // only collected if it doesn't already have THIS MONTH's response
            // for the given model. Without this, skipExisting:true would skip
            // any prompt that has *any* historical response and our monthly
            // snapshots would never refresh.
            const skipIfCollectedInMonth: string | null =
              (config as any)?.skip_if_collected_in_month ?? null;

            const { data: collectData, error: collectError } = await supabase.functions.invoke(
              "collect-company-responses",
              {
                body: {
                  companyId: job.company_id,
                  promptIds: chunk,
                  models: effectiveModels,
                  batchSize: 1,
                  skipExisting: true,
                  skipIfCollectedInMonth,
                  // Queue runs are latency-tolerant: route Claude through the
                  // Anthropic Message Batches API (50% cheaper). Results land
                  // asynchronously via claude-batch-collector's poll tick.
                  claudeViaBatch: true,
                },
              },
            );

            if (collectError) throw new Error(`LLM collection failed: ${collectError.message}`);
            if (!collectData?.success) throw new Error(collectData?.error || "LLM collection failed");

            const newOffset = offset + chunk.length;
            const isDone = newOffset >= totalPrompts;

            await supabase
              .from("company_batch_queue")
              .update({
                // Not done yet → leave as 'pending' (not 'processing') so the
                // self-chained invocation can immediately re-claim this row and
                // collect the next chunk. Marking it 'processing' here strands
                // it until the 5-minute watchdog flips it back, which throttles
                // collection to one chunk per job every ~5 min and floods Slack
                // with reset alerts. The atomic CAS claim still prevents two
                // workers grabbing the same row, so 'pending' is safe.
                phase: isDone ? "done" : "llm_collection",
                status: isDone ? "completed" : "pending",
                batch_index: newOffset,
                total_prompts: totalPrompts,
                updated_at: new Date().toISOString(),
                error_log: null,
                retry_count: 0, // reset on successful chunk
              })
              .eq("id", job.id);

            result = {
              processed: 1,
              message: `LLM collection ${isDone ? "complete" : "chunk done"}: ${newOffset}/${totalPrompts} prompts, +${collectData.summary?.responsesCollected || 0} responses`,
            };
          }
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
      // Self-chain: check for more pending work. Scope to this configId when
      // one was supplied, so an Expand-Coverage run can't drag in stale jobs
      // from other organizations' configs.
      // =======================================================================
      let remainingQuery = supabase
        .from("company_batch_queue")
        .select("*", { count: "exact", head: true })
        .in("status", ["pending", "processing"])
        .or("is_cancelled.is.null,is_cancelled.eq.false");

      if (configId) {
        remainingQuery = remainingQuery.eq("config_id", configId);
      }

      const { count } = await remainingQuery;

      if (count && count > 0) {
        console.log(`[BatchQueue] ${count} jobs remaining for ${configId ? `config ${configId}` : "global queue"}, self-chaining...`);
        const chainPromise = fetch(`${supabaseUrl}/functions/v1/process-company-batch-queue`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...(configId ? { configId } : {}),
            ...(Array.isArray(promptTypes) && promptTypes.length > 0 ? { promptTypes } : {}),
            ...(Array.isArray(models) && models.length > 0 ? { models } : {}),
          }),
        }).catch((e) => console.error("[BatchQueue] Failed to chain:", e));

        // Keep the isolate alive until the chain request actually leaves the
        // wire. Without this, Deno tears down the function on return and the
        // pending fetch is silently aborted — that's why the queue keeps
        // dying mid-run.
        try {
          // @ts-ignore — EdgeRuntime is provided by the Supabase Deno runtime
          (globalThis as any).EdgeRuntime?.waitUntil(chainPromise);
        } catch {
          // If waitUntil isn't available (e.g. local supabase dev),
          // fall back to awaiting; slightly slower but reliable.
          await chainPromise;
        }
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

      // If not failed, chain to retry — preserve configId scope.
      if (newStatus === "pending") {
        const retryChain = fetch(`${supabaseUrl}/functions/v1/process-company-batch-queue`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...(configId ? { configId } : {}),
            ...(Array.isArray(promptTypes) && promptTypes.length > 0 ? { promptTypes } : {}),
            ...(Array.isArray(models) && models.length > 0 ? { models } : {}),
          }),
        }).catch((e) => console.error("[BatchQueue] Failed to chain after error:", e));

        try {
          // @ts-ignore
          (globalThis as any).EdgeRuntime?.waitUntil(retryChain);
        } catch {
          await retryChain;
        }
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
