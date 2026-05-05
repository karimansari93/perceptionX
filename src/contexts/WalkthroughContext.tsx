import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Joyride, { CallBackProps, EVENTS, STATUS, Step } from 'react-joyride';

type WalkthroughStep = Step & { route?: string };

interface WalkthroughContextValue {
  isRunning: boolean;
  start: () => void;
  stop: () => void;
}

const WalkthroughContext = createContext<WalkthroughContextValue | undefined>(undefined);

const STORAGE_KEY = 'perceptionx.walkthrough.completed';

const STEPS: WalkthroughStep[] = [
  {
    target: 'body',
    placement: 'center',
    title: 'Welcome to PerceptionX',
    content:
      "Quick tour of the dashboard — under a minute. You can close this anytime and reopen it from the sidebar.",
    disableBeacon: true,
    route: '/dashboard',
  },
  {
    target: '[data-tour="company-switcher"]',
    title: 'Pick a company',
    content: 'Switch between companies you have access to from the top bar.',
    disableBeacon: true,
    route: '/dashboard',
  },
  {
    target: '[data-tour="location-filter"]',
    title: 'Filter by country',
    content: 'Narrow the data to a specific market.',
    disableBeacon: true,
    route: '/dashboard',
  },
  {
    target: '[data-tour="saved-view"]',
    title: 'Save your view',
    content: 'Tap the star to save the current company, country and date combo as a view. Pinned views show up here for one-click access later.',
    disableBeacon: true,
    route: '/dashboard',
  },
  {
    target: '[data-tour="period-selector"]',
    title: 'Pick a date range',
    content: 'Compare against previous periods to see how perception is trending.',
    disableBeacon: true,
    route: '/dashboard',
  },
  {
    target: '[data-tour="eps-card"]',
    title: 'Your EPS score',
    content:
      'The Employer Perception Score blends sentiment, visibility and relevance signals into one number. Click on your scores to get an in-depth analysis.',
    disableBeacon: true,
    route: '/dashboard',
  },
  {
    target: '[data-tour="eps-breakdown"]',
    title: 'Score breakdown',
    content:
      'Click any breakdown card to see exactly what drives each score component.',
    disableBeacon: true,
    route: '/dashboard',
  },
  {
    target: '[data-tour="summary-row"]',
    title: 'Sources, Competitors & Themes',
    content:
      'The bottom row surfaces the most cited sources, mentioned competitors, and recurring themes. Click "View All" on any card to dig deeper.',
    placement: 'top',
    disableBeacon: true,
    route: '/dashboard',
  },
  {
    target: '[data-tour="competitors-first-row"]',
    title: 'Competitor mentions',
    content:
      'These are the competitors most frequently mentioned alongside your company. Click any row to see the actual mentions and context.',
    placement: 'bottom',
    disableBeacon: true,
    disableScrolling: true,
    route: '/dashboard/competitors',
  },
  {
    target: '[data-tour="sources-first-row"]',
    title: 'Sources',
    content:
      'Sources shows where your company is being mentioned across the web — ranked by how often each domain shows up. Click any source to see the pages and snippets driving those mentions.',
    placement: 'bottom',
    disableBeacon: true,
    disableScrolling: true,
    route: '/dashboard/sources',
  },
  {
    target: '[data-tour="themes-first-row"]',
    title: 'Themes',
    content:
      'Themes groups what AI is saying about you into topics. Sort by volume or sentiment to see what matters most, then click any theme to dig into the underlying mentions.',
    placement: 'bottom',
    disableBeacon: true,
    disableScrolling: true,
    route: '/dashboard/themes',
  },
  {
    target: 'body',
    placement: 'center',
    title: (
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: '#0DBCBA15',
            color: '#0DBCBA',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
            fontSize: 22,
          }}
          aria-hidden
        >
          ✓
        </div>
        <div>You're all set</div>
      </div>
    ),
    content: (
      <div>
        <p style={{ margin: 0, marginBottom: 14, textAlign: 'center' }}>
          That's the walkthrough. Dive in and start exploring — you can reopen this tour anytime from the sidebar.
        </p>
        <p style={{ margin: 0, fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
          Questions? Email{' '}
          <a href="mailto:karim@perceptionx.ai" style={{ color: '#0DBCBA', textDecoration: 'none', fontWeight: 500 }}>
            karim@perceptionx.ai
          </a>
        </p>
      </div>
    ),
    disableBeacon: true,
    route: '/dashboard',
  },
];

