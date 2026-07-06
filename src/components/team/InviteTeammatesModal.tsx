import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { SuperAdminOrg } from '@/hooks/useIsSuperAdmin';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  UserPlus,
  X,
} from 'lucide-react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InviteResult {
  email: string;
  status: string;
  message?: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  status: string;
  sent_at: string;
}

interface InviteTeammatesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgs: SuperAdminOrg[];
}

// Invite dialog launched from the sidebar "Invite teammates" card.
// One input per email, "+" adds another row. Everyone joins as a member;
// Super Admins are granted from the pX admin panel. Sends through the
// invite-team-member edge function and shows per-email results.
const InviteTeammatesModal = ({ open, onOpenChange, orgs }: InviteTeammatesModalProps) => {
  const { user } = useAuth();
  const userDomain = user?.email?.split('@')[1] ?? '';

  const [emails, setEmails] = useState<string[]>(['']);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const rowRefs = useRef<(HTMLInputElement | null)[]>([]);

  const selectedOrg = orgs[0] ?? null;

  useEffect(() => {
    if (open) {
      setResults(null);
      // Focus the first input after the dialog mounts
      setTimeout(() => rowRefs.current[0]?.focus(), 50);
    }
  }, [open]);

  const callTeamFunction = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('invite-team-member', {
      body: { organizationId: selectedOrg?.organization_id, ...body },
    });
    if (error) {
      // supabase-js surfaces non-2xx as a generic error; pull the real
      // message from the response body when available.
      let message = error.message;
      try {
        const ctx = (error as { context?: Response }).context;
        if (ctx) {
          const parsed = await ctx.json();
          if (parsed?.error) message = parsed.error;
        }
      } catch { /* keep generic message */ }
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };

  // Pending invites for the org (refreshes after every send)
  useEffect(() => {
    if (!open || !selectedOrg) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await callTeamFunction({ action: 'list' });
        if (!cancelled) {
          setPendingInvites(
            (data.invites ?? []).filter((i: PendingInvite) => i.status === 'pending'),
          );
        }
      } catch (err) {
        console.error('Error loading pending invites:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedOrg?.organization_id, results]);

  const isValidEmail = (email: string) =>
    EMAIL_RE.test(email) && email.endsWith(`@${userDomain}`);

  const rowError = (email: string): string | null => {
    const value = email.trim().toLowerCase();
    if (!value) return null;
    if (!EMAIL_RE.test(value)) return 'Not a valid email address';
    if (!value.endsWith(`@${userDomain}`)) return `Must be an @${userDomain} email`;
    return null;
  };

  const validEmails = [
    ...new Set(emails.map((e) => e.trim().toLowerCase()).filter(isValidEmail)),
  ];

  const updateEmail = (index: number, value: string) => {
    setEmails((prev) => prev.map((e, i) => (i === index ? value : e)));
  };

  const addRow = () => {
    setEmails((prev) => [...prev, '']);
    setTimeout(() => rowRefs.current[emails.length]?.focus(), 30);
  };

  const removeRow = (index: number) => {
    setEmails((prev) => (prev.length === 1 ? [''] : prev.filter((_, i) => i !== index)));
  };

  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (index === emails.length - 1 && emails[index].trim()) {
        addRow();
      }
    }
  };

  // Pasting "a@x.com, b@x.com" into a row spreads the addresses across rows
  const handleRowPaste = (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
    const text = e.clipboardData.getData('text');
    const parts = text.split(/[\s,;]+/).filter(Boolean);
    if (parts.length <= 1) return;
    e.preventDefault();
    setEmails((prev) => {
      const next = [...prev];
      next[index] = parts[0];
      next.splice(index + 1, 0, ...parts.slice(1));
      return next;
    });
  };

  const reset = () => {
    setEmails(['']);
    setResults(null);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSend = async () => {
    if (!validEmails.length || !selectedOrg) return;
    setSending(true);
    try {
      const data = await callTeamFunction({
        action: 'invite',
        emails: validEmails,
        role: 'member',
      });
      setResults(data.results ?? []);
      setEmails(['']);
    } catch (err) {
      console.error('Error sending invites:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to send invites');
    } finally {
      setSending(false);
    }
  };

  const handleResend = async (invite: PendingInvite) => {
    setActioningId(invite.id);
    try {
      await callTeamFunction({ action: 'resend', inviteId: invite.id });
      toast.success(`Invite resent to ${invite.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resend invite');
    } finally {
      setActioningId(null);
    }
  };

  const handleRevoke = async (invite: PendingInvite) => {
    setActioningId(invite.id);
    try {
      await callTeamFunction({ action: 'revoke', inviteId: invite.id });
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
      toast.success(`Invite for ${invite.email} revoked`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke invite');
    } finally {
      setActioningId(null);
    }
  };

  const sentResults = (results ?? []).filter((r) => r.status === 'invited' || r.status === 'added_existing');
  const skippedResults = (results ?? []).filter((r) => r.status !== 'invited' && r.status !== 'added_existing');

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md p-0 overflow-hidden rounded-2xl border-silver">
        {/* Header */}
        <div className="bg-gradient-to-br from-pink/15 via-white to-[#13274F]/5 px-6 pt-6 pb-5 border-b border-gray-100">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-pink text-white shadow-sm">
              <UserPlus className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2
                className="text-lg font-bold text-[#13274F] leading-tight"
                style={{ fontFamily: 'Geologica, sans-serif' }}
              >
                Invite your team
              </h2>
              <p className="text-[13px] text-gray-500 mt-1 leading-snug" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                Add a teammate with a <span className="font-semibold text-[#13274F]">@{userDomain}</span> email
                to join you. They just set a password and land on the dashboard.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          {results ? (
            /* ---- Results view ---- */
            <div className="space-y-3">
              {sentResults.length > 0 && (
                <div className="rounded-xl border border-green-200 bg-green-50/60 p-3 space-y-2">
                  {sentResults.map((r) => (
                    <div key={r.email} className="flex items-center gap-2 text-sm text-green-900">
                      <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                      <span className="truncate font-medium">{r.email}</span>
                      <span className="text-green-700/70 ml-auto text-xs">
                        {r.status === 'invited' ? 'Invite sent' : 'Added to team'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {skippedResults.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                  {skippedResults.map((r) => (
                    <div key={r.email} className="flex items-start gap-2 text-sm text-amber-900">
                      <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <span className="font-medium truncate block">{r.email}</span>
                        <span className="text-xs text-amber-700/80">{r.message ?? r.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" size="sm" onClick={() => setResults(null)} className="text-gray-500">
                  Invite more
                </Button>
                <Button
                  onClick={() => handleClose(false)}
                  className="bg-[#13274F] hover:bg-[#13274F]/90 text-white rounded-full px-6 font-bold"
                >
                  Done
                </Button>
              </div>
            </div>
          ) : (
            /* ---- Compose view ---- */
            <>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Email addresses
                </label>
                <div className="space-y-2">
                  {emails.map((email, index) => {
                    const error = rowError(email);
                    return (
                      <div key={index}>
                        <div className="flex items-center gap-2">
                          <Input
                            ref={(el) => (rowRefs.current[index] = el)}
                            type="email"
                            value={email}
                            onChange={(e) => updateEmail(index, e.target.value)}
                            onKeyDown={(e) => handleRowKeyDown(e, index)}
                            onPaste={(e) => handleRowPaste(e, index)}
                            placeholder={`name@${userDomain}`}
                            className={`rounded-xl border-gray-200 placeholder:text-gray-300 placeholder:font-light focus-visible:ring-pink/30 focus-visible:border-pink ${
                              error ? 'border-red-300 focus-visible:border-red-400 focus-visible:ring-red-100' : ''
                            }`}
                          />
                          {(emails.length > 1 || email) && (
                            <button
                              type="button"
                              onClick={() => removeRow(index)}
                              className="rounded-full p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                              aria-label="Remove email"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        {error && (
                          <p className="text-[11px] text-red-500 flex items-center gap-1 mt-1 ml-1">
                            <AlertCircle className="h-3 w-3" />
                            {error}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={addRow}
                  className="flex items-center gap-1.5 text-[13px] font-semibold text-pink hover:text-pink/80 transition-colors mt-1"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-pink/10">
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                  Add another
                </button>
              </div>

              {pendingInvites.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Pending invites
                  </label>
                  <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 max-h-36 overflow-y-auto">
                    {pendingInvites.map((invite) => (
                      <div key={invite.id} className="flex items-center gap-2 px-3 py-2">
                        <Clock className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-[#13274F] truncate">{invite.email}</p>
                          <p className="text-[10px] text-gray-400">
                            invited {new Date(invite.sent_at).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleResend(invite)}
                          disabled={actioningId === invite.id}
                          className="rounded-full p-1.5 text-gray-400 hover:text-[#13274F] hover:bg-gray-100 transition-colors disabled:opacity-40"
                          title="Resend invite"
                        >
                          {actioningId === invite.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRevoke(invite)}
                          disabled={actioningId === invite.id}
                          className="rounded-full p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                          title="Revoke invite"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end pt-2">
                <Button
                  onClick={handleSend}
                  disabled={sending || validEmails.length === 0}
                  className="bg-pink hover:bg-pink/90 text-white rounded-full px-6 font-bold disabled:opacity-50"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  {validEmails.length > 1 ? `Send ${validEmails.length} invites` : 'Send invite'}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default InviteTeammatesModal;
