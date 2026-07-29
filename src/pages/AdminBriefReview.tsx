// Full-page admin review of a submitted onboarding brief (/admin/onboarding/:inviteId).
//
// Replaces the old ReviewBriefDialog modal — briefs are long forms, and clients
// often have typos or ask for additions after submitting, so admins need room
// to read and edit comfortably. Everything stacks vertically; the approval
// summary sits in a sticky sidebar on wide screens.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Presentation, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { BriefReviewForm } from '@/components/admin/BriefReviewForm';
import {
  approveOnboarding,
  getOnboardingInvite,
  getOnboardingSubmission,
  markOnboardingReviewed,
  OnboardingInvite,
  onboardingLinkFor,
  OnboardingSubmission,
  updateOnboardingSubmissionPayload,
} from '@/lib/onboarding/api';
import { OnboardingPayload, validateForSubmit } from '@/lib/onboarding/types';
import {
  extractOwnedDomainSeeds,
  generateConfirmedPrompts,
  trackedEntities,
} from '@/lib/onboarding/generateConfirmedPrompts';
import { localizeConfirmedRows } from '@/lib/onboarding/localizePrompts';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

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

const LIST_PATH = '/admin?tab=onboarding-forms';

export default function AdminBriefReview() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<OnboardingInvite | null>(null);
  const [submission, setSubmission] = useState<OnboardingSubmission | null>(null);
  const [payload, setPayload] = useState<OnboardingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Client view: the same editable brief, safe to screen-share on a call —
  // no admin nav, no prompt counts, no approval controls.
  const [clientView, setClientView] = useState(false);

  useDocumentTitle(invite ? `Brief — ${invite.company_name}` : 'Brief review');

  useEffect(() => {
    if (!inviteId) return;
    (async () => {
      setLoading(true);
      try {
        const inv = await getOnboardingInvite(inviteId);
        setInvite(inv);
        if (!inv) return;
        const sub = await getOnboardingSubmission(inv.id);
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
        if (inv.status === 'submitted') {
          await markOnboardingReviewed(inv.id);
          setInvite({ ...inv, status: 'reviewed' });
        }
      } catch {
        toast.error('Could not load the brief');
      } finally {
        setLoading(false);
      }
    })();
  }, [inviteId]);

  const patch = useCallback((p: Partial<OnboardingPayload>) => {
    setPayload((prev) => (prev ? { ...prev, ...p } : prev));
    setDirty(true);
  }, []);

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
      setDirty(false);
      toast.success('Brief updated');
    } catch {
      toast.error('Could not save the edits');
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (!invite || !submission || !payload || !promptPreview) return;
    setApproving(true);
    try {
      // Persist any admin edits first — the approved brief is the source of truth.
      await updateOnboardingSubmissionPayload(submission.id, payload);
      setDirty(false);
      // Localize prompt text per market (DE/CH → German, …) before insertion —
      // the same translate-prompts function the batch queue uses, so the
      // approved rows ARE the localized set and queue setup dedupes against
      // them instead of inserting a second wording. Throws on failure: never
      // approve a half-translated set.
      const localizedRows = await localizeConfirmedRows(promptPreview.rows);
      const result = await approveOnboarding(
        invite.id,
        localizedRows,
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
      navigate(LIST_PATH);
    } catch (e) {
      // Translation failures carry an actionable market name — surface them.
      toast.error(
        e instanceof Error && e.message.startsWith('Translation')
          ? `Approval stopped: ${e.message}. Nothing was generated.`
          : 'Approval failed — nothing was generated',
      );
    } finally {
      setApproving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Client view — full-bleed, presentable, editable. Everything internal is gone.
  // ---------------------------------------------------------------------------
  if (clientView && invite && payload) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-3xl px-6 py-10 pb-28">
          <header className="mb-6 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-headline font-semibold text-slate-900">
                {invite.company_name}
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">Project brief</p>
            </div>
            <button
              type="button"
              onClick={() => setClientView(false)}
              aria-label="Exit client view"
              title="Exit client view"
              className="shrink-0 rounded-md p-1.5 text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <BriefReviewForm
              companyName={invite.company_name}
              payload={payload}
              onPatch={patch}
              variant="client"
            />
          </div>
        </div>

        {/* Save bar — the only action on screen. */}
        <div className="fixed bottom-0 inset-x-0 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto max-w-3xl px-6 py-3 flex items-center justify-end gap-3">
            <span className="text-xs text-slate-400">
              {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}
            </span>
            <Button size="sm" onClick={saveEdits} disabled={saving || !dirty}>
              Save changes
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AdminLayout
      activeTab="onboarding-forms"
      onTabChange={(tab) => navigate(`/admin?tab=${tab}`)}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 text-slate-500 hover:text-slate-800"
              onClick={() => navigate(LIST_PATH)}
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Onboarding forms
            </Button>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-lg font-headline font-semibold text-slate-800">
                Project brief — {invite?.company_name ?? '…'}
              </h2>
              {invite && (
                <Badge variant="secondary" className={STATUS_STYLES[invite.status]}>
                  {STATUS_LABELS[invite.status]}
                </Badge>
              )}
            </div>
            {invite && (
              <p className="text-sm text-slate-500">
                Submitted by {invite.contact_email}
                {submission?.completed_at &&
                  ` on ${new Date(submission.completed_at).toLocaleDateString()}`}
                {submission &&
                  submission.updated_at !== submission.created_at &&
                  ` · last edited ${new Date(submission.updated_at).toLocaleDateString()}`}
                . Edit anything below — the brief you approve is what generates the tracking
                prompts.
              </p>
            )}
          </div>
          {invite && (
            <div className="flex gap-2 shrink-0">
              {payload && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setClientView(true)}
                  title="Clean, shareable view for a call — no admin nav or approval controls"
                >
                  <Presentation className="h-3.5 w-3.5 mr-1.5" />
                  Client view
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(onboardingLinkFor(invite.token), '_blank')}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                View client link
              </Button>
            </div>
          )}
        </div>

        {loading && <p className="text-sm text-slate-500 py-6">Loading brief…</p>}
        {!loading && !invite && (
          <p className="text-sm text-slate-500 py-6">
            This onboarding invite doesn't exist — it may have been removed.
          </p>
        )}
        {!loading && invite && !payload && (
          <p className="text-sm text-slate-500 py-6">
            No submission yet — the client hasn't completed the brief.
          </p>
        )}

        {!loading && invite && payload && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
            <div className="rounded-lg border border-slate-200 bg-white p-5 min-w-0 max-w-3xl">
              <BriefReviewForm
                companyName={invite.company_name}
                payload={payload}
                onPatch={patch}
              />
            </div>

            {/* Approval summary — sticky so save/approve stay reachable while editing */}
            <div className="lg:sticky lg:top-5 space-y-3">
              {promptPreview && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5">
                  <p className="text-sm font-medium text-slate-800">
                    Approving generates {promptPreview.rows.length} tracking prompts
                  </p>
                  <p className="text-xs text-slate-500">
                    Across {promptPreview.entities.join(', ')}
                    {payload.career_stage_split === 'split' ? ', split by career stage' : ''} — 4
                    prompt types per market–function cell. Re-approving never duplicates existing
                    prompts.
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
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={saveEdits}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : dirty ? 'Save edits' : 'Saved'}
                </Button>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={approve}
                  disabled={approving || problems.length > 0}
                >
                  {approving
                    ? 'Generating…'
                    : invite.status === 'approved'
                      ? 'Re-approve & generate prompts'
                      : 'Approve & generate prompts'}
                </Button>
                {dirty && (
                  <p className="text-xs text-slate-500">
                    Unsaved edits — approving saves them automatically.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