export function WalkthroughProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isRunning, setIsRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const pendingNavRef = useRef<number | null>(null);

  const start = useCallback(() => {
    setStepIndex(0);
    if (location.pathname !== '/dashboard') {
      navigate('/dashboard');
    }
    setIsRunning(true);
  }, [location.pathname, navigate]);

  const stop = useCallback(() => {
    setIsRunning(false);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {}
  }, []);

  // Resume after route change — poll until the target element is mounted
  // (lazy-loaded tabs aren't in the DOM immediately after navigation)
  useEffect(() => {
    if (pendingNavRef.current === null) return;

    const next = pendingNavRef.current;
    pendingNavRef.current = null;
    const targetSelector = STEPS[next]?.target;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 80; // ~8s at 100ms intervals

    const resume = () => {
      if (cancelled) return;
      const found =
        typeof targetSelector === 'string' && targetSelector !== 'body'
          ? document.querySelector(targetSelector)
          : true;

      if (found || attempts >= MAX_ATTEMPTS) {
        setStepIndex(next);
        setIsRunning(true);
        return;
      }

      attempts += 1;
      timeoutId = setTimeout(resume, 100);
    };

    timeoutId = setTimeout(resume, 100);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [location.pathname]);

  const handleCallback = useCallback(
    (data: CallBackProps) => {
      const { type, status, action, index } = data;

      if (status === STATUS.FINISHED || status === STATUS.SKIPPED || action === 'close') {
        stop();
        setStepIndex(0);
        return;
      }

      // Target missing — could be a lazy chunk still loading, OR an element
      // that never renders (e.g. PeriodSelector hides when only one period).
      // Poll briefly for it; if it never appears, advance past the step
      // instead of looping forever.
      if (type === EVENTS.TARGET_NOT_FOUND) {
        const targetSelector = STEPS[index]?.target;
        // eslint-disable-next-line no-console
        console.warn('[walkthrough] target not found for step', index, targetSelector);
        setIsRunning(false);
        let attempts = 0;
        const MAX = 30; // ~3s
        const retry = () => {
          const found =
            typeof targetSelector === 'string' && targetSelector !== 'body'
              ? document.querySelector(targetSelector)
              : true;
          if (found) {
            setStepIndex(index);
            setIsRunning(true);
            return;
          }
          if (attempts >= MAX) {
            // Give up on this step — advance to the next one.
            const advance = index + 1;
            // eslint-disable-next-line no-console
            console.warn('[walkthrough] giving up on step', index, '-> advancing to', advance);
            if (advance >= STEPS.length) {
              stop();
              setStepIndex(0);
              return;
            }
            const nextStep = STEPS[advance];
            const targetRoute = nextStep.route;
            if (targetRoute && targetRoute !== location.pathname) {
              pendingNavRef.current = advance;
              navigate(targetRoute);
            } else {
              setStepIndex(advance);
              setIsRunning(true);
            }
            return;
          }
          attempts += 1;
          setTimeout(retry, 100);
        };
        setTimeout(retry, 100);
        return;
      }

      if (type === EVENTS.STEP_AFTER) {
        const next = action === 'prev' ? index - 1 : index + 1;
        if (next < 0 || next >= STEPS.length) {
          stop();
          setStepIndex(0);
          return;
        }
        const nextStep = STEPS[next];
        const targetRoute = nextStep.route;
        if (targetRoute && targetRoute !== location.pathname) {
          setIsRunning(false);
          pendingNavRef.current = next;
          navigate(targetRoute);
        } else {
          setStepIndex(next);
        }
      }
    },
    [location.pathname, navigate, stop],
  );

  const value = useMemo(() => ({ isRunning, start, stop }), [isRunning, start, stop]);

  const decoratedSteps = useMemo(
    () =>
      STEPS.map((step, i) => ({
        ...step,
        title: (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Step {i + 1} of {STEPS.length}
            </div>
            <div>{step.title as React.ReactNode}</div>
          </div>
        ),
      })),
    [],
  );

  return (
    <WalkthroughContext.Provider value={value}>
      {children}
      <Joyride
        steps={decoratedSteps}
        run={isRunning}
        stepIndex={stepIndex}
        continuous
        showSkipButton
        disableOverlayClose
        scrollToFirstStep
        callback={handleCallback}
        locale={{ last: 'Done', skip: 'Close' }}
        styles={{
          options: {
            primaryColor: '#0DBCBA',
            zIndex: 10000,
            arrowColor: '#ffffff',
            backgroundColor: '#ffffff',
            textColor: '#13274F',
          },
          tooltip: { borderRadius: 12, padding: 16, fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif" },
          tooltipTitle: { fontSize: 16, fontWeight: 600 },
          tooltipContent: { fontSize: 13, lineHeight: 1.5, fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif", color: '#4b5563' },
          buttonNext: { borderRadius: 8, fontSize: 13, padding: '8px 14px' },
          buttonBack: { color: '#6b7280', fontSize: 13 },
          buttonSkip: { fontSize: 13 },
          buttonClose: { display: 'none' },
        }}
      />
    </WalkthroughContext.Provider>
  );
}

const NOOP_WALKTHROUGH: WalkthroughContextValue = {
  isRunning: false,
  start: () => {},
  stop: () => {},
};

export function useWalkthrough() {
  return useContext(WalkthroughContext) ?? NOOP_WALKTHROUGH;
}

export function hasCompletedWalkthrough() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
