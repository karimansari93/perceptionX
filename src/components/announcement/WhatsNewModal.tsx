import { useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Mail, Plug, Sparkles, X } from 'lucide-react';
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import { Favicon } from '@/components/ui/favicon';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { submitIntegrationRequest } from '@/hooks/useAnnouncement';
import { FORM_TOOLS, INTRO_ASSISTANTS, type AnnouncementStep } from '@/lib/announcements';
import { cn } from '@/lib/utils';
import { AskAiDemo } from './AskAiDemo';

interface WhatsNewModalProps {
  open: boolean;
  /** Step to open on: the announcement (`intro`) or the request form (`form`). */
  initialStep: AnnouncementStep;
  /** Every way out — ✕, scrim, Esc, Try Ask AI, finishing the form. */
  onClose: () => void;
}

const navyBtn = 'inline-flex h-[38px] items-center justify-center rounded-full bg-[#13274F] px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-[#183056] disabled:opacity-50';
const outlineBtn = 'inline-flex h-[38px] items-center justify-center rounded-full border border-[#13274F]/20 bg-white px-4 text-[13.5px] font-medium text-[#13274F] transition-colors hover:border-[#DB5E89]';
const backBtn = 'inline-flex h-[38px] items-center justify-center rounded-full border border-[#e5e7eb] bg-white px-4 text-[13.5px] font-medium text-[#4b5563] transition-colors hover:border-[#13274F]/30';
const fieldClass = 'w-full rounded-[10px] border border-[#e5e7eb] bg-white text-[13.5px] text-[#13274F] placeholder:text-gray-400 focus:border-[#13274F]/40 focus:outline-none';

