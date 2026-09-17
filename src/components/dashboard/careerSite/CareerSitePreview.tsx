// The Career Site tab's left pane: the client's own page, with the passages
// AI quoted highlighted on it.
//
// Why this is not an iframe pointed at the live site: it cannot be. Every
// career site we checked sends X-Frame-Options DENY or SAMEORIGIN
// (pepsicojobs.com, careers.ford.com, jobs.netflix.com, disneycareers.com,
// careers.microsoft.com), so a cross-origin frame renders an empty box. The
// preview renders a stored capture from our own origin instead.
//
// Serving our own copy is what makes the highlighting possible at all. The
// capture's DOM is ours to walk, so a quoted passage can be located and
// measured at its real coordinates; a cross-origin frame would expose none of
// that even if it loaded.
//
// Safety: the capture arrives already sanitized (scripts, frames, plugin
// objects, inline handlers and javascript: URLs stripped server-side — see
// supabase/functions/capture-career-site). This is the second layer: the
// frame is sandboxed WITHOUT allow-scripts, so nothing in the markup can
// execute even if the sanitizer is one day out-run. `allow-same-origin` is
// present only so the parent can read the document to measure it; without
// allow-scripts it grants the capture no capability of its own.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import {
  boxesForRange, describeRange, findRangeInDocument, parseTextFragment,
  type HighlightBox,
} from '@/lib/careerSite/textFragment';
import type { CareerSitePassageRow } from '@/hooks/dashboard/dashboardQueries';
import { getLLMDisplayName } from '@/config/llmLogos';

// Captures are taken at desktop width; the pane scales the whole thing down
// to fit rather than reflowing it, so what a client sees matches their site.
const CAPTURE_WIDTH = 1280;

interface CaptureRow {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  html: string | null;
  screenshot_url: string | null;
  error: string | null;
  captured_at: string | null;
}

export interface PlacedPassage {
  key: string;
  label: string;
  model: string;
  occurrences: number;
  boxes: HighlightBox[];
  /** False when the passage no longer appears in the captured page. */
  located: boolean;
}

interface CareerSitePreviewProps {
  /** The profile a new capture is written against. */
  companyId: string | undefined;
  /**
   * The whole brand scope. A brand is measured as one profile per market
   * (PepsiCo has a dozen), and they share one career site — so a capture is
   * looked up across all of them, or switching market would show an
   * uncaptured page that is already stored under a sibling.
   */
  scopeCompanyIds: string[];
  url: string | null;
  passages: CareerSitePassageRow[];
  passagesLoading: boolean;
  onPlacedPassages?: (placed: PlacedPassage[]) => void;
  activePassageKey?: string | null;
}

