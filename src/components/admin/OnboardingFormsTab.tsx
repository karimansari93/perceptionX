// Admin surface for the client onboarding (§6):
//  - create a tokenized invite (company + contact email locked at invite time)
//  - invite list with status badges
//  - review a submitted brief (every field editable) and approve it, which
//    generates confirmed_prompts deterministically + idempotently (§7).
//
// Email sending is stubbed as a copyable link for now — the invite modal hands
// back the /onboarding/:token URL to paste into an email.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, RefreshCw, Send, Trash2 } from 'lucide-react';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import {
  approveOnboarding,
  createOnboardingInvite,
  deleteOnboardingInvite,
  getOnboardingSubmission,
  OnboardingInvite,
  onboardingLinkFor,
  OnboardingSubmission,
  listOnboardingInvites,
  markOnboardingReviewed,
  updateOnboardingSubmissionPayload,
} from '@/lib/onboarding/api';
import {
  CANONICAL_JOB_FUNCTIONS,
  OnboardingPayload,
  MANAGED_PLATFORM_OPTIONS,
  validateForSubmit,
} from '@/lib/onboarding/types';
import {
  extractOwnedDomainSeeds,
  generateConfirmedPrompts,
  trackedEntities,
} from '@/lib/onboarding/generateConfirmedPrompts';
import {
  ChipAdder,
  EntityEditor,
  MultiChipSelect,
  PriorityEditor,
  PropertyEditor,
  RecipientEditor,
} from '@/components/onboarding/inputs';
import { COUNTRY_NAMES } from '@/lib/marketName';

const STATUS_STYLES: Record<OnboardingInvite['status'], string> = {
  sent: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-teal/10 text-teal',
  submitted: 'bg-pink/10 text-pink',
  reviewed: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
};

const STATUS_LABELS: Record<OnboardingInvite['status'], string> = {
  sent: 'Sent',
  in_progress: 'In progress',
  submitted: 'Submitted',
  reviewed: 'Reviewed',
  approved: 'Approved',
};

interface OrgOption {
  id: string;
  name: string;
}

