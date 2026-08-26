import { onCLS, onINP, onLCP, type Metric } from 'web-vitals';

// Real-user performance telemetry into the existing GA property. INP is the
// one to watch: it is exactly the "clicked a filter and the page froze"
// metric (the measured 12s main-thread block on Ford-scope job-function
// switches shows up here). Values are ms (CLS ×1000 to keep integers).
const send = (metric: Metric) => {
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (!gtag) return;
  gtag('event', metric.name, {
    value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
    metric_id: metric.id,
    metric_rating: metric.rating,
    non_interaction: true,
  });
};

export const initVitals = () => {
  try {
    onINP(send);
    onLCP(send);
    onCLS(send);
  } catch {
    // Never let telemetry break the app.
  }
};
