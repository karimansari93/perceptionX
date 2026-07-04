// Public client onboarding at /onboarding/:token — authenticated by the invite
// token alone (no login). The project is already named for the client; there is
// no company or email field anywhere in this flow.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { getOnboardingByToken, OnboardingTokenState } from '@/lib/onboarding/api';
import { emptyOnboardingPayload, OnboardingPayload } from '@/lib/onboarding/types';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'invalid'; reason: 'not_found' | 'expired' | 'error' }
  | { kind: 'submitted'; companyName: string }
  | { kind: 'ready'; state: OnboardingTokenState };

export default function Onboarding() {
  const { token } = useParams<{ token: string }>();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  useDocumentTitle('Project setup');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setLoad({ kind: 'invalid', reason: 'not_found' });
        return;
      }
      const res = await getOnboardingByToken(token);
      if (cancelled) return;
      if (res.error === 'not_found') setLoad({ kind: 'invalid', reason: 'not_found' });
      else if (res.error === 'expired') setLoad({ kind: 'invalid', reason: 'expired' });
      else if (res.error || !res.state) setLoad({ kind: 'invalid', reason: 'error' });
      else if (res.state.submitted)
        setLoad({ kind: 'submitted', companyName: res.state.company_name });
      else setLoad({ kind: 'ready', state: res.state });
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (load.kind === 'loading') {
    return (
      <Shell>
        <p className="text-sm text-slate-500" role="status">
          Setting things up…
        </p>
      </Shell>
    );
  }

  if (load.kind === 'invalid') {
    return (
      <Shell>
        <div className="max-w-md text-center space-y-2">
          <h1 className="font-headline font-semibold text-nightsky text-lg">
            {load.reason === 'expired' ? 'This link has expired' : 'This link isn’t working'}
          </h1>
          <p className="text-sm text-slate-600">
            {load.reason === 'expired'
              ? 'Onboarding links are live for 14 days. Ask your PerceptionX contact to send a fresh one — it takes them a minute.'
              : 'Check the link matches the one in your invite email. If it does, ask your PerceptionX contact for a fresh one.'}
          </p>
        </div>
      </Shell>
    );
  }

  if (load.kind === 'submitted') {
    return (
      <Shell>
        <div className="max-w-md text-center space-y-2">
          <h1 className="font-headline font-semibold text-nightsky text-lg">
            Your brief for {load.companyName} is already in
          </h1>
          <p className="text-sm text-slate-600">
            Thank you — our team is reviewing it. We'll be in touch at the address we have on
            file.
          </p>
        </div>
      </Shell>
    );
  }

  const companyName = load.state.company_name;
  const initial: OnboardingPayload = emptyOnboardingPayload(companyName, '');

  return (
    <OnboardingWizard
      token={token!}
      companyName={companyName}
      initialDraft={load.state.draft}
      initialPayload={initial}
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-white to-[#F6F7FB] flex items-center justify-center p-6">
      {children}
    </div>
  );
}
