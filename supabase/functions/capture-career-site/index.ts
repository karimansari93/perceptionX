// ─── capture-career-site: the page behind the Career Site tab's preview ─────
//
// Career sites refuse to be framed. Every one we checked — pepsicojobs.com,
// careers.ford.com, jobs.netflix.com, disneycareers.com, careers.microsoft.com
// — sends X-Frame-Options DENY or SAMEORIGIN, so an iframe pointed at the live
// site renders an empty box. This function stores a capture of the page
// instead, which the tab serves from our own origin.
//
// Serving our own copy is not just a workaround for the header. Because the
// markup is ours, the client can measure it: the passages Google AI Overviews
// and AI Mode quote (recovered from their `#:~:text=` citation fragments) can
// be located in the DOM and highlighted at their real coordinates. A
// cross-origin frame would never expose that, headers or no headers.
//
// Two safety rules govern what this will fetch and what it hands back:
//
//   * it will only capture a URL whose host is already in the company's
//     detected career-site property (company_career_domains_mv). The URL
//     arrives from the client, so without that check this endpoint would
//     fetch anything a caller named, against our egress;
//   * the stored HTML is sanitized here, not at render time — scripts,
//     frames, plugin objects, inline event handlers and javascript: URLs are
//     stripped before the row is written, so a capture can never carry
//     executable third-party markup into the app. The renderer sandboxes it
//     again (see CareerSitePreview.tsx); this is the first of the two layers.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const CAPTURE_TIMEOUT_MS = 60_000;
// A capture is a page snapshot, not a live view; re-fetching on every tab
// visit would burn Firecrawl credits for markup that changes monthly at most.
const CAPTURE_TTL_HOURS = 24 * 7;
const MAX_HTML_BYTES = 4_000_000;
// Matches CAPTURE_WIDTH in CareerSitePreview.tsx: the capture is measured and
// scaled to fit at this width, so capturing at another one would place the
// highlights against a layout the client never renders.
const CAPTURE_VIEWPORT = { width: 1280, height: 720 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Sanitizer ──────────────────────────────────────────────────────────────
//
// Deliberately allow-nothing-executable rather than allow-list-tags: the goal
// is a faithful-looking snapshot with every script path removed, not a
// general-purpose HTML cleaner. Stylesheets and images are left alone — they
// load from the origin site over https and cannot execute.

function sanitizeHtml(html: string, baseUrl: string): string {
  let out = html;
  // Element content that can execute or embed another browsing context.
  out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "");
  out = out.replace(/<script\b[^>]*\/?>/gi, "");
  out = out.replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, "");
  out = out.replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, "");
  out = out.replace(/<iframe\b[^>]*\/?>/gi, "");
  out = out.replace(/<(object|embed|applet)\b[\s\S]*?<\/\1\s*>/gi, "");
  out = out.replace(/<(object|embed|applet)\b[^>]*\/?>/gi, "");
  // <base> is re-added below; a page-supplied one would re-point every asset.
  out = out.replace(/<base\b[^>]*>/gi, "");
  // Inline handlers: on…="…", on…='…', on…=bare.
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
  // javascript:/vbscript: in href/src/action.
  out = out.replace(/\s(href|src|action)\s*=\s*"\s*(javascript|vbscript):[^"]*"/gi, ' $1="#"');
  out = out.replace(/\s(href|src|action)\s*=\s*'\s*(javascript|vbscript):[^']*'/gi, " $1='#'");
  // srcdoc smuggles a whole document past the checks above.
  out = out.replace(/\ssrcdoc\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\ssrcdoc\s*=\s*'[^']*'/gi, "");

  // Relative assets must resolve against the captured origin, and every link
  // opens in a new tab so a click can never navigate the app's own frame.
  const baseTag = `<base href="${escapeAttr(baseUrl)}"><base target="_blank">`;
  if (/<head\b[^>]*>/i.test(out)) {
    out = out.replace(/<head\b[^>]*>/i, (m) => `${m}${baseTag}`);
  } else {
    out = `${baseTag}${out}`;
  }
  return out;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Handler ────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { companyId, url, force } = await req.json().catch(() => ({}));
    if (!companyId || !url) return jsonResponse({ error: "companyId and url are required" }, 400);

    // ── Auth: the token's user must belong to an org that owns the company.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing authorization header" }, 401);
    const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return jsonResponse({ error: "Invalid authentication" }, 401);

    const { data: access } = await admin
      .from("organization_companies")
      .select("organization_id, organization_members!inner(user_id)")
      .eq("company_id", companyId)
      .eq("organization_members.user_id", user.id)
      .maybeSingle();
    if (!access) return jsonResponse({ error: "You do not have access to this company" }, 403);

    // ── The URL must name a host in this company's career-site property.
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return jsonResponse({ error: "Malformed url" }, 400);
    }
    if (target.protocol !== "https:") {
      return jsonResponse({ error: "Only https URLs can be captured" }, 400);
    }
    const host = target.hostname.toLowerCase().replace(/^www\./, "");
    const { data: allowed } = await admin
      .from("company_career_domains_mv")
      .select("domain")
      .eq("company_id", companyId);
    const allowList = new Set((allowed ?? []).map((r: { domain: string }) => r.domain));
    if (!allowList.has(host)) {
      return jsonResponse(
        { error: "That URL is not part of this company's detected career site" },
        403,
      );
    }

    // ── Serve a recent capture rather than re-fetching.
    const { data: existing } = await admin
      .from("career_site_captures")
      .select("id, status, captured_at")
      .eq("company_id", companyId)
      .eq("url", url)
      .maybeSingle();

    const freshEnough = existing?.status === "ready" && existing.captured_at &&
      Date.now() - new Date(existing.captured_at).getTime() < CAPTURE_TTL_HOURS * 3600_000;
    if (freshEnough && !force) {
      return jsonResponse({ status: "ready", cached: true, captureId: existing.id });
    }

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) return jsonResponse({ error: "Firecrawl API key not configured" }, 500);

    await admin.from("career_site_captures").upsert({
      company_id: companyId,
      url,
      status: "pending",
      error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,url" });

    // ── Fetch.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);
    let payload: any;
    try {
      const res = await fetch(FIRECRAWL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${firecrawlKey}` },
        body: JSON.stringify({
          url,
          // v2 takes formats as objects; the v1 "screenshot@fullPage" string
          // form is silently not a v2 format.
          formats: [
            { type: "rawHtml" },
            { type: "screenshot", fullPage: true, viewport: CAPTURE_VIEWPORT },
          ],
          onlyMainContent: false,
          waitFor: 3000,
          timeout: CAPTURE_TIMEOUT_MS - 5000,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Firecrawl responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
      payload = await res.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Capture failed";
      await admin.from("career_site_captures").upsert({
        company_id: companyId, url, status: "failed", error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id,url" });
      return jsonResponse({ status: "failed", error: message }, 502);
    } finally {
      clearTimeout(timer);
    }

    const rawHtml: string = payload?.data?.rawHtml ?? payload?.data?.html ?? "";
    if (!rawHtml) {
      await admin.from("career_site_captures").upsert({
        company_id: companyId, url, status: "failed", error: "Capture returned no HTML",
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id,url" });
      return jsonResponse({ status: "failed", error: "Capture returned no HTML" }, 502);
    }

    const sanitized = sanitizeHtml(rawHtml, `${target.origin}${target.pathname}`).slice(0, MAX_HTML_BYTES);

    const { data: saved, error: saveError } = await admin
      .from("career_site_captures")
      .upsert({
        company_id: companyId,
        url,
        status: "ready",
        html: sanitized,
        base_url: target.origin,
        screenshot_url: payload?.data?.screenshot ?? null,
        title: payload?.data?.metadata?.title ?? null,
        error: null,
        captured_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id,url" })
      .select("id")
      .single();
    if (saveError) throw saveError;

    return jsonResponse({ status: "ready", cached: false, captureId: saved.id });
  } catch (error) {
    console.error("capture-career-site error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
