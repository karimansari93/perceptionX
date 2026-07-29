// Admin surface for the client onboarding (§6):
//  - create a tokenized invite (company + contact email locked at invite time)
//  - invite list with status badges
//  - "Review brief" opens the full-page editor at /admin/onboarding/:inviteId
//    (see src/pages/AdminBriefReview.tsx) where the brief is edited + approved.
//
// Email sending is stubbed as a copyable link for now — the invite modal hands
// back the /onboarding/:token URL to paste into an email.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Check, Copy, RefreshCw, Send, Trash2 } from 'lucide-react';
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
  createOnboardingInvite,
  deleteOnboardingInvite,
  extendOnboardingInvite,
  OnboardingInvite,
  onboardingLinkFor,
  listOnboardingInvites,
} from '@/lib/onboarding/api';

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
  const navigate = useNavigate();
  const [invites, setInvites] = useState<OnboardingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
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

  const extendLink = async (invite: OnboardingInvite) => {
    try {
      const newExpiry = await extendOnboardingInvite(invite.id);
      toast.success(
        `Link for ${invite.company_name} is live until ${new Date(newExpiry).toLocaleDateString()} — same link, progress kept`,
      );
      refresh();
    } catch {
      toast.error('Could not extend the link');
    }
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
                <td className="px-4 py-2.5">
                  {new Date(invite.expires_at) < new Date() &&
                  ['sent', 'in_progress'].includes(invite.status) ? (
                    <span className="text-red-600 font-medium">
                      Expired {new Date(invite.expires_at).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="text-slate-500">
                      {new Date(invite.expires_at).toLocaleDateString()}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1.5">
                    {['sent', 'in_progress'].includes(invite.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => extendLink(invite)}
                        title="Extend link by 30 days — same link, progress kept"
                      >
                        <CalendarPlus className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyLink(invite)}
                      title="Copy onboarding link"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    {['submitted', 'reviewed', 'approved'].includes(invite.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/admin/onboarding/${invite.id}`)}
                      >
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

