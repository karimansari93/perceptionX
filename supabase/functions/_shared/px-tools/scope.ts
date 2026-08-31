// ─── px-tools: brand scope + location resolution ────────────────────────────
// The org data model is brand × market: "Netflix" in the Netflix org is ~16
// company rows (IN, JP, DE, …) plus distinct brands like "Netflix House".
// Dashboard numbers aggregate the brand scope (the selected company plus its
// same-name sibling profiles in the same org), so the insight tools do the
// same — otherwise chat/MCP answers would not match the app.

export interface ToolContext {
  admin: any;                 // service-role supabase client
  organizationId: string;     // verified org of the caller (never model-chosen)
  requestId: string;
}

export interface BrandScope {
  companyIds: string[];       // entry company + same-name org siblings
  brandName: string;
  entryCompanyId: string;
}

// Validate that every required company_id belongs to the caller's org.
// Defense-in-depth: even if the model fabricates a company_id it saw
// elsewhere, we reject it here before any data is read. RLS is disabled on
// some hot tables, so this check is the primary tenant boundary.
export async function validateCompanyOwnership(
  admin: any,
  organizationId: string,
  companyIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!companyIds.length) return { ok: true };
  const { data, error } = await admin
    .from('organization_companies')
    .select('company_id')
    .eq('organization_id', organizationId)
    .in('company_id', companyIds);
  if (error) return { ok: false, error: `Ownership check failed: ${error.message}` };
  const owned = new Set((data || []).map((r: any) => r.company_id));
  const unowned = companyIds.filter(id => !owned.has(id));
  if (unowned.length) {
    return { ok: false, error: `Company IDs not in your organization: ${unowned.join(', ')}. Call list_companies to see valid IDs.` };
  }
  return { ok: true };
}

// Resolve the brand scope for a company. Sibling ids come FROM the org's own
// organization_companies rows, so they are owned by construction.
export async function resolveBrandScope(
  ctx: ToolContext,
  companyId: string,
  includeSiblings: boolean
): Promise<BrandScope | { error: string }> {
  const { data: company, error } = await ctx.admin
    .from('companies').select('id, name').eq('id', companyId).maybeSingle();
  if (error || !company) return { error: `Company not found.` };
  if (!includeSiblings) {
    return { companyIds: [companyId], brandName: company.name, entryCompanyId: companyId };
  }
  const { data: siblings, error: sibErr } = await ctx.admin
    .from('organization_companies')
    .select('company_id, companies!inner(id, name)')
    .eq('organization_id', ctx.organizationId);
  if (sibErr) return { companyIds: [companyId], brandName: company.name, entryCompanyId: companyId };
  const ids = (siblings || [])
    .filter((r: any) => (r.companies?.name || '').trim().toLowerCase() === company.name.trim().toLowerCase())
    .map((r: any) => r.company_id);
  if (!ids.includes(companyId)) ids.push(companyId);
  return { companyIds: ids, brandName: company.name, entryCompanyId: companyId };
}

// ─── Location bucket matching ───────────────────────────────────────────────
// location_context is free-text on prompts ("India", "Berlin, Germany", "" =
// untagged/global). A user asking about "japan" must match the org's actual
// spellings. We fetch the scope's distinct buckets (cheap: from the scope
// stats cube) and fuzzy-match: exact (case-insensitive) first, then
// containment either way. Returns the matched raw spellings to query with —
// and, on no match, the list of available buckets so the model can tell the
// user what IS tracked instead of guessing.
export async function resolveLocationBuckets(
  ctx: ToolContext,
  companyIds: string[],
  requestedLocation: string
): Promise<{ buckets: string[]; available: string[] }> {
  // Via a service-role RPC (distinct server-side) rather than a table read,
  // so the bucket list is never truncated by PostgREST row caps.
  const { data } = await ctx.admin.rpc('mcp_list_location_buckets', { p_company_ids: companyIds });
  const available = Array.from(
    new Set(((data as string[] | null) || []).map((l) => (l ?? '').trim()).filter((l) => l !== ''))
  ).sort() as string[];
  const q = requestedLocation.trim().toLowerCase();
  if (!q) return { buckets: [], available };
  const exact = available.filter(l => l.toLowerCase() === q);
  if (exact.length) return { buckets: exact, available };
  const fuzzy = available.filter(l => l.toLowerCase().includes(q) || q.includes(l.toLowerCase()));
  return { buckets: fuzzy, available };
}