export const OnboardingFormsTab = () => {
  const [invites, setInvites] = useState<OnboardingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [reviewInvite, setReviewInvite] = useState<OnboardingInvite | null>(null);
  const [deleteInvite, setDeleteInvite] = useState<OnboardingInvite | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setInvites(await listOnboardingInvites());
    } catch (e) {
      toast.error('Could not load onboarding forms');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const copyLink = async (invite: OnboardingInvite) => {
    await navigator.clipboard.writeText(onboardingLinkFor(invite.token));
    toast.success('Onboarding link copied');
  };

  const confirmDelete = async () => {
    if (!deleteInvite) return;
    setDeleting(true);
    try {
      await deleteOnboardingInvite(deleteInvite.id);
      toast.success('Onboarding invite removed');
      setDeleteInvite(null);
      refresh();
    } catch {
      toast.error('Could not remove the invite');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-headline font-semibold text-slate-800">Onboarding invites</h2>
          <p className="text-sm text-slate-500">
            Conversational onboarding briefs — invite, review, approve into tracking prompts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Send className="h-4 w-4 mr-1.5" />
            Send onboarding form
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="px-4 py-2.5 font-medium">Company</th>
              <th className="px-4 py-2.5 font-medium">Contact</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Created</th>
              <th className="px-4 py-2.5 font-medium">Expires</th>
              <th className="px-4 py-2.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {invites.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  {loading ? 'Loading…' : 'No invites yet — send the first one.'}
                </td>
              </tr>
            )}
            {invites.map((invite) => (
              <tr key={invite.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-2.5 font-medium text-slate-800">{invite.company_name}</td>
                <td className="px-4 py-2.5 text-slate-600">{invite.contact_email}</td>
                <td className="px-4 py-2.5">
                  <Badge variant="secondary" className={STATUS_STYLES[invite.status]}>
                    {STATUS_LABELS[invite.status]}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-slate-500">
                  {new Date(invite.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5 text-slate-500">
                  {new Date(invite.expires_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyLink(invite)}
                      title="Copy onboarding link"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    {['submitted', 'reviewed', 'approved'].includes(invite.status) && (
                      <Button variant="outline" size="sm" onClick={() => setReviewInvite(invite)}>
                        Review brief
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteInvite(invite)}
                      title="Remove onboarding invite"
                      className="text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CreateInviteDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={refresh}
      />
      {reviewInvite && (
        <ReviewBriefDialog
          invite={reviewInvite}
          onClose={() => setReviewInvite(null)}
          onChanged={refresh}
        />
      )}

      <AlertDialog
        open={!!deleteInvite}
        onOpenChange={(o) => !o && !deleting && setDeleteInvite(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove onboarding invite?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the invite for{' '}
              <strong>{deleteInvite?.company_name}</strong> ({deleteInvite?.contact_email}) and its
              submitted brief. The onboarding link will stop working. This can't be undone.
              {deleteInvite?.status === 'approved' && (
                <>
                  {' '}
                  Prompts already generated from this brief are not affected.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleting ? 'Removing…' : 'Remove invite'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Create invite
// ---------------------------------------------------------------------------

function CreateInviteDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [companyName, setCompanyName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [orgId, setOrgId] = useState<string>('');
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailStatus, setEmailStatus] = useState<'sent' | 'not_sent' | null>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase.from('organizations').select('id, name').order('name');
      setOrgs((data as OrgOption[]) ?? []);
    })();
  }, [open]);

  const reset = () => {
    setCompanyName('');
    setContactEmail('');
    setOrgId('');
    setCreatedLink(null);
    setCopied(false);
    setEmailStatus(null);
  };

  const create = async () => {
    setBusy(true);
    try {
      const invite = await createOnboardingInvite(companyName, contactEmail, orgId || null);
      setCreatedLink(onboardingLinkFor(invite.token));
      onCreated();
      // Email the invite. Best-effort — the copyable link below always works.
      try {
        const { data } = await supabase.functions.invoke('send-intake-invite', {
          body: { inviteId: invite.id },
        });
        setEmailStatus(data?.sent ? 'sent' : 'not_sent');
      } catch {
        setEmailStatus('not_sent');
      }
    } catch (e) {
      toast.error('Could not create the invite');
    } finally {
      setBusy(false);
    }
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          reset();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send onboarding form</DialogTitle>
          <DialogDescription>
            Company and contact email are locked into the invite — the client can't change them.
          </DialogDescription>
        </DialogHeader>

        {createdLink ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Invite created for <strong>{companyName}</strong>.{' '}
              {emailStatus === 'sent'
                ? `The invite email is on its way to ${contactEmail}. Here's the link too, in case you want it:`
                : emailStatus === 'not_sent'
                  ? `The email couldn't be sent (no email service configured) — copy the link and send it to ${contactEmail} yourself.`
                  : 'Sending the invite email…'}
            </p>
            <div className="flex gap-2">
              <Input readOnly value={createdLink} className="text-xs" onFocus={(e) => e.target.select()} />
              <Button
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(createdLink);
                  setCopied(true);
                  toast.success('Link copied');
                }}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  reset();
                }}
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-company">Company name</Label>
              <Input
                id="invite-company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Ford"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Contact email</Label>
              <Input
                id="invite-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="name@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-org">Organization (optional — can be set at review)</Label>
              <select
                id="invite-org"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">No organization yet</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={create}
                disabled={busy || !companyName.trim() || !emailValid}
              >
                {busy ? 'Creating…' : 'Create invite link'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Review + approve
// ---------------------------------------------------------------------------

function ReviewBriefDialog({
  invite,
  onClose,
  onChanged,
}: {
  invite: OnboardingInvite;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [submission, setSubmission] = useState<OnboardingSubmission | null>(null);
  const [payload, setPayload] = useState<OnboardingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const sub = await getOnboardingSubmission(invite.id);
        setSubmission(sub);
        // Backfill fields older briefs predate.
        setPayload(
          sub
            ? {
                function_scope: 'uniform',
                market_functions: [],
                function_industries: [],
                ...sub.payload,
              }
            : null,
        );
        if (invite.status === 'submitted') {
          await markOnboardingReviewed(invite.id);
          onChanged();
        }
      } catch {
        toast.error('Could not load the brief');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite.id]);

  const patch = (p: Partial<OnboardingPayload>) =>
    setPayload((prev) => (prev ? { ...prev, ...p } : prev));

  const promptPreview = useMemo(() => {
    if (!payload) return null;
    const rows = generateConfirmedPrompts(payload);
    return { rows, entities: trackedEntities(payload) };
  }, [payload]);

  const problems = payload ? validateForSubmit(payload) : [];

  const saveEdits = async () => {
    if (!submission || !payload) return;
    setSaving(true);
    try {
      await updateOnboardingSubmissionPayload(submission.id, payload);
      toast.success('Brief updated');
    } catch {
      toast.error('Could not save the edits');
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (!submission || !payload || !promptPreview) return;
    setApproving(true);
    try {
      // Persist any admin edits first — the approved brief is the source of truth.
      await updateOnboardingSubmissionPayload(submission.id, payload);
      const result = await approveOnboarding(
        invite.id,
        promptPreview.rows,
        payload,
        extractOwnedDomainSeeds(payload),
      );
      toast.success(
        `Approved — organization ready, ${result.prompts_inserted} prompts created` +
          (result.prompts_skipped_existing > 0
            ? `, ${result.prompts_skipped_existing} already existed`
            : '') +
          '. Queue it in Company Batch to start collection.',
      );
      onChanged();
      onClose();
    } catch (e) {
      toast.error('Approval failed — nothing was generated');
    } finally {
      setApproving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Project brief — {invite.company_name}</DialogTitle>
          <DialogDescription>
            Submitted by {invite.contact_email}. Edit anything below — the brief you approve is
            what generates the tracking prompts.
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-slate-500 py-6">Loading brief…</p>}
        {!loading && !payload && (
          <p className="text-sm text-slate-500 py-6">No submission found for this invite.</p>
        )}

        {payload && (
          <div className="space-y-5">
            <Field label="Employer entities (tracked separately get their own prompt set)">
              <EntityEditor
                companyName={invite.company_name}
                entities={payload.employer_entities}
                onChange={(v) => patch({ employer_entities: v })}
              />
              {payload.employer_entities.some(
                (e) => e.track_separately && e.scope_mode === 'custom',
              ) && (
                <div className="mt-2 space-y-1 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
                  <p className="font-medium text-slate-700">Sub-brand scopes set by the client:</p>
                  {payload.employer_entities
                    .filter((e) => e.track_separately && e.scope_mode === 'custom')
                    .map((e) => (
                      <p key={e.name}>
                        <span className="font-medium">{e.name}</span> —{' '}
                        {(e.job_functions ?? []).join(', ') || '—'} in{' '}
                        {(e.markets ?? []).join(', ') || '—'}
                      </p>
                    ))}
                </div>
              )}
            </Field>

            <Field label="Job functions">
              <MultiChipSelect
                options={CANONICAL_JOB_FUNCTIONS}
                selected={payload.job_functions}
                onToggle={(v) =>
                  patch({
                    job_functions: payload.job_functions.some(
                      (x) => x.toLowerCase() === v.toLowerCase(),
                    )
                      ? payload.job_functions.filter((x) => x.toLowerCase() !== v.toLowerCase())
                      : [...payload.job_functions, v],
                  })
                }
                onAddCustom={(v) => patch({ job_functions: [...payload.job_functions, v] })}
                addPlaceholder="Add a function"
              />
            </Field>

            <Field label="Markets">
              <ChipAdder
                values={payload.markets}
                onChange={(v) => patch({ markets: v })}
                placeholder={`Add a market — e.g. ${Object.values(COUNTRY_NAMES)[0]}`}
              />
            </Field>

            {payload.markets.length > 1 && (
              <Field label="Functions by market">
                <div className="flex gap-2 mb-2">
                  {(['uniform', 'per_market'] as const).map((v) => (
                    <Button
                      key={v}
                      variant={payload.function_scope === v ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => patch({ function_scope: v })}
                    >
                      {v === 'uniform' ? 'Same everywhere' : 'Different by market'}
                    </Button>
                  ))}
                </div>
                {payload.function_scope === 'per_market' && (
                  <div className="space-y-2">
                    {payload.markets.map((market) => {
                      const entry = payload.market_functions.find((x) => x.market === market);
                      const selected = entry?.functions ?? [];
                      const setFns = (functions: string[]) =>
                        patch({
                          market_functions: [
                            ...payload.market_functions.filter((x) => x.market !== market),
                            { market, functions },
                          ],
                        });
                      return (
                        <div key={market} className="rounded-md border border-slate-200 p-2.5">
                          <p className="text-xs font-medium text-slate-600 mb-1.5">{market}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {payload.job_functions.map((fn) => {
                              const on = selected.some(
                                (x) => x.toLowerCase() === fn.toLowerCase(),
                              );
                              return (
                                <Button
                                  key={fn}
                                  variant={on ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() =>
                                    setFns(
                                      on
                                        ? selected.filter(
                                            (x) => x.toLowerCase() !== fn.toLowerCase(),
                                          )
                                        : [...selected, fn],
                                    )
                                  }
                                >
                                  {fn}
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Field>
            )}

            <Field label="Talent competitors (context only — not competitor tracking)">
              <ChipAdder
                values={payload.talent_competitors}
                onChange={(v) => patch({ talent_competitors: v })}
                placeholder="Add a competitor"
              />
            </Field>

            <Field label="Industries">
              <ChipAdder
                values={payload.industries}
                onChange={(v) =>
                  patch({
                    industries: v,
                    function_industries: (payload.function_industries ?? []).filter((m) =>
                      v.some((i) => i.toLowerCase() === m.industry.toLowerCase()),
                    ),
                  })
                }
                placeholder="Add an industry"
              />
            </Field>

            {payload.industries.length > 1 && (
              <Field label="Industry by function (benchmark each function in its own industry)">
                <div className="space-y-2">
                  {payload.job_functions.map((fn) => {
                    const current =
                      (payload.function_industries ?? []).find(
                        (m) => m.function.toLowerCase() === fn.toLowerCase(),
                      )?.industry ?? payload.industries[0];
                    return (
                      <div key={fn} className="rounded-md border border-slate-200 p-2.5">
                        <p className="text-xs font-medium text-slate-600 mb-1.5">{fn}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {payload.industries.map((ind) => (
                            <Button
                              key={ind}
                              variant={
                                current?.toLowerCase() === ind.toLowerCase()
                                  ? 'default'
                                  : 'outline'
                              }
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() =>
                                patch({
                                  function_industries: [
                                    ...(payload.function_industries ?? []).filter(
                                      (m) => m.function.toLowerCase() !== fn.toLowerCase(),
                                    ),
                                    { function: fn, industry: ind },
                                  ],
                                })
                              }
                            >
                              {ind}
                            </Button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Field>
            )}

            <Field label="Career site URL">
              <Input
                value={payload.career_site_url}
                onChange={(e) => patch({ career_site_url: e.target.value })}
              />
            </Field>

            <Field label="Owned properties">
              <PropertyEditor
                properties={payload.owned_properties}
                onChange={(v) => patch({ owned_properties: v })}
              />
            </Field>

            <Field label="Managed review platforms">
              <MultiChipSelect
                options={MANAGED_PLATFORM_OPTIONS}
                selected={payload.managed_platforms}
                onToggle={(v) =>
                  patch({
                    managed_platforms: payload.managed_platforms.some(
                      (x) => x.toLowerCase() === v.toLowerCase(),
                    )
                      ? payload.managed_platforms.filter(
                          (x) => x.toLowerCase() !== v.toLowerCase(),
                        )
                      : [...payload.managed_platforms, v],
                  })
                }
                onAddCustom={(v) => patch({ managed_platforms: [...payload.managed_platforms, v] })}
                addPlaceholder="Add a platform"
              />
            </Field>

            <Field label="Career-stage grain">
              <div className="flex gap-2">
                {(['combined', 'split'] as const).map((v) => (
                  <Button
                    key={v}
                    variant={payload.career_stage_split === v ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => patch({ career_stage_split: v })}
                  >
                    {v === 'combined' ? 'Combined' : 'Split by stage'}
                  </Button>
                ))}
              </div>
            </Field>

            <Field label="Talent priorities (up to 5)">
              <PriorityEditor
                values={payload.ta_priorities}
                onChange={(v) => patch({ ta_priorities: v })}
              />
            </Field>

            <Field label="Leadership objective">
              <textarea
                value={payload.leadership_objective}
                onChange={(e) => patch({ leadership_objective: e.target.value })}
                rows={2}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Focus questions">
              <textarea
                value={payload.focus_questions}
                onChange={(e) => patch({ focus_questions: e.target.value })}
                rows={2}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Known narratives / recent events">
              <textarea
                value={payload.known_context}
                onChange={(e) => patch({ known_context: e.target.value })}
                rows={2}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Report recipients (exactly one primary)">
              <RecipientEditor
                recipients={payload.report_recipients}
                onChange={(v) => patch({ report_recipients: v })}
              />
            </Field>

            <Field label="Additional notes">
              <textarea
                value={payload.additional_notes}
                onChange={(e) => patch({ additional_notes: e.target.value })}
                rows={2}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </Field>

            {/* Approval summary */}
            {promptPreview && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5">
                <p className="text-sm font-medium text-slate-800">
                  Approving generates {promptPreview.rows.length} tracking prompts
                </p>
                <p className="text-xs text-slate-500">
                  Across {promptPreview.entities.join(', ')}
                  {payload.career_stage_split === 'split' ? ', split by career stage' : ''} — 4 prompt
                  types per market–function cell. Re-approving never duplicates existing prompts.
                </p>
                {problems.length > 0 && (
                  <ul className="text-xs text-pink pt-1 space-y-0.5">
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-between gap-2 pt-1 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(onboardingLinkFor(invite.token), '_blank')}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                View client link
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={saveEdits} disabled={saving}>
                  {saving ? 'Saving…' : 'Save edits'}
                </Button>
                <Button size="sm" onClick={approve} disabled={approving || problems.length > 0}>
                  {approving
                    ? 'Generating…'
                    : invite.status === 'approved'
                      ? 'Re-approve & generate prompts'
                      : 'Approve & generate prompts'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      {children}
    </div>
  );
}
