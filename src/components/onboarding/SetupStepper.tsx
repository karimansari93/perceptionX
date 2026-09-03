import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shared look for the first-login setup surfaces (/welcome and the
// ProfileSetupGate): one question per step, a progress row, Back / primary
// action in the footer.

export const SETUP_PAGE_BG = 'linear-gradient(135deg, #f7dee7 0%, #fbeaf0 45%, #eef1f8 100%)';
export const setupSans = { fontFamily: 'Plus Jakarta Sans, sans-serif' };
export const setupDisplay = { fontFamily: 'Geologica, sans-serif' };
export const setupInputClass =
  'h-11 rounded-xl border-gray-200 bg-white placeholder:text-gray-300 placeholder:font-light focus-visible:ring-2 focus-visible:ring-pink/25 focus-visible:border-pink transition';

interface SetupStepperProps {
  // Surface-specific hero content (logo, headline, inviter chip).
  hero: ReactNode;
  stepIndex: number; // 0-based
  stepCount: number;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  // Primary action for this step (button element).
  action: ReactNode;
  // Optional small print under the card body (e.g. Privacy / Terms links).
  footnote?: ReactNode;
  children: ReactNode;
}

export const SetupStepper = ({
  hero,
  stepIndex,
  stepCount,
  title,
  subtitle,
  onBack,
  action,
  footnote,
  children,
}: SetupStepperProps) => (
  <div className="min-h-screen w-screen flex items-center justify-center p-6" style={{ background: SETUP_PAGE_BG }}>
    <div className="w-full max-w-[440px] bg-white rounded-3xl shadow-[0_24px_70px_-20px_rgba(19,39,79,0.3)] overflow-hidden">
      <div className="bg-gradient-to-br from-pink/15 via-white to-[#13274F]/5 px-8 pt-9 pb-6 text-center border-b border-gray-100/80">
        {hero}
        {stepCount > 1 && (
          <div className="mt-5 flex items-center justify-center gap-3" style={setupSans}>
            <div className="flex items-center gap-1.5" aria-hidden>
              {Array.from({ length: stepCount }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    i === stepIndex ? 'w-6 bg-pink' : i < stepIndex ? 'w-3 bg-pink/50' : 'w-3 bg-gray-200',
                  )}
                />
              ))}
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Step {stepIndex + 1} of {stepCount}
            </span>
          </div>
        )}
      </div>

      <div className="px-8 py-7 space-y-5" style={setupSans}>
        <div>
          <h2 className="text-[18px] font-bold text-nightsky leading-tight" style={setupDisplay}>
            {title}
          </h2>
          {subtitle && <p className="mt-1.5 text-[13px] text-nightsky/60 leading-relaxed">{subtitle}</p>}
        </div>

        {children}

        <div className="flex items-center justify-between gap-3 pt-1">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-400 hover:text-nightsky transition"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          ) : (
            <span />
          )}
          <div className="flex-1 max-w-[240px]">{action}</div>
        </div>
      </div>

      {footnote && (
        <div className="px-8 pb-6 -mt-2" style={setupSans}>
          {footnote}
        </div>
      )}
    </div>
  </div>
);
