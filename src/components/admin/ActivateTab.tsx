// Admin surface for Activate (link router) — spec: docs/ACTIVATE_LINK_ROUTER.md
//  - consent gate: links are not mintable until client consent is recorded here
//  - mint tokenized links (label + audience + optional prefills)
//  - per-link funnel (declaration is the top; opens are bot-soft) with the
//    k-anonymity floor enforced server-side — below 5 declared sessions the
//    breakdowns arrive suppressed
//  - read-only routes overview; route curation stays manual (SQL), on purpose

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Check, Copy, Link2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import {
  ActivateAdminRoute,
  ActivateAudience,
  ActivateBrandingRow,
  ActivateLink,
  ActivateLinkStats,
  ActivateOrgSettings,
  activateLinkFor,
  confirmActivateConsent,
  countryName,
  createActivateLink,
  getActivateBranding,
  getActivateLinkStats,
  getActivateOrgSettings,
  listActivateLinks,
  listActivateRoutes,
  revokeActivateLink,
  saveActivateBranding,
} from '@/lib/activate/api';

interface OrgOption {
  id: string;
  name: string;
}

interface EntityOption {
  id: string;
  name: string;
}

const AUDIENCES: ActivateAudience[] = ['employee', 'candidate', 'alumni'];

export const ActivateTab = () => {
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState<string>('');
  const [settings, setSettings] = useState<ActivateOrgSettings | null>(null);
  const [branding, setBranding] = useState<ActivateBrandingRow | null>(null);
  const [links, setLinks] = useState<ActivateLink[]>([]);
  const [stats, setStats] = useState<Record<string, ActivateLinkStats>>({});
  const [routes, setRoutes] = useState<ActivateAdminRoute[]>([]);
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('organizations').select('id, name').order('name');
      setOrgs(data ?? []);
      if (data?.length === 1) setOrgId(data[0].id);
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [orgSettings, orgBranding, orgLinks, orgStats, orgRoutes, entityRows] =
        await Promise.all([
          getActivateOrgSettings(orgId),
          getActivateBranding(orgId),
          listActivateLinks(orgId),
          getActivateLinkStats(orgId),
          listActivateRoutes(orgId),
          supabase
            .from('organization_companies')
            .select('companies(id, name)')
            .eq('organization_id', orgId),
        ]);
      setSettings(orgSettings);
      setBranding(orgBranding);
      setLinks(orgLinks);
      setStats(Object.fromEntries(orgStats.map((s) => [s.link_id, s])));
      setRoutes(orgRoutes);
      setEntities(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((entityRows.data ?? []) as any[])
          .map((r) => r.companies)
          .filter(Boolean)
          .sort((a: EntityOption, b: EntityOption) => a.name.localeCompare(b.name)),
      );
    } catch (e) {
      toast.error('Could not load Activate data');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const consented = Boolean(settings?.consent_confirmed_at);
  const entityName = useMemo(
    () => Object.fromEntries(entities.map((e) => [e.id, e.name])),
    [entities],
  );

  const copyLink = async (link: ActivateLink) => {
    await navigator.clipboard.writeText(activateLinkFor(link.token));
    toast.success('Activate link copied');
  };

  const revoke = async (link: ActivateLink) => {
    try {
      await revokeActivateLink(link.id);
      toast.success(`"${link.label}" revoked — the page now shows a friendly dead-end`);
      refresh();
    } catch {
      toast.error('Could not revoke the link');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Activate</h2>
          <p className="text-sm text-muted-foreground">
            Shareable links that route employees and candidates to the platforms feeding AI
            answers in their market. Send to whole cohorts — hand-picked recipients bias the
            corpus we measure.
          </p>
        </div>
        <Select value={orgId} onValueChange={setOrgId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select organization" />
          </SelectTrigger>
          <SelectContent>
            {orgs.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!orgId ? (
        <p className="text-sm text-muted-foreground">Pick an organization to get started.</p>
      ) : (
        <>
          {/* Consent gate */}
          <div
            className={`rounded-lg border p-4 flex items-start justify-between gap-4 ${
              consented ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'
            }`}
          >
            <div className="flex items-start gap-3">
              <ShieldCheck
                className={`h-5 w-5 mt-0.5 ${consented ? 'text-emerald-600' : 'text-amber-600'}`}
              />
              <div>
                <p className="text-sm font-medium">
                  {consented
                    ? `Client consent recorded ${new Date(settings!.consent_confirmed_at!).toLocaleDateString()}`
                    : 'Client consent not recorded — links cannot be created yet'}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {settings?.consent_note ??
                    'Activate reaches the client’s employees directly. Record consent once the client has explicitly agreed.'}
                </p>
              </div>
            </div>
            {!consented && (
              <Button size="sm" variant="outline" onClick={() => setConsentOpen(true)}>
                Record consent
              </Button>
            )}
          </div>

          {/* Branding */}
          <BrandingCard
            orgId={orgId}
            orgName={orgs.find((o) => o.id === orgId)?.name ?? ''}
            branding={branding}
            onSaved={refresh}
          />

          {/* Links */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Links</h3>
              <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!consented}>
                <Link2 className="h-4 w-4 mr-1.5" />
                New link
              </Button>
            </div>
            {loading && links.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : links.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No links yet{consented ? '' : ' — record consent first'}.
              </p>
            ) : (
              <div className="rounded-lg border divide-y">
                {links.map((link) => (
                  <LinkRow
                    key={link.id}
                    link={link}
                    stats={stats[link.id]}
                    entityName={entityName}
                    onCopy={() => copyLink(link)}
                    onRevoke={() => revoke(link)}
                  />
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Funnel starts at declarations — opens include email-scanner bots. Below 5 declared
              sessions a link shows totals only (k-anonymity floor, enforced server-side).
            </p>
          </div>

          {/* Routes overview */}
          <RoutesOverview routes={routes} entityName={entityName} />
        </>
      )}

      <ConsentDialog
        open={consentOpen}
        onOpenChange={setConsentOpen}
        orgName={orgs.find((o) => o.id === orgId)?.name ?? ''}
        onConfirm={async (note) => {
          try {
            await confirmActivateConsent(orgId, note);
            toast.success('Consent recorded — links can now be created');
            setConsentOpen(false);
            refresh();
          } catch {
            toast.error('Could not record consent');
          }
        }}
      />

      <CreateLinkDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        orgId={orgId}
        entities={entities}
        markets={[...new Set(routes.filter((r) => r.market_code).map((r) => r.market_code!))]}
        onCreated={(link) => {
          setCreateOpen(false);
          refresh();
          navigator.clipboard.writeText(activateLinkFor(link.token)).then(
            () => toast.success('Link created and copied to clipboard'),
            () => toast.success('Link created'),
          );
        }}
      />
    </div>
  );
};

/**
 * Per-client look of the recipient page. The whole page derives from the two
 * color tokens + the logo domain, so this is the entire design surface —
 * changes are live on every open link as soon as they're saved.
 */
function BrandingCard({
  orgId,
  orgName,
  branding,
  onSaved,
}: {
  orgId: string;
  orgName: string;
  branding: ActivateBrandingRow | null;
  onSaved: () => void;
}) {
  const empty: ActivateBrandingRow = {
    org_id: orgId,
    display_name: orgName,
    tagline: null,
    blurb: null,
    logo_url: null,
    logo_domain: null,
    banner_url: null,
    primary_color: '#13274F',
    accent_color: '#DB5E89',
  };
  const [form, setForm] = useState<ActivateBrandingRow>(branding ?? empty);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  // Re-sync when the org (or freshly loaded branding) changes.
  useEffect(() => {
    setForm(branding ?? empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branding, orgId]);

  const set = (patch: Partial<ActivateBrandingRow>) => setForm((f) => ({ ...f, ...patch }));
  const validHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

  const save = async () => {
    if (!form.display_name.trim()) {
      toast.error('Display name is required');
      return;
    }
    if (!validHex(form.primary_color) || !validHex(form.accent_color)) {
      toast.error('Colors must be 6-digit hex values like #003D6B');
      return;
    }
    setSaving(true);
    try {
      await saveActivateBranding({ ...form, display_name: form.display_name.trim() });
      toast.success('Branding saved — live on every open link');
      onSaved();
    } catch {
      toast.error('Could not save branding');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border">
      <button
        className="flex w-full items-center justify-between p-4 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          {/* Live swatch of the recipient-page canvas */}
          <span
            className="flex h-10 w-16 items-center justify-center rounded-md text-xs font-bold text-white"
            style={{
              background: `radial-gradient(120% 120% at 15% 0%, ${form.accent_color}, transparent 65%), ${form.primary_color}`,
            }}
          >
            {form.display_name.charAt(0)}
          </span>
          <div>
            <p className="text-sm font-semibold">Branding</p>
            <p className="text-xs text-muted-foreground">
              {form.display_name}
              {form.tagline ? ` · ${form.tagline}` : ''} — the page derives everything from these
              tokens
            </p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">{open ? 'Hide' : 'Edit'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="b-name">Display name</Label>
              <Input
                id="b-name"
                value={form.display_name}
                onChange={(e) => set({ display_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-domain">Logo domain (logo.dev)</Label>
              <Input
                id="b-domain"
                value={form.logo_domain ?? ''}
                onChange={(e) => set({ logo_domain: e.target.value.trim() || null })}
                placeholder="e.g. csl.com — blank shows initials"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-tagline">Tagline</Label>
            <Input
              id="b-tagline"
              value={form.tagline ?? ''}
              onChange={(e) => set({ tagline: e.target.value || null })}
              placeholder="e.g. Global biotech · 32,000 people · 35 countries"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-banner">Banner image URL (optional)</Label>
            <Input
              id="b-banner"
              value={form.banner_url ?? ''}
              onChange={(e) => set({ banner_url: e.target.value.trim() || null })}
              placeholder="https://… — campaign artwork shown above the logo"
            />
            {form.banner_url && (
              <div className="rounded-lg border bg-muted/30 p-2">
                <img
                  src={form.banner_url}
                  alt=""
                  className="mx-auto max-h-20 w-full rounded object-contain"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
                <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                  Preview — any aspect ratio; wide strips (roughly 6:1) sit best.
                </p>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-blurb">Blurb (one sentence on the welcome screen)</Label>
            <Input
              id="b-blurb"
              value={form.blurb ?? ''}
              onChange={(e) => set({ blurb: e.target.value || null })}
              placeholder="Two questions, and we'll show you…"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {(
              [
                ['primary_color', 'Primary color (canvas)'],
                ['accent_color', 'Accent color (gradient + chips)'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`b-${key}`}>{label}</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`${label} picker`}
                    value={validHex(form[key]) ? form[key] : '#000000'}
                    onChange={(e) => set({ [key]: e.target.value } as Partial<ActivateBrandingRow>)}
                    className="h-9 w-12 cursor-pointer rounded border bg-transparent p-0.5"
                  />
                  <Input
                    id={`b-${key}`}
                    value={form[key]}
                    onChange={(e) => set({ [key]: e.target.value } as Partial<ActivateBrandingRow>)}
                    className="font-mono"
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Text on the canvas auto-flips between white and navy for contrast, so any pair of
            colors stays readable. Save, then reload an open Activate link to see it.
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={saving}>
              Save branding
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkRow({
  link,
  stats,
  entityName,
  onCopy,
  onRevoke,
}: {
  link: ActivateLink;
  stats: ActivateLinkStats | undefined;
  entityName: Record<string, string>;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const expired = new Date(link.expires_at) < new Date();
  const status = link.revoked_at ? 'revoked' : expired ? 'expired' : 'live';
  return (
    <div className="p-3.5 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{link.label}</span>
          {link.audience && (
            <Badge variant="outline" className="text-xs capitalize">
              {link.audience}
            </Badge>
          )}
          <Badge
            className={
              status === 'live'
                ? 'bg-emerald-100 text-emerald-700'
                : status === 'expired'
                  ? 'bg-slate-100 text-slate-600'
                  : 'bg-red-100 text-red-700'
            }
          >
            {status}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {link.prefill_market_code ? `Prefilled ${countryName(link.prefill_market_code)}` : 'No market prefill'}
          {link.prefill_entity_company_id
            ? ` · ${entityName[link.prefill_entity_company_id] ?? 'entity'}`
            : ''}
          {' · '}expires {new Date(link.expires_at).toLocaleDateString()}
        </p>
        {stats && (
          <p className="text-xs mt-1">
            <span className="text-muted-foreground">~{stats.open_sessions} opens · </span>
            <span className="font-medium">{stats.declared_sessions} declared</span>
            <span className="text-muted-foreground">
              {' '}· {stats.click_sessions} clicked ({stats.clicks_total} clicks)
            </span>
            {stats.suppressed ? (
              <Badge variant="outline" className="ml-2 text-[10px]">
                aggregate only — under 5 sessions
              </Badge>
            ) : (
              <>
                {stats.markets && Object.keys(stats.markets).length > 0 && (
                  <span className="text-muted-foreground">
                    {' '}·{' '}
                    {Object.entries(stats.markets)
                      .sort((a, b) => b[1] - a[1])
                      .map(([code, n]) => `${countryName(code)} ${n}`)
                      .join(', ')}
                  </span>
                )}
                {stats.platforms && Object.keys(stats.platforms).length > 0 && (
                  <span className="text-muted-foreground">
                    {' '}·{' '}
                    {Object.entries(stats.platforms)
                      .sort((a, b) => b[1] - a[1])
                      .map(([platform, n]) => `${platform} ${n}`)
                      .join(', ')}
                  </span>
                )}
              </>
            )}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCopy} title="Copy link">
          <Copy className="h-4 w-4" />
        </Button>
        {status === 'live' && (
          <Button variant="ghost" size="sm" onClick={onRevoke} title="Revoke link">
            <Ban className="h-4 w-4 text-red-500" />
          </Button>
        )}
      </div>
    </div>
  );
}

function RoutesOverview({
  routes,
  entityName,
}: {
  routes: ActivateAdminRoute[];
  entityName: Record<string, string>;
}) {
  const byMarket = useMemo(() => {
    const groups = new Map<string, ActivateAdminRoute[]>();
    for (const r of routes) {
      const key = r.market_code ?? 'global';
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.entries()].sort(([a], [b]) =>
      a === 'global' ? 1 : b === 'global' ? -1 : a.localeCompare(b),
    );
  }, [routes]);

  if (routes.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Routes</h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {byMarket.map(([market, rows]) => (
          <div key={market} className="rounded-lg border p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium">
                {market === 'global' ? 'Global default' : countryName(market)}
              </span>
              <Badge variant="outline" className="text-[10px]">
                tier {rows[0].tier}
              </Badge>
            </div>
            <ul className="space-y-1.5">
              {rows.map((r) => (
                <li key={r.id} className="text-xs flex items-center gap-1.5 flex-wrap">
                  <span className={r.active ? '' : 'text-muted-foreground line-through'}>
                    {r.rank}. {r.platform}
                  </span>
                  {r.entity_company_id && (
                    <span className="text-muted-foreground">
                      ({entityName[r.entity_company_id] ?? 'entity'})
                    </span>
                  )}
                  {!r.active && (
                    <Badge variant="outline" className="text-[10px]">
                      inactive
                    </Badge>
                  )}
                  {r.use_direct_link && (
                    <Badge variant="outline" className="text-[10px]">
                      noreferrer
                    </Badge>
                  )}
                  {r.channel === 'social' && (
                    <Badge variant="outline" className="text-[10px]">
                      social
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Routes are curated by hand (SQL) on purpose — "most cited" and "best place to post" are
        different questions. DE/CH stay inactive until kununu profile consolidation and the
        client's works-council review clear.
      </p>
    </div>
  );
}

function ConsentDialog({
  open,
  onOpenChange,
  orgName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgName: string;
  onConfirm: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record client consent</DialogTitle>
          <DialogDescription>
            Confirm that {orgName} has explicitly agreed to Activate reaching their employees and
            candidates. This unlocks link creation for the org.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="consent-note">Who agreed, and when? (kept on record)</Label>
          <Input
            id="consent-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Elise confirmed via email 2026-08-14"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || note.trim().length === 0}
            onClick={async () => {
              setSaving(true);
              try {
                await onConfirm(note.trim());
              } finally {
                setSaving(false);
              }
            }}
          >
            <Check className="h-4 w-4 mr-1.5" />
            Record consent
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateLinkDialog({
  open,
  onOpenChange,
  orgId,
  entities,
  markets,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  entities: EntityOption[];
  markets: string[];
  onCreated: (link: ActivateLink) => void;
}) {
  const [label, setLabel] = useState('');
  const [audience, setAudience] = useState<string>('none');
  const [prefillMarket, setPrefillMarket] = useState<string>('none');
  const [prefillEntity, setPrefillEntity] = useState<string>('none');
  const [expiresDays, setExpiresDays] = useState('90');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    setSaving(true);
    try {
      const link = await createActivateLink({
        orgId,
        label: label.trim(),
        audience: audience === 'none' ? null : (audience as ActivateAudience),
        prefillMarketCode: prefillMarket === 'none' ? null : prefillMarket,
        prefillEntityCompanyId: prefillEntity === 'none' ? null : prefillEntity,
        expiresDays: Math.max(1, parseInt(expiresDays, 10) || 90),
      });
      setLabel('');
      setAudience('none');
      setPrefillMarket('none');
      setPrefillEntity('none');
      onCreated(link);
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      toast.error(
        message.includes('consent_required')
          ? 'Client consent has to be recorded before links can be created'
          : 'Could not create the link',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Activate link</DialogTitle>
          <DialogDescription>
            Label links by cohort ("DE plasma ops"), not by person — per-person links turn the
            funnel into individual monitoring, which the k-anonymity floor is there to prevent.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="link-label">Cohort label</Label>
            <Input
              id="link-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. AU commercial team"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Audience (optional)</Label>
              <Select value={audience} onValueChange={setAudience}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  {AUDIENCES.map((a) => (
                    <SelectItem key={a} value={a} className="capitalize">
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Expires in (days)</Label>
              <Input
                type="number"
                min={1}
                value={expiresDays}
                onChange={(e) => setExpiresDays(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Prefill market (optional)</Label>
              <Select value={prefillMarket} onValueChange={setPrefillMarket}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Recipient chooses</SelectItem>
                  {markets.map((code) => (
                    <SelectItem key={code} value={code}>
                      {countryName(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Prefill entity (optional)</Label>
              <Select value={prefillEntity} onValueChange={setPrefillEntity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Recipient chooses</SelectItem>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Prefills skip the questions but stay visible and overridable on the page — the
            recipient's declared value is always what routes.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || label.trim().length === 0} onClick={create}>
            Create link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
