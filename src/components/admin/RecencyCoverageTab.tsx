import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, RefreshCw, ArrowLeft, Play, ExternalLink, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';

interface CoverageRow {
  organization_id: string;
  organization_name: string;
  total_urls: number;
  cached_count: number;
  with_score_count: number;
  missing_from_cache_count: number;
  null_scored_count: number;
  method_url_pattern: number;
  method_firecrawl_metadata: number;
  method_firecrawl_relative: number;
  method_firecrawl_absolute: number;
  method_firecrawl_reddit: number;
  method_firecrawl_json: number;
  method_firecrawl_html: number;
  method_not_found: number;
  method_timeout: number;
  method_rate_limit_hit: number;
  method_problematic_domain: number;
  method_manual: number;
  method_evergreen: number;
  refreshed_at: string;
}

type View = 'overview' | 'drilldown' | 'manual';

export const RecencyCoverageTab = () => {
  const [view, setView] = useState<View>('overview');
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<CoverageRow | null>(null);

  useEffect(() => {
    loadCoverage();
  }, []);

  const loadCoverage = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('organization_recency_coverage_mv' as any)
      .select('*')
      .order('total_urls', { ascending: false });

    if (error) {
      toast.error(`Failed to load coverage: ${error.message}`);
      setRows([]);
    } else {
      setRows((data as unknown as CoverageRow[]) || []);
    }
    setLoading(false);
  };

  const refreshMvs = async () => {
    setRefreshing(true);
    const { error } = await supabase.rpc('refresh_organization_recency_coverage' as any);
    if (error) {
      toast.error(`Refresh failed: ${error.message}`);
    } else {
      toast.success('Coverage refreshed');
      await loadCoverage();
    }
    setRefreshing(false);
  };

  if (view === 'drilldown' && selectedOrg) {
    return (
      <OrgDrillDown
        org={selectedOrg}
        onBack={() => {
          setView('overview');
          setSelectedOrg(null);
        }}
        onOpenManual={() => setView('manual')}
      />
    );
  }

  if (view === 'manual' && selectedOrg) {
    return (
      <ManualReviewQueue
        org={selectedOrg}
        onBack={() => setView('drilldown')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Recency Coverage</h2>
          <p className="text-sm text-slate-500">
            Per-organization coverage of URL recency scoring across all citation sources.
          </p>
        </div>
        <Button
          onClick={refreshMvs}
          disabled={refreshing}
          variant="outline"
          size="sm"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No organizations found. Try clicking Refresh.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead className="text-right">URLs</TableHead>
                  <TableHead className="text-right">Scored</TableHead>
                  <TableHead className="text-right">Coverage</TableHead>
                  <TableHead className="text-right">Evergreen</TableHead>
                  <TableHead className="text-right">Missing cache</TableHead>
                  <TableHead className="text-right">Null scored</TableHead>
                  <TableHead>Firecrawl ROI</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const coverage = r.total_urls
                    ? (r.with_score_count / r.total_urls) * 100
                    : 0;
                  const firecrawlHits =
                    r.method_firecrawl_metadata +
                    r.method_firecrawl_relative +
                    r.method_firecrawl_absolute +
                    r.method_firecrawl_reddit +
                    r.method_firecrawl_json +
                    r.method_firecrawl_html;
                  const firecrawlAttempts =
                    firecrawlHits +
                    r.method_not_found +
                    r.method_timeout +
                    r.method_rate_limit_hit;
                  const roi = firecrawlAttempts
                    ? ((firecrawlHits / firecrawlAttempts) * 100).toFixed(0)
                    : '—';
                  return (
                    <TableRow key={r.organization_id}>
                      <TableCell className="font-medium">
                        {r.organization_name}
                      </TableCell>
                      <TableCell className="text-right">{r.total_urls}</TableCell>
                      <TableCell className="text-right">
                        {r.with_score_count}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="outline"
                          className={
                            coverage >= 80
                              ? 'border-green-300 text-green-700 bg-green-50'
                              : coverage >= 50
                              ? 'border-amber-300 text-amber-700 bg-amber-50'
                              : 'border-red-300 text-red-700 bg-red-50'
                          }
                        >
                          {coverage.toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-slate-600">
                        {r.method_evergreen ?? 0}
                      </TableCell>
                      <TableCell className="text-right text-slate-600">
                        {r.missing_from_cache_count}
                      </TableCell>
                      <TableCell className="text-right text-slate-600">
                        {r.null_scored_count}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {firecrawlHits}/{firecrawlAttempts}{' '}
                        <span className="text-slate-400">({roi}%)</span>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedOrg(r);
                            setView('drilldown');
                          }}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ============================================================================
// Drill-down: lists missing-from-cache and null-scored URLs for one org
// ============================================================================

interface UrlRow {
  url: string;
  recency_score: number | null;
  extraction_method: string | null;
  publication_date: string | null;
}

const BATCH_SIZE_RESCORE = 50;

const OrgDrillDown = ({
  org,
  onBack,
  onOpenManual,
}: {
  org: CoverageRow;
  onBack: () => void;
  onOpenManual: () => void;
}) => {
  const [missing, setMissing] = useState<string[]>([]);
  const [nullScored, setNullScored] = useState<UrlRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rescoring, setRescoring] = useState(false);

  useEffect(() => {
    loadUrls();
  }, [org.organization_id]);

  const loadUrls = async () => {
    setLoading(true);
    // Server-side LEFT JOIN via v_organization_url_status — avoids URI-length
    // issues from sending tens of thousands of URLs back through the API.
    const missingUrls: string[] = [];
    const nullRows: UrlRow[] = [];

    const pageSize = 1000;
    let from = 0;
    while (true) {
      // Missing from cache: extraction_method IS NULL
      const { data, error } = await supabase
        .from('v_organization_url_status' as any)
        .select('url, recency_score, extraction_method, publication_date')
        .eq('organization_id', org.organization_id)
        .is('extraction_method', null)
        .range(from, from + pageSize - 1);
      if (error) {
        toast.error(`Failed loading missing URLs: ${error.message}`);
        break;
      }
      const batch = (data as unknown as UrlRow[]) || [];
      missingUrls.push(...batch.map((b) => b.url));
      if (batch.length < pageSize) break;
      from += pageSize;
    }

    from = 0;
    while (true) {
      // Null-scored: cached but recency_score IS NULL
      const { data, error } = await supabase
        .from('v_organization_url_status' as any)
        .select('url, recency_score, extraction_method, publication_date')
        .eq('organization_id', org.organization_id)
        .not('extraction_method', 'is', null)
        .is('recency_score', null)
        .range(from, from + pageSize - 1);
      if (error) {
        toast.error(`Failed loading null-scored URLs: ${error.message}`);
        break;
      }
      const batch = (data as unknown as UrlRow[]) || [];
      nullRows.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }

    setMissing(missingUrls);
    setNullScored(nullRows);
    setLoading(false);
  };

  const rescoreMissing = async (limit?: number) => {
    if (missing.length === 0) return;
    const target = limit ? missing.slice(0, limit) : missing;
    setRescoring(true);
    let processed = 0;
    const startedAt = Date.now();
    let summary: any = null;
    for (let i = 0; i < target.length; i += BATCH_SIZE_RESCORE) {
      const batch = target.slice(i, i + BATCH_SIZE_RESCORE);
      const { data, error } = await supabase.functions.invoke('extract-recency-scores', {
        body: {
          citations: batch.map((url) => ({ url })),
        },
      });
      if (error) {
        toast.error(`Batch ${i / BATCH_SIZE_RESCORE + 1} failed: ${error.message}`);
        break;
      }
      summary = data?.summary ?? summary;
      processed += batch.length;
      toast.info(`Processed ${processed}/${target.length}`);
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    setRescoring(false);
    if (summary) {
      toast.success(
        `Done in ${elapsed}s — ${summary.withDates ?? 0} scored, ${summary.firecrawlRequestsMade ?? 0} Firecrawl calls`
      );
    } else {
      toast.success(`Done in ${elapsed}s`);
    }
    await loadUrls();
  };

  const retryableNull = nullScored.filter(
    (r) =>
      r.extraction_method === 'timeout' ||
      r.extraction_method === 'rate-limit-hit'
  );

  const groupedByMethod = nullScored.reduce<Record<string, UrlRow[]>>((acc, r) => {
    const key = r.extraction_method || 'unknown';
    (acc[key] ||= []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h2 className="text-xl font-semibold text-slate-800">
              {org.organization_name}
            </h2>
            <p className="text-sm text-slate-500">
              {org.total_urls} unique URLs · {org.with_score_count} scored (
              {((org.with_score_count / Math.max(1, org.total_urls)) * 100).toFixed(
                1
              )}
              %)
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenManual}
          disabled={nullScored.length === 0}
        >
          Manual review queue ({nullScored.length})
        </Button>
      </div>

      {loading ? (
        <div className="p-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Not in cache ({missing.length})
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => rescoreMissing(50)}
                    disabled={rescoring || missing.length === 0}
                  >
                    {rescoring ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Test 50
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => rescoreMissing()}
                    disabled={rescoring || missing.length === 0}
                  >
                    {rescoring ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Rescore all
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {missing.length === 0 ? (
                <p className="text-sm text-slate-500">
                  All URLs have been processed at least once.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto text-xs text-slate-600 space-y-1 font-mono">
                  {missing.slice(0, 50).map((u) => (
                    <div key={u} className="truncate">
                      {u}
                    </div>
                  ))}
                  {missing.length > 50 && (
                    <div className="text-slate-400 italic">
                      …and {missing.length - 50} more
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Null-scored ({nullScored.length}) · Retryable:{' '}
                {retryableNull.length}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.keys(groupedByMethod).length === 0 && (
                <p className="text-sm text-slate-500">
                  No failures — every cached URL has a score.
                </p>
              )}
              {Object.entries(groupedByMethod).map(([method, urls]) => (
                <div key={method}>
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline">{method}</Badge>
                    <span className="text-xs text-slate-500">
                      {urls.length} URLs
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

// ============================================================================
// Manual review queue: human enters a publication date for URLs that
// automation couldn't score.
// ============================================================================

const ManualReviewQueue = ({
  org,
  onBack,
}: {
  org: CoverageRow;
  onBack: () => void;
}) => {
  const [rows, setRows] = useState<UrlRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    load();
  }, [org.organization_id]);

  const load = async () => {
    setLoading(true);
    const nullRows: UrlRow[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('v_organization_url_status' as any)
        .select('url, recency_score, extraction_method, publication_date')
        .eq('organization_id', org.organization_id)
        .not('extraction_method', 'is', null)
        .is('recency_score', null)
        .range(from, from + pageSize - 1);
      if (error) {
        toast.error(`Failed loading review queue: ${error.message}`);
        break;
      }
      const batch = (data as unknown as UrlRow[]) || [];
      nullRows.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }

    setRows(nullRows);
    setLoading(false);
  };

  const calcScore = (date: string): number => {
    const pub = new Date(date);
    const now = new Date();
    const days = Math.floor((now.getTime() - pub.getTime()) / (1000 * 60 * 60 * 24));
    if (days < 0) return 100;
    if (days <= 30) return 100;
    if (days <= 90) return 90;
    if (days <= 180) return 80;
    if (days <= 365) return 70;
    if (days <= 730) return 50;
    if (days <= 1095) return 30;
    if (days <= 1825) return 20;
    if (days <= 3650) return 10;
    return 0;
  };

  const save = async (url: string) => {
    const date = inputs[url];
    if (!date) {
      toast.error('Enter a publication date first');
      return;
    }
    setSaving(url);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const score = calcScore(date);
    const domain = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return 'unknown';
      }
    })();

    const { error } = await supabase
      .from('url_recency_cache')
      .upsert(
        {
          url,
          domain,
          publication_date: date,
          recency_score: score,
          extraction_method: 'manual',
          manually_reviewed_at: new Date().toISOString(),
          manually_reviewed_by: user?.id ?? null,
        },
        { onConflict: 'url' }
      );

    if (error) {
      toast.error(`Save failed: ${error.message}`);
    } else {
      toast.success(`Saved (score ${score})`);
      setRows((prev) => prev.filter((r) => r.url !== url));
      setInputs((prev) => {
        const { [url]: _, ...rest } = prev;
        return rest;
      });
    }
    setSaving(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h2 className="text-xl font-semibold text-slate-800">
            Manual review · {org.organization_name}
          </h2>
          <p className="text-sm text-slate-500">
            {rows.length} URLs need a publication date.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              Nothing left to review.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Failure reason</TableHead>
                  <TableHead>Publication date</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.url}>
                    <TableCell className="max-w-xs">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-mono text-slate-700 hover:text-slate-900 flex items-center gap-1 truncate"
                      >
                        <span className="truncate">{r.url}</span>
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      </a>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.extraction_method}</Badge>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="date"
                        className="w-40"
                        value={inputs[r.url] || ''}
                        onChange={(e) =>
                          setInputs((prev) => ({ ...prev, [r.url]: e.target.value }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        onClick={() => save(r.url)}
                        disabled={saving === r.url || !inputs[r.url]}
                      >
                        {saving === r.url ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
