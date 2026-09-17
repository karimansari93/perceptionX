// Career Site tab — which parts of a client's own career site are doing the
// work in AI answers, and which topics someone else answers instead.
//
// The tab is built around one finding: sentiment does not separate a client's
// career-site pages (they all sit in the same narrow band, because an answer
// citing the career site almost always mentions the brand), but citation
// ownership separates them sharply. So the headline is topic ownership — the
// share of answers on a topic citing the career site against the share citing
// a review or job-board site — and pages are ranked by citation share, not by
// tone.

import { memo, useCallback, useMemo, useState } from 'react';
import {
  ArrowDownRight, ArrowUpRight, ExternalLink, FileText,
  Globe, Info, Minus, Quote, Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Favicon } from '@/components/ui/favicon';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DataUnavailable } from './DataUnavailable';
import { CareerSitePreview, PassageWarning, passageModelLabel, type PlacedPassage } from './careerSite/CareerSitePreview';
import { useCareerSite, useCareerSitePassages, type CareerSitePage } from '@/hooks/useCareerSite';
import type { CubeLocationParams } from '@/hooks/dashboard/dashboardQueries';
import { SEVERITY_LABEL, type ActionSeverity, type CareerSiteAction } from '@/lib/careerSite/actions';

const OWNED_COLOR = '#0DBCBA';
const BENCHMARK_COLOR = '#F59E0B';

