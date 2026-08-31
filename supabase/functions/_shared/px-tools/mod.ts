// ─── px-tools: entry point ──────────────────────────────────────────────────
// The shared data-tool layer. Two consumers:
//   * supabase/functions/chat-with-data — the in-app analyst (also the dev
//     eval harness for this layer)
//   * supabase/functions/mcp-server    — the MCP surface for ChatGPT/Claude
// One registry, one executor, one tenancy check — so every surface reports
// the same numbers with the same caveats.

import { clampInt, isUuid } from './helpers.ts';
import { validateCompanyOwnership } from './scope.ts';
import type { ToolContext } from './scope.ts';
import {
  compareCompanies, getAttributeBreakdown, getCitations, getCompanyMetrics,
  getCompanyOverview, getCompetitors, getModelBreakdown, getResponses,
  getThemes, listCompanies, searchResponses,
} from './executors-core.ts';
import {
  getAttributeThemes, getCompetitorLandscape, getSources, getTrends, getVisibility,
} from './executors-insights.ts';

export { PX_TOOLS, anthropicTools, mcpTools, toolLabels } from './tools.ts';
export { coverageFound, coverageNoData, coveragePartial, genRequestId } from './helpers.ts';
export { validateCompanyOwnership } from './scope.ts';
export type { ToolContext } from './scope.ts';
export { ATTRIBUTES_V2 } from './executors-insights.ts';

// Tools that take a single `company_id` argument (UUID-validated + tenancy-
// checked before execution).
const SINGLE_ID_TOOLS = new Set([
  'get_company_overview', 'get_company_metrics', 'get_responses',
  'get_themes', 'get_attribute_breakdown', 'get_competitors',
  'get_citations', 'get_model_breakdown', 'search_responses',
  'get_attribute_themes', 'get_visibility', 'get_sources',
  'get_competitor_landscape', 'get_trends',
]);

export async function executeTool(
  ctx: ToolContext,
  toolName: string,
  toolInput: any
): Promise<string> {
  const t0 = Date.now();
  try {
    // Input validation: UUID shape + bounded limits. Rejected here, the model
    // sees the error text and can self-correct on the next turn instead of
    // generating a bogus tool result that pollutes its context.
    if (SINGLE_ID_TOOLS.has(toolName) && !isUuid(toolInput?.company_id)) {
      return JSON.stringify({ error: `Invalid company_id (must be a UUID). Call list_companies first to get valid IDs.` });
    }
    if (toolName === 'compare_companies') {
      if (!Array.isArray(toolInput?.company_ids) || !toolInput.company_ids.every(isUuid)) {
        return JSON.stringify({ error: `company_ids must be an array of UUIDs.` });
      }
    }

    // Tenant isolation: every company_id mentioned in the call must belong
    // to the authenticated caller's organization. This is the hard security
    // boundary — RLS is disabled on some tables, so this check is the
    // primary defense against cross-tenant reads. Sibling ids resolved
    // inside the insight tools come from the org's own rows by construction.
    const idsToCheck: string[] = [];
    if (SINGLE_ID_TOOLS.has(toolName) && toolInput?.company_id) idsToCheck.push(toolInput.company_id);
    if (toolName === 'compare_companies' && Array.isArray(toolInput?.company_ids)) idsToCheck.push(...toolInput.company_ids);
    if (idsToCheck.length) {
      const ownership = await validateCompanyOwnership(ctx.admin, ctx.organizationId, idsToCheck);
      if (!ownership.ok) {
        console.warn(`[${ctx.requestId}] tool=${toolName} ownership_rejected ids=${idsToCheck.join(',')}`);
        return JSON.stringify({ error: ownership.error });
      }
    }

    const includeSiblings = toolInput?.include_siblings !== false;

    let result: string;
    switch (toolName) {
      case 'list_companies':
        result = await listCompanies(ctx);
        break;
      case 'get_company_overview':
        result = await getCompanyOverview(ctx, toolInput.company_id);
        break;
      case 'get_company_metrics':
        result = await getCompanyMetrics(ctx, toolInput.company_id);
        break;
      case 'get_responses':
        result = await getResponses(
          ctx, toolInput.company_id,
          clampInt(toolInput.limit, 1, 50, 15),
          toolInput.prompt_type, toolInput.ai_model, toolInput.sentiment_filter
        );
        break;
      case 'get_themes':
        result = await getThemes(ctx, toolInput.company_id);
        break;
      case 'get_attribute_breakdown':
        result = await getAttributeBreakdown(ctx, toolInput.company_id);
        break;
      case 'get_competitors':
        result = await getCompetitors(ctx, toolInput.company_id);
        break;
      case 'get_citations':
        result = await getCitations(ctx, toolInput.company_id, !!toolInput.include_snippets, toolInput.domain_filter);
        break;
      case 'compare_companies':
        result = await compareCompanies(ctx, toolInput.company_ids.slice(0, 10));
        break;
      case 'get_model_breakdown':
        result = await getModelBreakdown(ctx, toolInput.company_id);
        break;
      case 'search_responses':
        if (typeof toolInput?.keyword !== 'string' || !toolInput.keyword.trim()) {
          return JSON.stringify({ error: `search_responses requires a non-empty keyword.` });
        }
        result = await searchResponses(
          ctx, toolInput.company_id, toolInput.keyword.trim(),
          clampInt(toolInput.limit, 1, 30, 10)
        );
        break;
      case 'get_attribute_themes':
        result = await getAttributeThemes(
          ctx, toolInput.company_id, toolInput.attribute_id, toolInput.location,
          clampInt(toolInput.quarters_back, 1, 8, 4), includeSiblings
        );
        break;
      case 'get_visibility':
        result = await getVisibility(
          ctx, toolInput.company_id, toolInput.location,
          clampInt(toolInput.quarters_back, 1, 8, 4), !!toolInput.by_model, includeSiblings
        );
        break;
      case 'get_sources':
        result = await getSources(
          ctx, toolInput.company_id, toolInput.location,
          clampInt(toolInput.quarters_back, 1, 8, 4), !!toolInput.gap_only,
          clampInt(toolInput.limit, 1, 100, 25), includeSiblings
        );
        break;
      case 'get_competitor_landscape':
        result = await getCompetitorLandscape(
          ctx, toolInput.company_id, toolInput.location, toolInput.attribute_id,
          clampInt(toolInput.quarters_back, 1, 8, 4),
          clampInt(toolInput.limit, 1, 50, 15), includeSiblings
        );
        break;
      case 'get_trends':
        result = await getTrends(
          ctx, toolInput.company_id, toolInput.metric || 'visibility', toolInput.location,
          clampInt(toolInput.quarters_back, 1, 8, 4), includeSiblings
        );
        break;
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
    console.log(`[${ctx.requestId}] tool=${toolName} ok ms=${Date.now() - t0} size=${result.length}`);
    return result;
  } catch (err: any) {
    console.error(`[${ctx.requestId}] tool=${toolName} error ms=${Date.now() - t0}:`, err);
    return JSON.stringify({ error: `Tool execution failed: ${err.message}` });
  }
}