// The what's-new modal (spec: CHANGES-announcement-and-integrations). One
// card, three steps: the announcement, the "which assistants does your team
// use?" form, and the confirmation. The header band and title render on the
// intro step only.
export function WhatsNewModal({ open, initialStep, onClose }: WhatsNewModalProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentCompany } = useCompany();
  const [step, setStep] = useState<AnnouncementStep>(initialStep);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [toolsOther, setToolsOther] = useState('');
  const [toolsNote, setToolsNote] = useState('');
  const [submitState, setSubmitState] = useState<'idle' | 'sending' | 'error'>('idle');

  // Each opening starts on the requested step with a clean form.
  useEffect(() => {
    if (open) { setStep(initialStep); setSubmitState('idle'); }
  }, [open, initialStep]);

  const toggleTool = (key: string) =>
    setSelectedTools(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));

  const canSend = selectedTools.length > 0 || toolsOther.trim().length > 0;

  const tryAskAi = () => { onClose(); navigate('/chat'); };

  const send = async () => {
    if (!canSend || !user || submitState === 'sending') return;
    setSubmitState('sending');
    try {
      await submitIntegrationRequest({
        userId: user.id,
        organizationId: currentCompany?.organization_id ?? null,
        tools: selectedTools,
        other: toolsOther,
        note: toolsNote,
        replyTo: user.email ?? '',
      });
      setSubmitState('idle');
      setSelectedTools([]);
      setToolsOther('');
      setToolsNote('');
      setStep('done');
    } catch (err) {
      console.error('integration request failed:', err);
      setSubmitState('error');
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogPortal>
        <DialogOverlay className="z-[60] bg-[rgba(19,39,79,.38)] backdrop-blur-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[61] w-[calc(100%-48px)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[18px] border border-[#13274F]/[0.12] bg-white shadow-[0_24px_60px_rgba(19,39,79,.22)] focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2 data-[state=open]:duration-300"
        >
          <DialogPrimitive.Title className="sr-only">
            {step === 'intro' ? 'New in PerceptionX' : step === 'form' ? 'Which assistants does your team use?' : 'Thanks — we will be in touch'}
          </DialogPrimitive.Title>

          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/85 text-[#6b7280] transition-colors hover:bg-[#f4f4f5] hover:text-[#13274F]"
          >
            <X className="h-[15px] w-[15px]" />
          </DialogPrimitive.Close>

          {step === 'intro' && (
            <>
              {/* Header band */}
              <div
                className="relative h-[184px] overflow-hidden border-b border-[#13274F]/10"
                style={{ background: 'radial-gradient(125% 130% at 100% -10%, #D8EFF0, #ECF8F8 34%, #fff 78%)' }}
              >
                <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 520 184" fill="none">
                  {[62, 94, 126].map(r => (
                    <circle key={r} cx="486" cy="0" r={r} stroke="#DB5E89" strokeOpacity="0.2" strokeDasharray="5 7" />
                  ))}
                </svg>
                <AskAiDemo />
              </div>

              {/* Title */}
              <div className="px-6 pt-5">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#DB5E89]">New in PerceptionX</div>
                <h2 className="mt-1 font-headline text-[21px] font-bold leading-[1.25] tracking-[-0.02em] text-[#13274F]">
                  You can now ask PerceptionX questions
                </h2>
              </div>

              {/* Feature cards */}
              <div className="flex flex-col gap-3 px-6 pt-4">
                <div className="flex gap-3 rounded-xl border border-[#e5e7eb] p-[14px]">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[#0DBCBA]/[0.12] text-[#0F6E6D]">
                    <Sparkles className="h-[17px] w-[17px]" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#13274F]">Ask AI, on every dashboard</div>
                    <p className="mt-0.5 text-[13px] leading-[1.5] text-[#6b7280] [text-wrap:pretty]">
                      Ask about sentiment, sources, competitors or themes in plain language. Answers are scoped to the company, market and function you are looking at, and every one cites its sources.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 rounded-xl border border-[#e5e7eb] p-[14px]">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[#DB5E89]/[0.12] text-[#DB5E89]">
                    <Plug className="h-[17px] w-[17px]" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#13274F]">Connect PerceptionX to your AI assistant</div>
                    <p className="mt-0.5 text-[13px] leading-[1.5] text-[#6b7280] [text-wrap:pretty]">
                      Connect your PerceptionX data to ChatGPT, Microsoft Copilot, Claude or Gemini and ask from there — "how is our sentiment trending in EMEA", "which sources mention our interview process", "summarise this quarter for the board".
                    </p>
                    <div className="mt-[9px] flex flex-wrap gap-1.5">
                      {INTRO_ASSISTANTS.map(a => (
                        <span key={a.key} className="inline-flex items-center gap-1.5 rounded-lg border border-[#13274F]/[0.12] bg-white px-2 py-[3px] text-[11.5px] text-[#13274F]">
                          <Favicon domain={a.domain} size="sm" className="!h-[13px] !w-[13px] rounded-sm" />
                          {a.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2.5 px-6 pb-5 pt-[18px]">
                <button type="button" onClick={tryAskAi} className={navyBtn}>Try Ask AI</button>
                <button type="button" onClick={() => setStep('form')} className={outlineBtn}>Tell us what you use</button>
              </div>
            </>
          )}

          {step === 'form' && (
            <>
              <div className="px-6 pt-[18px]">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#DB5E89]">Integrations · Early access</div>
                <h2 className="mt-1 font-headline text-[19px] font-bold leading-[1.3] tracking-[-0.02em] text-[#13274F]">
                  Which assistants does your team use?
                </h2>
                <p className="mt-1 text-[13px] leading-[1.5] text-[#6b7280]">
                  Tell us where you want PerceptionX data and we will get in touch when your connector is ready.
                </p>

                <div className="mt-[14px] flex flex-wrap gap-[7px]">
                  {FORM_TOOLS.map(t => {
                    const on = selectedTools.includes(t.key);
                    return (
                      <button
                        key={t.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleTool(t.key)}
                        className={cn(
                          'inline-flex h-8 items-center gap-1.5 rounded-full border px-[11px] text-[12.5px] text-[#13274F] transition-colors',
                          on ? 'border-[#DB5E89] bg-[#DB5E89]/[0.08] font-semibold' : 'border-[#13274F]/[0.14] bg-white font-normal hover:border-[#DB5E89]/60'
                        )}
                      >
                        <Favicon domain={t.domain} size="sm" className="!h-3.5 !w-3.5 rounded-sm" />
                        {t.name}
                      </button>
                    );
                  })}
                </div>

                <input
                  value={toolsOther}
                  onChange={e => setToolsOther(e.target.value)}
                  placeholder="Anything else — internal tools, agents, BI…"
                  className={cn(fieldClass, 'mt-2.5 h-10 px-3')}
                />
                <textarea
                  value={toolsNote}
                  onChange={e => setToolsNote(e.target.value)}
                  rows={2}
                  placeholder="What would you ask it? (optional)"
                  className={cn(fieldClass, 'mt-2 resize-none px-3 py-2.5')}
                />
                <div className="mt-2.5 flex items-center gap-1.5 text-xs text-[#9ca3af]">
                  <Mail className="h-[13px] w-[13px]" />
                  We will reply to {user?.email ?? 'your account email'}
                </div>
                {submitState === 'error' && (
                  <div className="mt-2.5 inline-flex h-8 items-center rounded-full border border-[#dc2626]/40 bg-[#dc2626]/[0.06] px-3 text-[12.5px] text-[#b91c1c]">
                    Could not send that — please try again.
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2.5 px-6 pb-5 pt-4">
                <button type="button" onClick={send} disabled={!canSend || submitState === 'sending'} className={navyBtn}>
                  {submitState === 'sending' ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</>) : 'Send'}
                </button>
                <button type="button" onClick={() => setStep('intro')} className={backBtn}>Back</button>
                <span className="ml-auto text-xs text-[#9ca3af]">
                  {selectedTools.length === 0 ? 'Pick any that apply' : `${selectedTools.length} selected`}
                </span>
              </div>
            </>
          )}

          {step === 'done' && (
            <>
              <div className="flex flex-col items-center gap-2.5 px-6 pb-2 pt-[26px] text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0DBCBA]/[0.14] text-[#0F6E6D]">
                  <Check className="h-5 w-5" />
                </span>
                <h2 className="font-headline text-[19px] font-bold leading-[1.3] tracking-[-0.02em] text-[#13274F]">Thanks — we will be in touch</h2>
                <p className="max-w-[360px] text-[13px] leading-[1.5] text-[#6b7280]">
                  Your team is on the early-access list. In the meantime, Ask AI is live on every dashboard.
                </p>
              </div>
              <div className="flex justify-center gap-2.5 px-6 pb-[22px] pt-4">
                <button type="button" onClick={tryAskAi} className={navyBtn}>Try Ask AI</button>
                <button type="button" onClick={onClose} className={outlineBtn}>Back to dashboard</button>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