const SEVERITY_STYLES: Record<ActionSeverity, { badge: string; bar: string }> = {
  critical: { badge: 'bg-red-100 text-red-800 border-red-200', bar: 'bg-red-500' },
  warning: { badge: 'bg-amber-100 text-amber-800 border-amber-200', bar: 'bg-amber-500' },
  watch: { badge: 'bg-slate-100 text-slate-700 border-slate-200', bar: 'bg-slate-400' },
  strength: { badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', bar: 'bg-emerald-500' },
};

interface CareerSiteTabProps {
  companyName?: string;
  currentCompanyId?: string;
  scopeCompanyIds: string[];
  cubeParams: CubeLocationParams;
  scopeKey: string;
  locationKey: string;
  cubeQuarterKey?: string | null;
  cubePrevQuarterKey?: string | null;
  enabled?: boolean;
}

export const CareerSiteTab = memo(function CareerSiteTab({
  companyName, currentCompanyId, scopeCompanyIds, cubeParams, scopeKey,
  locationKey, cubeQuarterKey, cubePrevQuarterKey, enabled = true,
}: CareerSiteTabProps) {
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [placedPassages, setPlacedPassages] = useState<PlacedPassage[]>([]);
  const [activePassageKey, setActivePassageKey] = useState<string | null>(null);

  const {
    domains, primaryDomain, pages, ownership, actions,
    isLoading, isError, refetch,
  } = useCareerSite({
    params: cubeParams,
    scopeKey,
    locationKey,
    quarterKey: cubeQuarterKey ?? null,
    prevQuarterKey: cubePrevQuarterKey ?? null,
    enabled,
  });

  const passagesQuery = useCareerSitePassages(scopeCompanyIds, scopeKey, selectedUrl);

  // Default to the most-cited durable content page: a job requisition is a
  // poor first impression of a career site and it expires.
  const defaultUrl = useMemo(
    () => pages.find((p) => p.pageKind === 'content')?.url ?? pages[0]?.url ?? null,
    [pages],
  );
  const activeUrl = selectedUrl ?? defaultUrl;

  const handlePlaced = useCallback((placed: PlacedPassage[]) => setPlacedPassages(placed), []);

  const contentPages = useMemo(() => pages.filter((p) => p.pageKind === 'content'), [pages]);
  const jobPages = useMemo(() => pages.filter((p) => p.pageKind === 'job_posting'), [pages]);

  if (isError) {
    return (
      <div className="p-6">
        <DataUnavailable
          title="Couldn't load career site data."
          description="The career-site cubes failed to load for this scope."
          onRetry={refetch}
        />
      </div>
    );
  }

  if (!isLoading && domains.length === 0) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Globe className="h-7 w-7 text-muted-foreground" />
            <div>
              <p className="font-medium">No career site detected for {companyName ?? 'this company'}</p>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                A career site is detected from the domains AI platforms cite — it needs a host
                carrying both the brand name and a careers path (for example
                <code className="mx-1 rounded bg-muted px-1">pepsicojobs.com</code>
                or <code className="mx-1 rounded bg-muted px-1">careers.ford.com</code>).
                If this brand's career site uses an unrelated domain, set
                <code className="mx-1 rounded bg-muted px-1">career_site_domains</code>
                on the company record and it will be picked up on the next refresh.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4 p-4 md:p-6">
        {/* ── Property header ─────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            {primaryDomain && <Favicon domain={primaryDomain} size="lg" />}
            <div>
              <h2 className="text-lg font-semibold leading-tight">
                {primaryDomain ?? 'Career site'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {domains.length > 1
                  ? `${domains.length} domains in this career site property`
                  : 'Career site property'}
                {pages.length > 0 && ` · ${pages.length} cited pages`}
              </p>
            </div>
          </div>
          {domains.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {domains.slice(1, 5).map((d) => (
                <Badge key={d.domain} variant="outline" className="font-normal">
                  {d.domain}
                  {d.source === 'override' && <span className="ml-1 text-[10px]">(set)</span>}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* ── Topic ownership: the headline ───────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              Who answers each topic
              <Tooltip>
                <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  For each topic, the share of measured answers citing your career site against
                  the share citing a review or job-board site. An answer can cite both, so the
                  two bars are independent — they do not sum to 100%.
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <SkeletonRows rows={6} />
            ) : ownership.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No topic data measured for this selection yet.
              </p>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground">
                  <LegendSwatch color={OWNED_COLOR} label="Your career site" />
                  <LegendSwatch color={BENCHMARK_COLOR} label="Review / job-board sites" />
                </div>
                <div className="space-y-2.5">
                  {ownership.map((topic) => (
                    <div key={topic.attributeId} className="grid grid-cols-[minmax(130px,1.2fr)_3fr_auto] items-center gap-3">
                      <span className="truncate text-sm" title={topic.attributeName}>
                        {topic.attributeName}
                      </span>
                      <div className="space-y-1">
                        <Bar value={topic.ownedShare} color={OWNED_COLOR} />
                        <Bar value={topic.benchmarkShare} color={BENCHMARK_COLOR} />
                      </div>
                      <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">
                        {Math.round(topic.ownedShare)}% vs {Math.round(topic.benchmarkShare)}%
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Preview + actions ───────────────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.9fr)_minmax(320px,1fr)]">
          <Card className="flex min-h-[640px] flex-col overflow-hidden">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-base">Pages AI cites</CardTitle>
              <PageSelect
                pages={contentPages}
                jobPages={jobPages}
                value={activeUrl}
                onChange={(url) => { setSelectedUrl(url); setActivePassageKey(null); }}
              />
            </CardHeader>
            <CardContent className="flex-1 p-0">
              <CareerSitePreview
                companyId={currentCompanyId}
                scopeCompanyIds={scopeCompanyIds}
                url={activeUrl}
                passages={passagesQuery.data ?? []}
                passagesLoading={passagesQuery.isPending && !!activeUrl}
                onPlacedPassages={handlePlaced}
                activePassageKey={activePassageKey}
              />
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4" /> Recommended actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  <SkeletonRows rows={4} />
                ) : actions.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    Not enough measured answers per topic yet to raise an action.
                  </p>
                ) : (
                  actions.map((action) => <ActionCard key={action.id} action={action} />)
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Quote className="h-4 w-4" /> Quoted on this page
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <PassageWarning />
                {placedPassages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No passages from this page have been quoted verbatim by a Google surface
                    in the measured window.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {placedPassages.map((p) => (
                      <li key={p.key}>
                        <button
                          type="button"
                          onMouseEnter={() => setActivePassageKey(p.key)}
                          onMouseLeave={() => setActivePassageKey(null)}
                          onClick={() => setActivePassageKey(p.key)}
                          className="w-full rounded-md border p-2 text-left text-xs transition hover:bg-muted/60"
                        >
                          <span className="line-clamp-3">“{p.label}”</span>
                          <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Badge variant="outline" className="font-normal">
                              {passageModelLabel(p.model)}
                            </Badge>
                            {p.located
                              ? <span>highlighted</span>
                              : <span className="text-amber-700">no longer on the page</span>}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
});

// ─── Pieces ─────────────────────────────────────────────────────────────────

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-sm bg-muted">
      <div
        className="h-full rounded-sm transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }}
      />
    </div>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

function ActionCard({ action }: { action: CareerSiteAction }) {
  const styles = SEVERITY_STYLES[action.severity];
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{action.headline}</p>
        <Badge variant="outline" className={`shrink-0 font-normal ${styles.badge}`}>
          {SEVERITY_LABEL[action.severity]}
        </Badge>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{action.detail}</p>
      <p className="mt-2 text-xs leading-relaxed">{action.recommendation}</p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Based on {action.answers} measured answers on this topic.
      </p>
    </div>
  );
}

function PageSelect({
  pages, jobPages, value, onChange,
}: {
  pages: CareerSitePage[];
  jobPages: CareerSitePage[];
  value: string | null;
  onChange: (url: string) => void;
}) {
  const [showJobs, setShowJobs] = useState(false);
  const list = showJobs ? jobPages : pages;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setShowJobs(false)}
          className={`rounded px-2 py-1 ${!showJobs ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
        >
          Content pages ({pages.length})
        </button>
        <button
          type="button"
          onClick={() => setShowJobs(true)}
          className={`rounded px-2 py-1 ${showJobs ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
        >
          Job postings ({jobPages.length})
        </button>
      </div>
      <div className="max-h-44 space-y-1 overflow-auto pr-1">
        {list.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            {showJobs ? 'No job postings cited in this window.' : 'No content pages cited in this window.'}
          </p>
        ) : (
          list.slice(0, 40).map((page) => (
            <button
              key={page.url}
              type="button"
              onClick={() => onChange(page.url)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-muted/60 ${
                value === page.url ? 'bg-muted' : ''
              }`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={page.title ?? page.url}>
                {page.title ?? prettyPath(page.url)}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {page.share >= 0.1 ? `${page.share.toFixed(1)}%` : '<0.1%'}
              </span>
              <TrendChip points={page.changePoints} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function TrendChip({ points }: { points: number | null }) {
  if (points === null || Math.abs(points) < 0.1) {
    return <Minus className="h-3 w-3 shrink-0 text-muted-foreground/60" />;
  }
  const up = points > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`flex shrink-0 items-center tabular-nums ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(points).toFixed(1)}
    </span>
  );
}

function prettyPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === '/' || u.pathname === '' ? u.hostname : u.pathname;
  } catch {
    return url;
  }
}
