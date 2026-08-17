import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type ActionRegister = 'act_now' | 'watch' | 'regional' | 'retired';
export type ActionEditorialStatus = 'new' | 'carried' | 'overdue' | 'retired';
export type ActionWorkStatus = 'open' | 'in_progress' | 'done';
export type ActionWorkKind =
  | 'reviews'
  | 'conversations'
  | 'outreach'
  | 'profile_claims'
  | 'certifications'
  | 'owned_content'
  | 'social_pr';

export interface AiRead {
  label: string;
  url?: string;
}

/** One authored to-do. `url` is the specific page that step acts on. */
export interface ActionStep {
  label: string;
  url?: string | null;
}

export interface CompanyAction {
  id: string;
  company_id: string;
  organization_id: string;
  key: string;
  period_label: string;
  register: ActionRegister;
  work_kind: ActionWorkKind | null;
  source_name: string | null;
  source_label: string | null;
  source_domain: string | null;
  /** Authored checklist. Completion lives in steps_done, by index. */
  steps: ActionStep[];
  steps_done: number[];
  editorial_status: ActionEditorialStatus;
  overdue_count: number;
  title: string;
  recommendation: string | null;
  evidence: string | null;
  categories: string[];
  moves: string[];
  markets: string[];
  functions: string[];
  ai_reads: AiRead[];
  evidence_filter: Record<string, unknown>;
  assignee_id: string | null;
  assigned_at: string | null;
  work_status: ActionWorkStatus;
  asserted_done_at: string | null;
  asserted_done_by: string | null;
  assertion_note: string | null;
  assertion_url: string | null;
  published_at: string | null;
}

export interface ActionAssignee {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

// Steps were originally a plain string array and became [{label, url}].
// Both shapes are accepted so a stale row can never blank the checklist.
const parseSteps = (value: unknown): ActionStep[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): ActionStep | null => {
      if (typeof entry === 'string') return { label: entry, url: null };
      if (entry && typeof entry === 'object') {
        const row = entry as { label?: unknown; url?: unknown };
        if (typeof row.label === 'string') {
          return { label: row.label, url: typeof row.url === 'string' ? row.url : null };
        }
      }
      return null;
    })
    .filter((entry): entry is ActionStep => entry !== null);
};

const parseAiReads = (value: unknown): AiRead[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): AiRead | null => {
      if (typeof entry === 'string') return { label: entry };
      if (entry && typeof entry === 'object') {
        const row = entry as { label?: unknown; url?: unknown };
        if (typeof row.label === 'string') {
          return { label: row.label, url: typeof row.url === 'string' ? row.url : undefined };
        }
      }
      return null;
    })
    .filter((entry): entry is AiRead => entry !== null);
};

/**
 * Published actions for an organization, plus the mutations the Actions page
 * needs.
 *
 * Scoped to the org, not the selected company: a client org holds one company
 * profile per market, and a quarterly report spans all of them. The market an
 * action applies to lives in its markets[], so the same list shows no matter
 * which profile is selected.
 *
 * Reads hit the table directly (RLS lets every org member see every published
 * action). Writes go through RPCs — the table has no client UPDATE policy,
 * because row-level rules can't stop a self-assigning member from also
 * rewriting the report copy.
 */
export function useCompanyActions(organizationId?: string, includeDrafts = false) {
  const { user } = useAuth();
  const [actions, setActions] = useState<CompanyAction[]>([]);
  const [assignees, setAssignees] = useState<ActionAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActions = useCallback(async () => {
    if (!organizationId) {
      setActions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Drafts are for platform admins only, so a quarter can be reviewed on the
    // page before anyone at the client sees it. RLS enforces this regardless —
    // is_admin() is the only way past the published_at gate.
    let query = (supabase as any)
      .from('company_actions')
      .select('*')
      .eq('organization_id', organizationId);
    if (!includeDrafts) query = query.not('published_at', 'is', null);

    const { data, error: fetchError } = await query
      .order('overdue_count', { ascending: false })
      .order('created_at', { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
      setActions([]);
    } else {
      setError(null);
      setActions(
        (data ?? []).map((row: any) => ({
          ...row,
          categories: row.categories ?? [],
          moves: row.moves ?? [],
          markets: row.markets ?? [],
          functions: row.functions ?? [],
          ai_reads: parseAiReads(row.ai_reads),
          evidence_filter: row.evidence_filter ?? {},
          steps: parseSteps(row.steps),
          steps_done: Array.isArray(row.steps_done) ? row.steps_done : [],
        })) as CompanyAction[],
      );
    }
    setLoading(false);
  }, [organizationId, includeDrafts]);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  useEffect(() => {
    if (!organizationId) {
      setAssignees([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any).rpc('list_action_assignees', {
        p_organization_id: organizationId,
      });
      if (!cancelled) setAssignees((data ?? []) as ActionAssignee[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  // Both mutations return the updated row, so we patch in place rather than
  // refetching the whole list on every click.
  const applyUpdate = useCallback((updated: CompanyAction) => {
    setActions((prev) =>
      prev.map((a) =>
        a.id === updated.id
          ? {
              ...updated,
              categories: updated.categories ?? [],
              moves: updated.moves ?? [],
              markets: updated.markets ?? [],
              functions: updated.functions ?? [],
              ai_reads: parseAiReads(updated.ai_reads),
              evidence_filter: updated.evidence_filter ?? {},
              steps: parseSteps(updated.steps),
              steps_done: Array.isArray(updated.steps_done) ? updated.steps_done : [],
            }
          : a,
      ),
    );
  }, []);

  const assign = useCallback(
    async (actionId: string, assigneeId: string | null) => {
      const { data, error: rpcError } = await (supabase as any).rpc('assign_company_action', {
        p_action_id: actionId,
        p_assignee_id: assigneeId,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (data) applyUpdate(data as CompanyAction);
    },
    [applyUpdate],
  );

  const setStatus = useCallback(
    async (actionId: string, status: ActionWorkStatus, note?: string, url?: string) => {
      const { data, error: rpcError } = await (supabase as any).rpc('set_company_action_status', {
        p_action_id: actionId,
        p_status: status,
        p_note: note ?? null,
        p_url: url ?? null,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (data) applyUpdate(data as CompanyAction);
    },
    [applyUpdate],
  );

  // Ticking steps is what moves work_status — the RPC derives it, so the row's
  // "2 of 3" / "Done" state always agrees with the checklist.
  const setSteps = useCallback(
    async (actionId: string, doneIndices: number[]) => {
      const { data, error: rpcError } = await (supabase as any).rpc('set_company_action_steps', {
        p_action_id: actionId,
        p_done: doneIndices,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (data) applyUpdate(data as CompanyAction);
    },
    [applyUpdate],
  );

  const assigneeNames = useMemo(() => {
    const map = new Map<string, string>();
    assignees.forEach((a) => map.set(a.user_id, a.full_name || a.email || 'Unknown'));
    return map;
  }, [assignees]);

  const counts = useMemo(() => {
    const open = actions.filter((a) => a.work_status !== 'done');
    return {
      yours: open.filter((a) => a.assignee_id === user?.id).length,
      unassigned: open.filter((a) => a.assignee_id === null).length,
      all: open.length,
      done: actions.filter((a) => a.work_status === 'done').length,
    };
  }, [actions, user?.id]);

  return {
    actions,
    assignees,
    assigneeNames,
    counts,
    loading,
    error,
    assign,
    setStatus,
    setSteps,
    refetch: fetchActions,
  };
}