export function CareerSitePreview({
  companyId, scopeCompanyIds, url, passages, passagesLoading, onPlacedPassages, activePassageKey,
}: CareerSitePreviewProps) {
  const [capture, setCapture] = useState<CaptureRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameHeight, setFrameHeight] = useState(900);
  const [scale, setScale] = useState(1);
  const [placed, setPlaced] = useState<PlacedPassage[]>([]);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  // ── Load the stored capture for this page.
  useEffect(() => {
    let cancelled = false;
    setPlaced([]);
    setCapture(null);
    setError(null);
    const lookupIds = scopeCompanyIds.length > 0 ? scopeCompanyIds : companyId ? [companyId] : [];
    if (lookupIds.length === 0 || !url) return;

    setLoading(true);
    void (async () => {
      const { data, error: qError } = await supabase
        .from('career_site_captures')
        .select('id, status, html, screenshot_url, error, captured_at')
        .in('company_id', lookupIds)
        .eq('url', url)
        .order('captured_at', { ascending: false, nullsFirst: false })
        .limit(1);
      if (cancelled) return;
      setLoading(false);
      if (qError) { setError(qError.message); return; }
      setCapture((data?.[0] as CaptureRow) ?? null);
    })();

    return () => { cancelled = true; };
  }, [companyId, scopeCompanyIds, url]);

  const requestCapture = useCallback(async () => {
    if (!companyId || !url) return;
    setCapturing(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('capture-career-site', {
        body: { companyId, url, force: true },
      });
      if (fnError) throw fnError;
      if (data?.status === 'failed') throw new Error(data.error ?? 'Capture failed');

      const { data: rows } = await supabase
        .from('career_site_captures')
        .select('id, status, html, screenshot_url, error, captured_at')
        .eq('company_id', companyId)
        .eq('url', url)
        .limit(1);
      setCapture((rows?.[0] as CaptureRow) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture failed');
    } finally {
      setCapturing(false);
    }
  }, [companyId, url]);

  // ── Fit the capture's fixed width to the pane.
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const fit = () => {
      const available = shell.clientWidth;
      setScale(available > 0 ? Math.min(1, available / CAPTURE_WIDTH) : 1);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [capture?.id]);

  const parsedPassages = useMemo(
    () => passages.map((p, i) => ({
      key: `${p.fragment}:${p.ai_model}:${i}`,
      ranges: parseTextFragment(p.fragment),
      model: p.ai_model,
      occurrences: Number(p.occurrences) || 0,
    })).filter((p) => p.ranges.length > 0),
    [passages],
  );

  // ── Measure: locate each quoted passage in the rendered capture.
  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const body = doc?.body;
    if (!doc || !body) return;

    setFrameHeight(Math.max(doc.documentElement?.scrollHeight ?? 0, body.scrollHeight, 400));

    const next: PlacedPassage[] = parsedPassages.map((p) => {
      const boxes: HighlightBox[] = [];
      for (const range of p.ranges) {
        const domRange = findRangeInDocument(body, range);
        if (domRange) boxes.push(...boxesForRange(body, domRange));
      }
      return {
        key: p.key,
        label: p.ranges.map(describeRange).join(' / '),
        model: p.model,
        occurrences: p.occurrences,
        boxes,
        located: boxes.length > 0,
      };
    });
    setPlaced(next);
  }, [parsedPassages]);

  // Re-measure once the frame settles: no scripts run inside it, but images
  // and webfonts still land after load and move the text. An onLoad handler's
  // return value is ignored by React, so the timers are tracked on a ref and
  // cleared on unmount rather than by a cleanup function that never runs.
  const remeasureTimers = useRef<number[]>([]);
  const clearRemeasure = useCallback(() => {
    remeasureTimers.current.forEach(window.clearTimeout);
    remeasureTimers.current = [];
  }, []);

  const handleFrameLoad = useCallback(() => {
    measure();
    clearRemeasure();
    remeasureTimers.current = [150, 600, 1500].map((ms) => window.setTimeout(measure, ms));
  }, [measure, clearRemeasure]);

  useEffect(() => { measure(); }, [measure]);
  useEffect(() => clearRemeasure, [clearRemeasure]);

  useEffect(() => { onPlacedPassages?.(placed); }, [placed, onPlacedPassages]);

  // ── States before there is anything to render.
  if (!url) {
    return (
      <EmptyPane>
        Pick a page from the inventory to see it with the passages AI quoted highlighted on it.
      </EmptyPane>
    );
  }

  if (loading) {
    return <EmptyPane><Loader2 className="h-4 w-4 animate-spin" /> Loading capture…</EmptyPane>;
  }

  if (!capture || capture.status !== 'ready' || !capture.html) {
    return (
      <EmptyPane>
        <div className="max-w-md space-y-3 text-center">
          <Camera className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {capture?.status === 'failed'
              ? `The last capture of this page failed: ${capture.error ?? 'unknown error'}`
              : 'This page has not been captured yet. Career sites block embedding, so the preview renders a stored capture rather than the live site.'}
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button size="sm" onClick={requestCapture} disabled={capturing}>
            {capturing
              ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Capturing…</>
              : <><Camera className="mr-2 h-3.5 w-3.5" /> Capture this page</>}
          </Button>
        </div>
      </EmptyPane>
    );
  }

  const locatedCount = placed.filter((p) => p.located).length;
  const missingCount = placed.length - locatedCount;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
        <Badge variant="secondary" className="font-normal">
          Captured {capture.captured_at ? new Date(capture.captured_at).toLocaleDateString() : '—'}
        </Badge>
        {passagesLoading ? (
          <span className="text-muted-foreground">Loading quoted passages…</span>
        ) : placed.length > 0 ? (
          <span className="text-muted-foreground">
            {locatedCount} quoted {locatedCount === 1 ? 'passage' : 'passages'} highlighted
            {missingCount > 0 && ` · ${missingCount} no longer on the page`}
          </span>
        ) : (
          <span className="text-muted-foreground">
            No Google-quoted passages recorded for this page
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={requestCapture} disabled={capturing} className="h-7 px-2">
            {capturing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1.5">Re-capture</span>
          </Button>
          <Button variant="ghost" size="sm" asChild className="h-7 px-2">
            <a href={url} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="ml-1.5">Open live</span>
            </a>
          </Button>
        </div>
      </div>

      <div ref={shellRef} className="relative flex-1 overflow-auto bg-muted/30">
        {/* The scaled stage: frame and overlay share one coordinate space, so
            the highlight boxes need no scaling arithmetic of their own. */}
        <div
          style={{
            width: CAPTURE_WIDTH,
            height: frameHeight,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          className="relative"
        >
          <iframe
            ref={frameRef}
            title="Career site capture"
            srcDoc={capture.html}
            onLoad={handleFrameLoad}
            // NEVER add allow-scripts here. `allow-same-origin` alone lets the
            // parent read this document to measure it while keeping the
            // capture inert; adding allow-scripts to a same-origin frame
            // would execute third-party markup with our app's privileges.
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            width={CAPTURE_WIDTH}
            height={frameHeight}
            className="block border-0 bg-white"
          />
          <div className="pointer-events-none absolute inset-0">
            {placed.flatMap((p) =>
              p.boxes.map((box, i) => (
                <div
                  key={`${p.key}-${i}`}
                  className={
                    activePassageKey === p.key
                      ? 'absolute rounded-sm ring-2 ring-offset-1'
                      : 'absolute rounded-sm'
                  }
                  style={{
                    top: box.top, left: box.left, width: box.width, height: box.height,
                    backgroundColor: activePassageKey === p.key
                      ? 'rgba(13, 188, 186, 0.38)'
                      : 'rgba(13, 188, 186, 0.20)',
                    boxShadow: 'inset 0 0 0 1px rgba(13, 188, 186, 0.55)',
                  }}
                />
              )),
            )}
          </div>
        </div>
        {/* Reserve the scaled height so the pane scrolls to the page's end. */}
        <div style={{ height: frameHeight * scale }} aria-hidden />
      </div>
    </div>
  );
}

function EmptyPane({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function passageModelLabel(model: string): string {
  return getLLMDisplayName(model) || model;
}

export function PassageWarning() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>
        Highlights show passages Google AI Overviews and AI Mode quoted verbatim. No other
        platform reports which part of a page it used, so an unhighlighted section is
        simply unmeasured — not unused.
      </p>
    </div>
  );
}
