import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Play, CheckCircle2, X, Search } from "lucide-react";
import { toast } from "sonner";

type Suggestion = {
  id: string;
  raw_alias: string;
  normalized_alias: string;
  mention_count: number;
  suggested_canonical_name: string | null;
  suggested_entity_type: string | null;
  suggested_is_non_entity: boolean;
  confidence: number | null;
  status: "pending" | "approved" | "rejected" | "merged_into_existing";
  llm_rationale: string | null;
  llm_model: string | null;
  created_at: string;
};

type Canonical = {
  id: string;
  canonical_name: string;
  normalized_name: string;
  entity_type: string | null;
  is_active: boolean;
};

type Alias = {
  id: string;
  canonical_id: string;
  alias: string;
  normalized_alias: string;
  source: string;
  created_at: string;
};

type Section = "pending" | "resolved" | "canonicals" | "aliases";

export const EntityCanonicalizationTab = () => {
  const [section, setSection] = useState<Section>("pending");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [resolved, setResolved] = useState<Suggestion[]>([]);
  const [canonicals, setCanonicals] = useState<Canonical[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningJob, setRunningJob] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const [editing, setEditing] = useState<Suggestion | null>(null);
  const [editCanonical, setEditCanonical] = useState("");
  const [editEntityType, setEditEntityType] = useState("other");

  const [editingCanonical, setEditingCanonical] = useState<Canonical | null>(null);
  const [canonicalForm, setCanonicalForm] = useState<{
    canonical_name: string;
    entity_type: string;
    is_active: boolean;
    merge_into: string;
  }>({ canonical_name: "", entity_type: "other", is_active: true, merge_into: "" });

  const [editingAlias, setEditingAlias] = useState<Alias | null>(null);
  const [aliasForm, setAliasForm] = useState<{ alias: string; canonical_name: string }>({
    alias: "",
    canonical_name: "",
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [pendingFilter, setPendingFilter] = useState<"all" | "real" | "non_entity">("all");
  const [bulkOverrideType, setBulkOverrideType] = useState<string>("");

  const [canonicalFilter, setCanonicalFilter] = useState<"all" | "active" | "non_entity">("all");
  const [selectedCanonicalIds, setSelectedCanonicalIds] = useState<Set<string>>(new Set());
  const [bulkCanonicalType, setBulkCanonicalType] = useState<string>("other");

  // Surface Supabase / Postgrest error objects (which aren't Error instances
  // and stringify to "[object Object]") with the actual message and code so
  // we can debug failed approves / saves without the browser console.
  const fmtError = (e: unknown): string => {
    if (e instanceof Error) return e.message;
    if (e && typeof e === "object") {
      const err = e as { message?: string; details?: string; hint?: string; code?: string };
      const parts: string[] = [];
      if (err.message) parts.push(err.message);
      if (err.details) parts.push(err.details);
      if (err.hint) parts.push(`hint: ${err.hint}`);
      if (err.code) parts.push(`(${err.code})`);
      const joined = parts.filter(Boolean).join(" — ");
      if (joined) return joined;
      try {
        return JSON.stringify(e);
      } catch {
        return String(e);
      }
    }
    return String(e);
  };

  // Scope for the LLM suggestion job. Two-level: pick an organization first;
  // if a specific org is chosen, a second dropdown lets you narrow further to
  // a single company in that org (e.g. "Netflix Japan" within Netflix).
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [companies, setCompanies] = useState<
    Array<{ id: string; name: string; organization_id: string; country: string | null }>
  >([]);
  const [orgScope, setOrgScope] = useState<string>("all");      // "all" | <organization_id>
  const [companyScope, setCompanyScope] = useState<string>("all"); // "all" | <company_id>

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, r, c, a] = await Promise.all([
        supabase
          .from("entity_alias_suggestions")
          .select("*")
          .eq("status", "pending")
          .order("mention_count", { ascending: false })
          .limit(500),
        supabase
          .from("entity_alias_suggestions")
          .select("*")
          .in("status", ["approved", "rejected", "merged_into_existing"])
          .order("resolved_at", { ascending: false })
          .limit(500),
        supabase
          .from("canonical_entities")
          .select("*")
          .order("canonical_name")
          .limit(1000),
        supabase
          .from("entity_aliases")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);
      if (s.error) throw s.error;
      if (r.error) throw r.error;
      if (c.error) throw c.error;
      if (a.error) throw a.error;
      setSuggestions((s.data ?? []) as Suggestion[]);
      setResolved((r.data ?? []) as Suggestion[]);
      setCanonicals((c.data ?? []) as Canonical[]);
      setAliases((a.data ?? []) as Alias[]);
    } catch (e: unknown) {
      toast.error("Failed to load: " + fmtError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  // Fetch organizations + companies for the job-scope dropdowns.
  useEffect(() => {
    (async () => {
      const [orgRes, companyRes] = await Promise.all([
        supabase.from("organizations").select("id, name").order("name"),
        supabase
          .from("organization_companies")
          .select("organization_id, companies!inner(id, name, country)")
          .limit(2000),
      ]);
      if (!orgRes.error) setOrganizations(orgRes.data ?? []);
      if (!companyRes.error && companyRes.data) {
        const flat: Array<{
          id: string;
          name: string;
          organization_id: string;
          country: string | null;
        }> = [];
        for (const row of companyRes.data as Array<{
          organization_id: string;
          companies:
            | { id: string; name: string; country: string | null }
            | { id: string; name: string; country: string | null }[];
        }>) {
          const c = Array.isArray(row.companies) ? row.companies[0] : row.companies;
          if (!c) continue;
          flat.push({
            id: c.id,
            name: c.name,
            organization_id: row.organization_id,
            country: c.country,
          });
        }
        // Stable sort: by name then by country so duplicates group together
        flat.sort((a, b) =>
          a.name.localeCompare(b.name) || (a.country ?? "").localeCompare(b.country ?? "")
        );
        setCompanies(flat);
      }
    })();
  }, []);

  // Companies belonging to the currently selected org (for the secondary dropdown).
  const orgCompanies = useMemo(() => {
    if (orgScope === "all") return [];
    return companies.filter((c) => c.organization_id === orgScope);
  }, [companies, orgScope]);

  const canonicalByName = useMemo(() => {
    const map = new Map<string, Canonical>();
    for (const c of canonicals) map.set(c.canonical_name.toLowerCase(), c);
    return map;
  }, [canonicals]);

  const runSuggestionJob = async () => {
    setRunningJob(true);
    try {
      // companyId wins over organizationId when both are set (and the edge
      // function knows to prefer companyId). When companyScope is "all", we
      // only pass organizationId so the scan covers every company in the org.
      const body: { batchSize: number; organizationId?: string; companyId?: string } = {
        batchSize: 50,
      };
      if (companyScope !== "all") {
        body.companyId = companyScope;
      } else if (orgScope !== "all") {
        body.organizationId = orgScope;
      }
      const { data, error } = await supabase.functions.invoke(
        "suggest-entity-canonicalization",
        { body }
      );
      if (error) throw error;
      toast.success(`Processed ${data?.processed ?? 0} new variants`);
      await loadAll();
    } catch (e: unknown) {
      toast.error("Job failed: " + fmtError(e));
    } finally {
      setRunningJob(false);
    }
  };

  const refreshMv = async () => {
    setRefreshing(true);
    try {
      const { error } = await supabase.rpc("refresh_company_competitors_mv");
      if (error) throw error;
      toast.success("Competitors MV refreshed");
    } catch (e: unknown) {
      toast.error("Refresh failed: " + fmtError(e));
    } finally {
      setRefreshing(false);
    }
  };

  const upsertCanonical = async (
    name: string,
    entityType: string,
    isActive: boolean
  ): Promise<Canonical> => {
    const normalized = normalizeClient(name);
    // Fast path: local state already has it. Cheap, avoids a roundtrip.
    const localHit = canonicals.find((c) => c.normalized_name === normalized);
    if (localHit) return localHit;

    // Authoritative path: check the DB by normalized key. Local state can be
    // stale when a seed migration / another approve / the auto-trigger has
    // created this canonical since the page last loaded.
    const lookup = await supabase
      .from("canonical_entities")
      .select("*")
      .eq("normalized_name", normalized)
      .maybeSingle();
    if (lookup.data) return lookup.data as Canonical;

    const { data, error } = await supabase
      .from("canonical_entities")
      .insert({
        canonical_name: name,
        normalized_name: normalized,
        entity_type: entityType,
        is_active: isActive,
      })
      .select()
      .single();
    if (error) {
      // Race: someone created this canonical between our lookup and insert
      // (the auto-self-alias trigger or a parallel approve). Re-fetch instead
      // of erroring — both unique constraints we care about (normalized_name,
      // canonical_name) point at the same logical row.
      if (typeof error.code === "string" && error.code === "23505") {
        const retry = await supabase
          .from("canonical_entities")
          .select("*")
          .or(`normalized_name.eq.${normalized},canonical_name.eq.${name}`)
          .maybeSingle();
        if (retry.data) return retry.data as Canonical;
      }
      throw error;
    }
    return data as Canonical;
  };

  const approveSuggestion = async (
    s: Suggestion,
    canonicalName: string,
    entityType: string
  ) => {
    try {
      const isNonEntity = entityType === "non_entity";
      const canonical = await upsertCanonical(
        canonicalName,
        entityType,
        !isNonEntity
      );

      // Remove any prior alias for this normalized key so re-edits repoint
      // cleanly (e.g. a mistakenly approved non-entity being remapped).
      await supabase
        .from("entity_aliases")
        .delete()
        .eq("normalized_alias", s.normalized_alias);

      const { error: aliasErr } = await supabase.from("entity_aliases").insert({
        canonical_id: canonical.id,
        alias: s.raw_alias,
        normalized_alias: s.normalized_alias,
        source: "llm_suggested",
        approved_at: new Date().toISOString(),
      });
      if (aliasErr && !aliasErr.message.includes("duplicate")) throw aliasErr;

      const { error: updateErr } = await supabase
        .from("entity_alias_suggestions")
        .update({
          status: "approved",
          resolved_canonical_id: canonical.id,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", s.id);
      if (updateErr) throw updateErr;

      toast.success(`Mapped "${s.raw_alias}" → ${canonicalName}`);
      setEditing(null);
      await loadAll();
    } catch (e: unknown) {
      toast.error("Approve failed: " + fmtError(e));
    }
  };

  const openCanonicalEdit = (c: Canonical) => {
    setEditingCanonical(c);
    setCanonicalForm({
      canonical_name: c.canonical_name,
      entity_type: c.entity_type ?? "other",
      is_active: c.is_active,
      merge_into: "",
    });
  };

  const saveCanonicalEdit = async () => {
    if (!editingCanonical) return;
    const form = canonicalForm;
    try {
      if (form.merge_into.trim()) {
        const target = canonicals.find(
          (c) =>
            c.id !== editingCanonical.id &&
            c.canonical_name.toLowerCase() === form.merge_into.trim().toLowerCase()
        );
        if (!target) {
          toast.error("Merge target not found");
          return;
        }
        const { error: aliasErr } = await supabase
          .from("entity_aliases")
          .update({ canonical_id: target.id })
          .eq("canonical_id", editingCanonical.id);
        if (aliasErr) throw aliasErr;

        const { error: suggErr } = await supabase
          .from("entity_alias_suggestions")
          .update({ resolved_canonical_id: target.id })
          .eq("resolved_canonical_id", editingCanonical.id);
        if (suggErr) throw suggErr;

        const { error: delErr } = await supabase
          .from("canonical_entities")
          .delete()
          .eq("id", editingCanonical.id);
        if (delErr) throw delErr;

        toast.success(
          `Merged "${editingCanonical.canonical_name}" into "${target.canonical_name}"`
        );
      } else {
        const normalized = normalizeClient(form.canonical_name);
        if (!normalized) {
          toast.error("Canonical name cannot be empty");
          return;
        }
        const isNonEntity = form.entity_type === "non_entity";
        const { error } = await supabase
          .from("canonical_entities")
          .update({
            canonical_name: form.canonical_name.trim(),
            normalized_name: normalized,
            entity_type: form.entity_type,
            is_active: isNonEntity ? false : form.is_active,
          })
          .eq("id", editingCanonical.id);
        if (error) throw error;
        toast.success("Canonical updated");
      }
      setEditingCanonical(null);
      await loadAll();
    } catch (e: unknown) {
      toast.error("Save failed: " + fmtError(e));
    }
  };

  const bulkUpdateCanonicalType = async () => {
    const ids = Array.from(selectedCanonicalIds);
    if (ids.length === 0) {
      toast.info("No canonicals selected");
      return;
    }
    const isNonEntity = bulkCanonicalType === "non_entity";
    if (
      !confirm(
        `Reclassify ${ids.length} canonical(s) as "${bulkCanonicalType}"${
          isNonEntity ? " (hide from SOV)" : " and mark active"
        }?`
      )
    )
      return;
    try {
      const { error } = await supabase
        .from("canonical_entities")
        .update({
          entity_type: bulkCanonicalType,
          is_active: !isNonEntity,
        })
        .in("id", ids);
      if (error) throw error;
      toast.success(`Updated ${ids.length} canonical(s)`);
      setSelectedCanonicalIds(new Set());
      await loadAll();
    } catch (e: unknown) {
      toast.error("Bulk update failed: " + fmtError(e));
    }
  };

  const bulkDeleteCanonicals = async () => {
    const ids = Array.from(selectedCanonicalIds);
    if (ids.length === 0) {
      toast.info("No canonicals selected");
      return;
    }
    if (
      !confirm(
        `Delete ${ids.length} canonical(s)? Their aliases will be removed and those variants will revert to ungrouped.`
      )
    )
      return;
    try {
      const { error } = await supabase
        .from("canonical_entities")
        .delete()
        .in("id", ids);
      if (error) throw error;
      toast.success(`Deleted ${ids.length} canonical(s)`);
      setSelectedCanonicalIds(new Set());
      await loadAll();
    } catch (e: unknown) {
      toast.error("Bulk delete failed: " + fmtError(e));
    }
  };

  const deleteCanonical = async (c: Canonical) => {
    if (
      !confirm(
        `Delete canonical "${c.canonical_name}"? All ${
          aliases.filter((a) => a.canonical_id === c.id).length
        } alias(es) pointing to it will be removed and those variants will revert to ungrouped.`
      )
    )
      return;
    try {
      const { error } = await supabase
        .from("canonical_entities")
        .delete()
        .eq("id", c.id);
      if (error) throw error;
      toast.success("Canonical deleted");
      await loadAll();
    } catch (e: unknown) {
      toast.error("Delete failed: " + fmtError(e));
    }
  };

  const openAliasEdit = (a: Alias) => {
    const canonical = canonicals.find((c) => c.id === a.canonical_id);
    setEditingAlias(a);
    setAliasForm({
      alias: a.alias,
      canonical_name: canonical?.canonical_name ?? "",
    });
  };

  const saveAliasEdit = async () => {
    if (!editingAlias) return;
    try {
      const target = canonicals.find(
        (c) =>
          c.canonical_name.toLowerCase() === aliasForm.canonical_name.trim().toLowerCase()
      );
      if (!target) {
        toast.error("Target canonical not found — pick an existing one");
        return;
      }
      const newAliasText = aliasForm.alias.trim();
      if (!newAliasText) {
        toast.error("Alias text cannot be empty");
        return;
      }
      const newNormalized = normalizeClient(newAliasText);
      if (newNormalized !== editingAlias.normalized_alias) {
        const clash = aliases.find(
          (a) => a.normalized_alias === newNormalized && a.id !== editingAlias.id
        );
        if (clash) {
          toast.error("Another alias already uses this normalized key");
          return;
        }
      }
      const { error } = await supabase
        .from("entity_aliases")
        .update({
          alias: newAliasText,
          normalized_alias: newNormalized,
          canonical_id: target.id,
        })
        .eq("id", editingAlias.id);
      if (error) throw error;
      toast.success("Alias updated");
      setEditingAlias(null);
      await loadAll();
    } catch (e: unknown) {
      toast.error("Save failed: " + fmtError(e));
    }
  };

  const deleteAlias = async (a: Alias) => {
    if (!confirm(`Delete alias "${a.alias}"? The variant will revert to ungrouped.`))
      return;
    try {
      const { error } = await supabase
        .from("entity_aliases")
        .delete()
        .eq("id", a.id);
      if (error) throw error;
      // Also reopen any suggestion that resolved into this alias so the variant
      // returns to the pending queue rather than disappearing.
      await supabase
        .from("entity_alias_suggestions")
        .update({
          status: "pending",
          resolved_canonical_id: null,
          resolved_at: null,
          resolved_by: null,
        })
        .eq("normalized_alias", a.normalized_alias);
      toast.success("Alias deleted");
      await loadAll();
    } catch (e: unknown) {
      toast.error("Delete failed: " + fmtError(e));
    }
  };

  const reopenSuggestion = async (s: Suggestion) => {
    try {
      // Drop any alias row this approval created so the mapping fully reverts.
      const { error: aliasErr } = await supabase
        .from("entity_aliases")
        .delete()
        .eq("normalized_alias", s.normalized_alias);
      if (aliasErr) throw aliasErr;

      const { error: updateErr } = await supabase
        .from("entity_alias_suggestions")
        .update({
          status: "pending",
          resolved_canonical_id: null,
          resolved_at: null,
          resolved_by: null,
        })
        .eq("id", s.id);
      if (updateErr) throw updateErr;

      toast.success(`Reopened "${s.raw_alias}"`);
      await loadAll();
    } catch (e: unknown) {
      toast.error("Reopen failed: " + fmtError(e));
    }
  };

  const rejectSuggestion = async (s: Suggestion) => {
    try {
      const { error } = await supabase
        .from("entity_alias_suggestions")
        .update({ status: "rejected", resolved_at: new Date().toISOString() })
        .eq("id", s.id);
      if (error) throw error;
      toast.success("Rejected");
      await loadAll();
    } catch (e: unknown) {
      toast.error("Reject failed: " + fmtError(e));
    }
  };

  const approveSelected = async () => {
    const targets = suggestions.filter((s) => selectedIds.has(s.id));
    if (targets.length === 0) {
      toast.info("Nothing selected");
      return;
    }
    if (!confirm(`Approve ${targets.length} selected suggestion(s) using the LLM mapping?`))
      return;
    setBulkRunning(true);
    try {
      for (const s of targets) {
        const fallbackType = s.suggested_entity_type ?? (s.suggested_is_non_entity ? "non_entity" : "other");
        // If the admin picked an override type, use it for everyone in the batch
        // (so e.g. mass-flipping mis-tagged "non_entity" rows to "other" works in one click).
        const effectiveType = bulkOverrideType ? bulkOverrideType : fallbackType;
        // When the override forces a real type, fall back to the raw alias as the
        // canonical name since the LLM left suggested_canonical_name null for
        // non-entities.
        const canonicalName = s.suggested_canonical_name ?? s.raw_alias;
        await approveSuggestion(s, canonicalName, effectiveType);
      }
      setSelectedIds(new Set());
    } finally {
      setBulkRunning(false);
    }
  };

  const rejectSelected = async () => {
    const targets = suggestions.filter((s) => selectedIds.has(s.id));
    if (targets.length === 0) {
      toast.info("Nothing selected");
      return;
    }
    if (!confirm(`Reject ${targets.length} selected suggestion(s)?`)) return;
    setBulkRunning(true);
    try {
      const ids = targets.map((t) => t.id);
      const { error } = await supabase
        .from("entity_alias_suggestions")
        .update({ status: "rejected", resolved_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
      toast.success(`Rejected ${ids.length}`);
      setSelectedIds(new Set());
      await loadAll();
    } catch (e: unknown) {
      toast.error("Reject failed: " + fmtError(e));
    } finally {
      setBulkRunning(false);
    }
  };

  const bulkApproveHighConfidence = async () => {
    const eligible = suggestions.filter(
      (s) =>
        s.status === "pending" &&
        (s.confidence ?? 0) >= 0.95 &&
        s.suggested_canonical_name &&
        !s.suggested_is_non_entity &&
        canonicalByName.has(s.suggested_canonical_name.toLowerCase())
    );
    if (eligible.length === 0) {
      toast.info("No high-confidence suggestions matching existing canonicals");
      return;
    }
    if (!confirm(`Approve ${eligible.length} high-confidence suggestion(s)?`)) return;

    for (const s of eligible) {
      await approveSuggestion(
        s,
        s.suggested_canonical_name!,
        s.suggested_entity_type ?? "other"
      );
    }
  };

  const filteredSuggestions = useMemo(() => {
    let rows = suggestions;
    if (pendingFilter === "real") {
      rows = rows.filter((s) => !s.suggested_is_non_entity);
    } else if (pendingFilter === "non_entity") {
      rows = rows.filter((s) => s.suggested_is_non_entity);
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (s) =>
          s.raw_alias.toLowerCase().includes(q) ||
          (s.suggested_canonical_name ?? "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [suggestions, search, pendingFilter]);

  const filteredResolved = useMemo(() => {
    if (!search) return resolved;
    const q = search.toLowerCase();
    return resolved.filter(
      (s) =>
        s.raw_alias.toLowerCase().includes(q) ||
        (s.suggested_canonical_name ?? "").toLowerCase().includes(q)
    );
  }, [resolved, search]);

  const filteredCanonicals = useMemo(() => {
    let rows = canonicals;
    if (canonicalFilter === "active") {
      rows = rows.filter((c) => c.is_active && c.entity_type !== "non_entity");
    } else if (canonicalFilter === "non_entity") {
      rows = rows.filter((c) => !c.is_active || c.entity_type === "non_entity");
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((c) => c.canonical_name.toLowerCase().includes(q));
    }
    return rows;
  }, [canonicals, search, canonicalFilter]);

  const aliasCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of aliases) m.set(a.canonical_id, (m.get(a.canonical_id) ?? 0) + 1);
    return m;
  }, [aliases]);

  const filteredAliases = useMemo(() => {
    if (!search) return aliases;
    const q = search.toLowerCase();
    return aliases.filter((a) => a.alias.toLowerCase().includes(q));
  }, [aliases, search]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Data Cleanup</CardTitle>
            <CardDescription>
              Merge competitor and source variants (Glassdoor.com / Glassdoor.ie, Disney / Disney+ Hotstar) into single canonical entries.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={orgScope}
              onValueChange={(v) => {
                setOrgScope(v);
                setCompanyScope("all"); // reset company when org changes
              }}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Organization" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All organizations</SelectItem>
                {organizations.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {orgScope !== "all" && (
              <Select value={companyScope} onValueChange={setCompanyScope}>
                <SelectTrigger className="w-60">
                  <SelectValue placeholder="Company" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    All companies in this org ({orgCompanies.length})
                  </SelectItem>
                  {orgCompanies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.country ? ` · ${c.country}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={runSuggestionJob}
              disabled={runningJob}
              title={
                companyScope !== "all"
                  ? "Scan unmapped variants only for the selected company"
                  : orgScope !== "all"
                    ? "Scan unmapped variants across every company in the selected org"
                    : "Scan unmapped variants across every company in every org"
              }
            >
              {runningJob ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run LLM suggestion job
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshMv}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh competitors MV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            <Button
              variant={section === "pending" ? "default" : "outline"}
              size="sm"
              onClick={() => setSection("pending")}
            >
              Pending ({suggestions.length})
            </Button>
            <Button
              variant={section === "resolved" ? "default" : "outline"}
              size="sm"
              onClick={() => setSection("resolved")}
            >
              Resolved ({resolved.length})
            </Button>
            <Button
              variant={section === "canonicals" ? "default" : "outline"}
              size="sm"
              onClick={() => setSection("canonicals")}
            >
              Canonicals ({canonicals.length})
            </Button>
            <Button
              variant={section === "aliases" ? "default" : "outline"}
              size="sm"
              onClick={() => setSection("aliases")}
            >
              Aliases ({aliases.length})
            </Button>
            <div className="ml-auto relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-slate-400" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-64"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : section === "pending" ? (
            <PendingTable
              rows={filteredSuggestions}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              bulkRunning={bulkRunning}
              filter={pendingFilter}
              setFilter={setPendingFilter}
              overrideType={bulkOverrideType}
              setOverrideType={setBulkOverrideType}
              onApprove={(s) =>
                approveSuggestion(
                  s,
                  s.suggested_canonical_name ?? s.raw_alias,
                  s.suggested_entity_type ?? "other"
                )
              }
              onEdit={(s) => {
                setEditing(s);
                setEditCanonical(s.suggested_canonical_name ?? s.raw_alias);
                setEditEntityType(s.suggested_entity_type ?? "other");
              }}
              onReject={rejectSuggestion}
              onBulkApprove={bulkApproveHighConfidence}
              onApproveSelected={approveSelected}
              onRejectSelected={rejectSelected}
            />
          ) : section === "resolved" ? (
            <ResolvedTable
              rows={filteredResolved}
              canonicals={canonicals}
              onReopen={reopenSuggestion}
              onEdit={(s) => {
                setEditing(s);
                setEditCanonical(s.suggested_canonical_name ?? s.raw_alias);
                setEditEntityType(s.suggested_entity_type ?? "other");
              }}
            />
          ) : section === "canonicals" ? (
            <CanonicalsTable
              rows={filteredCanonicals}
              aliasCounts={aliasCounts}
              filter={canonicalFilter}
              setFilter={setCanonicalFilter}
              selectedIds={selectedCanonicalIds}
              setSelectedIds={setSelectedCanonicalIds}
              bulkType={bulkCanonicalType}
              setBulkType={setBulkCanonicalType}
              onBulkUpdate={bulkUpdateCanonicalType}
              onBulkDelete={bulkDeleteCanonicals}
              onEdit={openCanonicalEdit}
              onDelete={deleteCanonical}
            />
          ) : (
            <AliasesTable
              rows={filteredAliases}
              canonicals={canonicals}
              onEdit={openAliasEdit}
              onDelete={deleteAlias}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit suggestion</DialogTitle>
            <DialogDescription>
              Raw alias: <code className="text-xs">{editing?.raw_alias}</code>
              <br />
              Mentions: {editing?.mention_count}
              {editing?.llm_rationale && (
                <>
                  <br />
                  <span className="text-xs italic">
                    LLM: {editing.llm_rationale}
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">
                Canonical name (existing or new)
              </label>
              <Input
                list="canonical-options"
                value={editCanonical}
                onChange={(e) => setEditCanonical(e.target.value)}
              />
              <datalist id="canonical-options">
                {canonicals.map((c) => (
                  <option key={c.id} value={c.canonical_name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Entity type</label>
              <Select value={editEntityType} onValueChange={setEditEntityType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oem">OEM</SelectItem>
                  <SelectItem value="supplier">Supplier</SelectItem>
                  <SelectItem value="it_services">IT services</SelectItem>
                  <SelectItem value="consulting">Consulting</SelectItem>
                  <SelectItem value="financial">Financial</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                  <SelectItem value="non_entity">Non-entity (drop from SOV)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                editing && approveSuggestion(editing, editCanonical, editEntityType)
              }
              disabled={!editCanonical.trim()}
            >
              Approve mapping
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingCanonical}
        onOpenChange={(open) => !open && setEditingCanonical(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit canonical entity</DialogTitle>
            <DialogDescription>
              {editingCanonical && (
                <>
                  Currently {aliasCounts.get(editingCanonical.id) ?? 0} alias
                  {(aliasCounts.get(editingCanonical.id) ?? 0) === 1 ? "" : "es"}{" "}
                  map to this canonical.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Canonical name</label>
              <Input
                value={canonicalForm.canonical_name}
                onChange={(e) =>
                  setCanonicalForm((f) => ({ ...f, canonical_name: e.target.value }))
                }
                disabled={!!canonicalForm.merge_into}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Entity type</label>
              <Select
                value={canonicalForm.entity_type}
                onValueChange={(v) =>
                  setCanonicalForm((f) => ({ ...f, entity_type: v }))
                }
                disabled={!!canonicalForm.merge_into}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oem">OEM</SelectItem>
                  <SelectItem value="supplier">Supplier</SelectItem>
                  <SelectItem value="it_services">IT services</SelectItem>
                  <SelectItem value="consulting">Consulting</SelectItem>
                  <SelectItem value="financial">Financial</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                  <SelectItem value="non_entity">Non-entity (drop from SOV)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="canonical-is-active"
                type="checkbox"
                checked={canonicalForm.is_active}
                disabled={
                  canonicalForm.entity_type === "non_entity" ||
                  !!canonicalForm.merge_into
                }
                onChange={(e) =>
                  setCanonicalForm((f) => ({ ...f, is_active: e.target.checked }))
                }
              />
              <label htmlFor="canonical-is-active" className="text-sm">
                Active (shown in SOV)
              </label>
            </div>
            <div className="pt-3 border-t">
              <label className="text-sm font-medium mb-1 block">
                Or: merge into another canonical
              </label>
              <Input
                list="merge-canonical-options"
                placeholder="Type another canonical name to redirect all aliases there"
                value={canonicalForm.merge_into}
                onChange={(e) =>
                  setCanonicalForm((f) => ({ ...f, merge_into: e.target.value }))
                }
              />
              <datalist id="merge-canonical-options">
                {canonicals
                  .filter((c) => c.id !== editingCanonical?.id)
                  .map((c) => (
                    <option key={c.id} value={c.canonical_name} />
                  ))}
              </datalist>
              <p className="text-xs text-slate-500 mt-1">
                Merging deletes this canonical and re-points its aliases to the
                target. Use when two canonicals describe the same entity.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCanonical(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveCanonicalEdit}
              disabled={
                !canonicalForm.merge_into && !canonicalForm.canonical_name.trim()
              }
            >
              {canonicalForm.merge_into ? "Merge" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingAlias}
        onOpenChange={(open) => !open && setEditingAlias(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit alias</DialogTitle>
            <DialogDescription>
              Change the alias text or repoint it to a different canonical.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Alias text</label>
              <Input
                value={aliasForm.alias}
                onChange={(e) =>
                  setAliasForm((f) => ({ ...f, alias: e.target.value }))
                }
              />
              <p className="text-xs text-slate-500 mt-1">
                Normalized to:{" "}
                <code>{normalizeClient(aliasForm.alias) || "(empty)"}</code>
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Maps to canonical
              </label>
              <Input
                list="alias-canonical-options"
                value={aliasForm.canonical_name}
                onChange={(e) =>
                  setAliasForm((f) => ({ ...f, canonical_name: e.target.value }))
                }
              />
              <datalist id="alias-canonical-options">
                {canonicals.map((c) => (
                  <option key={c.id} value={c.canonical_name} />
                ))}
              </datalist>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAlias(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveAliasEdit}
              disabled={!aliasForm.alias.trim() || !aliasForm.canonical_name.trim()}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const PendingTable = ({
  rows,
  selectedIds,
  setSelectedIds,
  bulkRunning,
  filter,
  setFilter,
  overrideType,
  setOverrideType,
  onApprove,
  onEdit,
  onReject,
  onBulkApprove,
  onApproveSelected,
  onRejectSelected,
}: {
  rows: Suggestion[];
  selectedIds: Set<string>;
  setSelectedIds: (s: Set<string>) => void;
  bulkRunning: boolean;
  filter: "all" | "real" | "non_entity";
  setFilter: (f: "all" | "real" | "non_entity") => void;
  overrideType: string;
  setOverrideType: (t: string) => void;
  onApprove: (s: Suggestion) => void;
  onEdit: (s: Suggestion) => void;
  onReject: (s: Suggestion) => void;
  onBulkApprove: () => void;
  onApproveSelected: () => void;
  onRejectSelected: () => void;
}) => {
  const allChecked = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someChecked = !allChecked && rows.some((r) => selectedIds.has(r.id));
  const toggleAll = () => {
    if (allChecked) {
      const next = new Set(selectedIds);
      for (const r of rows) next.delete(r.id);
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      for (const r of rows) next.add(r.id);
      setSelectedIds(next);
    }
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };
  const selectedCount = rows.filter((r) => selectedIds.has(r.id)).length;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Button
          variant={filter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("all")}
        >
          All
        </Button>
        <Button
          variant={filter === "real" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("real")}
        >
          Real entities
        </Button>
        <Button
          variant={filter === "non_entity" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("non_entity")}
        >
          Non-entity
        </Button>

        {selectedCount > 0 && (
          <span className="text-sm text-slate-500 ml-2">{selectedCount} selected</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Select
            value={overrideType || "__use_llm__"}
            onValueChange={(v) => {
              setOverrideType(v === "__use_llm__" ? "" : v);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__use_llm__">Use LLM suggestion</SelectItem>
              <SelectItem value="oem">Force: OEM</SelectItem>
              <SelectItem value="supplier">Force: Supplier</SelectItem>
              <SelectItem value="it_services">Force: IT services</SelectItem>
              <SelectItem value="consulting">Force: Consulting</SelectItem>
              <SelectItem value="financial">Force: Financial</SelectItem>
              <SelectItem value="other">Force: Other</SelectItem>
              <SelectItem value="non_entity">Force: Non-entity (hide)</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={onApproveSelected}
            disabled={selectedCount === 0 || bulkRunning}
          >
            {bulkRunning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            Approve selected
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRejectSelected}
            disabled={selectedCount === 0 || bulkRunning}
          >
            <X className="h-4 w-4 mr-2" />
            Reject selected
          </Button>
          <Button variant="outline" size="sm" onClick={onBulkApprove}>
            Bulk-approve high-confidence
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-8 text-sm text-slate-500">
          No pending suggestions match this filter.
        </div>
      ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = someChecked;
                }}
                onChange={toggleAll}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead>Raw alias</TableHead>
            <TableHead>LLM suggestion</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Mentions</TableHead>
            <TableHead className="text-right">Conf.</TableHead>
            <TableHead>Rationale</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="w-8">
                <input
                  type="checkbox"
                  checked={selectedIds.has(s.id)}
                  onChange={() => toggleOne(s.id)}
                  aria-label={`Select ${s.raw_alias}`}
                />
              </TableCell>
              <TableCell className="font-mono text-xs">{s.raw_alias}</TableCell>
              <TableCell>
                {s.suggested_is_non_entity ? (
                  <Badge variant="destructive">Non-entity</Badge>
                ) : (
                  s.suggested_canonical_name ?? <span className="text-slate-400">—</span>
                )}
              </TableCell>
              <TableCell>
                <span className="text-xs text-slate-500">
                  {s.suggested_entity_type ?? "—"}
                </span>
              </TableCell>
              <TableCell className="text-right">{s.mention_count}</TableCell>
              <TableCell className="text-right">
                {s.confidence !== null ? s.confidence.toFixed(2) : "—"}
              </TableCell>
              <TableCell className="text-xs text-slate-500 max-w-[280px] truncate">
                {s.llm_rationale ?? ""}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onApprove(s)}
                  className="mr-1"
                  title="Approve as-is"
                >
                  <CheckCircle2 className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEdit(s)}
                  className="mr-1"
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onReject(s)}
                  title="Reject"
                >
                  <X className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      )}
    </div>
  );
};

const ResolvedTable = ({
  rows,
  canonicals,
  onReopen,
  onEdit,
}: {
  rows: Suggestion[];
  canonicals: Canonical[];
  onReopen: (s: Suggestion) => void;
  onEdit: (s: Suggestion) => void;
}) => {
  const canonicalById = useMemo(() => {
    const m = new Map<string, Canonical>();
    for (const c of canonicals) m.set(c.id, c);
    return m;
  }, [canonicals]);

  if (rows.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-slate-500">
        No resolved suggestions yet. Approved or rejected items show up here.
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Raw alias</TableHead>
          <TableHead>Resolved to</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Mentions</TableHead>
          <TableHead>Resolved at</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => {
          const resolvedCanonical = s.resolved_canonical_id
            ? canonicalById.get(s.resolved_canonical_id)
            : null;
          const isNonEntity =
            resolvedCanonical?.is_active === false || s.suggested_is_non_entity;
          return (
            <TableRow key={s.id}>
              <TableCell className="font-mono text-xs">{s.raw_alias}</TableCell>
              <TableCell>
                {resolvedCanonical ? (
                  <>
                    {resolvedCanonical.canonical_name}
                    {isNonEntity && (
                      <Badge variant="destructive" className="ml-2">
                        Non-entity
                      </Badge>
                    )}
                  </>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </TableCell>
              <TableCell>
                <Badge
                  variant={s.status === "approved" ? "secondary" : "outline"}
                >
                  {s.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">{s.mention_count}</TableCell>
              <TableCell className="text-xs text-slate-500">
                {s.resolved_at
                  ? new Date(s.resolved_at).toLocaleString()
                  : "—"}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEdit(s)}
                  className="mr-1"
                  title="Re-edit mapping"
                >
                  Re-edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onReopen(s)}
                  title="Move back to pending"
                >
                  Reopen
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

const CanonicalsTable = ({
  rows,
  aliasCounts,
  filter,
  setFilter,
  selectedIds,
  setSelectedIds,
  bulkType,
  setBulkType,
  onBulkUpdate,
  onBulkDelete,
  onEdit,
  onDelete,
}: {
  rows: Canonical[];
  aliasCounts: Map<string, number>;
  filter: "all" | "active" | "non_entity";
  setFilter: (f: "all" | "active" | "non_entity") => void;
  selectedIds: Set<string>;
  setSelectedIds: (s: Set<string>) => void;
  bulkType: string;
  setBulkType: (t: string) => void;
  onBulkUpdate: () => void;
  onBulkDelete: () => void;
  onEdit: (c: Canonical) => void;
  onDelete: (c: Canonical) => void;
}) => {
  const allChecked = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someChecked = !allChecked && rows.some((r) => selectedIds.has(r.id));
  const toggleAll = () => {
    if (allChecked) {
      const next = new Set(selectedIds);
      for (const r of rows) next.delete(r.id);
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      for (const r of rows) next.add(r.id);
      setSelectedIds(next);
    }
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };
  const selectedCount = rows.filter((r) => selectedIds.has(r.id)).length;

  return (
    <>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Button
          variant={filter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("all")}
        >
          All
        </Button>
        <Button
          variant={filter === "active" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("active")}
        >
          Active
        </Button>
        <Button
          variant={filter === "non_entity" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("non_entity")}
        >
          Non-entity / hidden
        </Button>

        <div className="ml-auto flex items-center gap-2">
          {selectedCount > 0 && (
            <span className="text-sm text-slate-500">{selectedCount} selected</span>
          )}
          <Select value={bulkType} onValueChange={setBulkType}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="oem">OEM</SelectItem>
              <SelectItem value="supplier">Supplier</SelectItem>
              <SelectItem value="it_services">IT services</SelectItem>
              <SelectItem value="consulting">Consulting</SelectItem>
              <SelectItem value="financial">Financial</SelectItem>
              <SelectItem value="other">Other</SelectItem>
              <SelectItem value="non_entity">Non-entity (hide)</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={onBulkUpdate}
            disabled={selectedCount === 0}
          >
            Apply type to selected
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onBulkDelete}
            disabled={selectedCount === 0}
            title="Delete selected canonicals"
          >
            Delete selected
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-8 text-sm text-slate-500">No matches.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked;
                  }}
                  onChange={toggleAll}
                  aria-label="Select all canonicals"
                />
              </TableHead>
              <TableHead>Canonical name</TableHead>
              <TableHead>Normalized</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Aliases</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="w-8">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onChange={() => toggleOne(c.id)}
                    aria-label={`Select ${c.canonical_name}`}
                  />
                </TableCell>
                <TableCell>{c.canonical_name}</TableCell>
                <TableCell className="font-mono text-xs text-slate-500">
                  {c.normalized_name}
                </TableCell>
                <TableCell>{c.entity_type ?? "—"}</TableCell>
                <TableCell>
                  {c.is_active ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="destructive">Hidden</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">{aliasCounts.get(c.id) ?? 0}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onEdit(c)}
                    className="mr-1"
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDelete(c)}
                    title="Delete canonical and its aliases"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
};

const AliasesTable = ({
  rows,
  canonicals,
  onEdit,
  onDelete,
}: {
  rows: Alias[];
  canonicals: Canonical[];
  onEdit: (a: Alias) => void;
  onDelete: (a: Alias) => void;
}) => {
  const byId = useMemo(() => {
    const m = new Map<string, Canonical>();
    for (const c of canonicals) m.set(c.id, c);
    return m;
  }, [canonicals]);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Alias</TableHead>
          <TableHead>Maps to canonical</TableHead>
          <TableHead>Source</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((a) => (
          <TableRow key={a.id}>
            <TableCell className="font-mono text-xs">{a.alias}</TableCell>
            <TableCell>{byId.get(a.canonical_id)?.canonical_name ?? "—"}</TableCell>
            <TableCell>
              <span className="text-xs text-slate-500">{a.source}</span>
            </TableCell>
            <TableCell className="text-right whitespace-nowrap">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit(a)}
                className="mr-1"
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onDelete(a)}
                title="Delete alias"
              >
                <X className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

// Mirror of the SQL public.normalize_entity_name() — used to compute the
// normalized_name when inserting new canonical entities from the admin UI.
const normalizeClient = (input: string): string => {
  return input
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^[\s\p{P}"]+|[\s\p{P}"]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
};
