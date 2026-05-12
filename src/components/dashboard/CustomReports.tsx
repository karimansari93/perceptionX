import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Presentation, Download, Search } from 'lucide-react';
import { useCompany } from '@/contexts/CompanyContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

interface CustomReportRow {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
  period_year: number | null;
  period_quarter: number | null;
  region: string | null;
  thumbnail_path: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Deterministic hash → colour palette so any region label gets a stable badge.
const REGION_PALETTE = [
  'bg-slate-100 text-slate-700 border-slate-200',
  'bg-amber-50 text-amber-700 border-amber-200',
  'bg-blue-50 text-blue-700 border-blue-200',
  'bg-emerald-50 text-emerald-700 border-emerald-200',
  'bg-rose-50 text-rose-700 border-rose-200',
  'bg-violet-50 text-violet-700 border-violet-200',
  'bg-cyan-50 text-cyan-700 border-cyan-200',
  'bg-orange-50 text-orange-700 border-orange-200',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function regionBadgeClass(region: string | null): string {
  if (!region) return 'bg-gray-100 text-gray-600 border-gray-200';
  // "GLOBAL" gets the neutral slate slot by convention.
  if (region.toUpperCase() === 'GLOBAL') return REGION_PALETTE[0];
  return REGION_PALETTE[(hashStr(region) % (REGION_PALETTE.length - 1)) + 1];
}

type QuarterFilter = 'ALL' | 1 | 2 | 3 | 4;
type RegionFilter = 'ALL' | string;

export const CustomReports = () => {
  const { currentCompany, loading: companyLoading } = useCompany();
  const organizationId = currentCompany?.organization_id;

  const [reports, setReports] = useState<CustomReportRow[]>([]);
  const [orgRegions, setOrgRegions] = useState<string[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const [quarterFilter, setQuarterFilter] = useState<QuarterFilter>('ALL');
  const [regionFilter, setRegionFilter] = useState<RegionFilter>('ALL');

  useEffect(() => {
    if (!organizationId) {
      setReports([]);
      setOrgRegions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [reportsRes, orgRes] = await Promise.all([
        supabase
          .from('custom_reports')
          .select('id, organization_id, title, description, file_path, file_size, mime_type, created_at, period_year, period_quarter, region, thumbnail_path')
          .eq('organization_id', organizationId)
          .order('period_year', { ascending: false, nullsFirst: false })
          .order('period_quarter', { ascending: false, nullsFirst: false })
          .order('region', { ascending: true })
          .order('created_at', { ascending: false }),
        supabase
          .from('organizations')
          .select('regions')
          .eq('id', organizationId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      if (reportsRes.error) {
        toast.error('Failed to load reports');
        setReports([]);
      } else {
        const rows = (reportsRes.data ?? []) as CustomReportRow[];
        setReports(rows);

        // Batch sign all thumbnail paths so cards render images, not file icons.
        const paths = rows.map(r => r.thumbnail_path).filter((p): p is string => !!p);
        if (paths.length > 0) {
          const { data: signed } = await supabase
            .storage
            .from('custom-reports')
            .createSignedUrls(paths, 60 * 60); // 1h is fine for an image tag
          if (signed && !cancelled) {
            const map: Record<string, string> = {};
            signed.forEach(s => {
              if (s.path && s.signedUrl) map[s.path] = s.signedUrl;
            });
            setThumbUrls(map);
          }
        }
      }
      setOrgRegions(((orgRes.data as any)?.regions as string[] | undefined) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [organizationId]);

  // Available years derived from data, newest first. Default the filter to
  // the newest year on first load.
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    reports.forEach(r => { if (r.period_year) years.add(r.period_year); });
    return Array.from(years).sort((a, b) => b - a);
  }, [reports]);

  useEffect(() => {
    if (yearFilter === null && availableYears.length > 0) {
      setYearFilter(availableYears[0]);
    }
  }, [availableYears, yearFilter]);

  // Region order for sorting/pills: org's preferred order, then any extras
  // present on historical reports.
  const regionOrder = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    orgRegions.forEach(r => { if (!seen.has(r)) { seen.add(r); out.push(r); } });
    reports.forEach(r => { if (r.region && !seen.has(r.region)) { seen.add(r.region); out.push(r.region); } });
    return out;
  }, [orgRegions, reports]);

  const regionRank = (r: string | null) => {
    if (!r) return 999;
    const i = regionOrder.indexOf(r);
    return i === -1 ? 998 : i;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reports
      .filter(r => yearFilter === null || r.period_year === yearFilter)
      .filter(r => quarterFilter === 'ALL' || r.period_quarter === quarterFilter)
      .filter(r => regionFilter === 'ALL' || r.region === regionFilter)
      .filter(r => !q || r.title.toLowerCase().includes(q))
      .sort((a, b) => {
        const ay = a.period_year ?? 0, by = b.period_year ?? 0;
        if (ay !== by) return by - ay;
        const aq = a.period_quarter ?? 0, bq = b.period_quarter ?? 0;
        if (aq !== bq) return bq - aq;
        const ar = regionRank(a.region), br = regionRank(b.region);
        if (ar !== br) return ar - br;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [reports, search, yearFilter, quarterFilter, regionFilter, regionOrder]);

  const handleDownload = async (report: CustomReportRow) => {
    setDownloadingId(report.id);
    try {
      // Pick an extension from mime type, fall back to whatever's on file_path.
      const ext = report.mime_type === PPTX_MIME
        ? 'pptx'
        : report.file_path.split('.').pop() || 'pdf';
      // Sanitise the title for a filesystem-safe filename.
      const safeBase = (report.title || 'report')
        .replace(/[\\/:*?"<>|]+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      const filename = `${safeBase}.${ext}`;

      const { data, error } = await supabase
        .storage
        .from('custom-reports')
        .createSignedUrl(report.file_path, 60, { download: filename });
      if (error || !data?.signedUrl) throw error ?? new Error('No signed URL');

      // Trigger a real download instead of navigating — avoids opening the PDF
      // in a tab where the user might forget to save it.
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = filename;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to download report');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-8 w-full">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Reports</h2>
        <p className="text-sm text-gray-500 mt-1">
          Download reports prepared for your organization, and (soon) generate AI-powered reports on demand.
        </p>
      </div>

      {/* ── Custom Reports ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-800">Custom Reports</h3>

        {/* Filter bar */}
        {reports.length > 0 && (
          <div className="flex flex-col gap-3 p-3 rounded-md border border-gray-100 bg-gray-50/50">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Year</span>
                <Select value={yearFilter !== null ? String(yearFilter) : ''} onValueChange={(v) => setYearFilter(Number(v))}>
                  <SelectTrigger className="h-8 w-[110px] text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {availableYears.map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Quarter</span>
                <div className="flex gap-1">
                  {(['ALL', 1, 2, 3, 4] as QuarterFilter[]).map(q => (
                    <button
                      key={String(q)}
                      onClick={() => setQuarterFilter(q)}
                      className={cn(
                        'h-8 px-3 rounded-md text-xs font-medium transition-colors border',
                        quarterFilter === q
                          ? 'bg-[#13274F] text-white border-[#13274F]'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                      )}
                    >
                      {q === 'ALL' ? 'All' : `Q${q}`}
                    </button>
                  ))}
                </div>
              </div>

              {regionOrder.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Region</span>
                  <div className="flex gap-1 flex-wrap">
                    {(['ALL', ...regionOrder] as RegionFilter[]).map(r => (
                      <button
                        key={r}
                        onClick={() => setRegionFilter(r)}
                        className={cn(
                          'h-8 px-3 rounded-md text-xs font-medium transition-colors border',
                          regionFilter === r
                            ? 'bg-[#13274F] text-white border-[#13274F]'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                        )}
                      >
                        {r === 'ALL' ? 'All' : r}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="relative ml-auto w-full sm:w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by title..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-9 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        {companyLoading || loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading reports…</div>
        ) : !organizationId ? (
          <div className="py-12 text-center text-sm text-gray-400">
            No organization selected.
          </div>
        ) : reports.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-gray-200 rounded-lg">
            <p className="text-sm font-medium text-gray-500">No reports have been uploaded yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Custom reports prepared for your organization will appear here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-gray-200 rounded-lg">
            <p className="text-sm font-medium text-gray-500">No reports match your filters</p>
            <p className="text-xs text-gray-400 mt-1">Try changing year, quarter, or region.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {filtered.map(report => {
              const thumbUrl = report.thumbnail_path ? thumbUrls[report.thumbnail_path] : undefined;
              const isPptx = report.mime_type === PPTX_MIME;
              return (
                <Card
                  key={report.id}
                  className="group border-[0.5px] shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all flex flex-col overflow-hidden"
                >
                  {/* ── Preview ── */}
                  <div className="relative aspect-[16/10] bg-white border-b border-gray-100 overflow-hidden">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt=""
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover object-center group-hover:scale-[1.02] transition-transform"
                      />
                    ) : (
                      <div
                        className={cn(
                          'absolute inset-0 flex flex-col items-center justify-center gap-2',
                          isPptx
                            ? 'bg-gradient-to-br from-orange-50 via-amber-50 to-orange-100'
                            : 'bg-gradient-to-br from-rose-50 via-red-50 to-rose-100'
                        )}
                      >
                        {isPptx ? (
                          <Presentation className="h-10 w-10 text-orange-400" />
                        ) : (
                          <FileText className="h-10 w-10 text-red-400" />
                        )}
                        <span className={cn(
                          'text-[10px] font-bold tracking-widest',
                          isPptx ? 'text-orange-500' : 'text-red-500'
                        )}>
                          {isPptx ? 'PPTX' : 'PDF'}
                        </span>
                      </div>
                    )}

                    {/* Region badge overlay */}
                    {report.region && (
                      <span className={cn(
                        'absolute top-2 left-2 text-[10px] font-semibold px-1.5 py-0.5 rounded border shadow-sm backdrop-blur-sm',
                        regionBadgeClass(report.region)
                      )}>
                        {report.region}
                      </span>
                    )}

                    {/* Period chip overlay */}
                    {(report.period_year && report.period_quarter) && (
                      <span className="absolute top-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/85 text-gray-700 border border-white shadow-sm backdrop-blur-sm">
                        Q{report.period_quarter} {report.period_year}
                      </span>
                    )}
                  </div>

                  {/* ── Body ── */}
                  <CardContent className="p-4 flex-1 flex flex-col gap-2">
                    <h4
                      className="text-sm font-semibold text-gray-800 leading-snug line-clamp-2 break-words"
                      title={report.title}
                    >
                      {report.title}
                    </h4>
                    {report.description && (
                      <p className="text-xs text-gray-500 line-clamp-2">{report.description}</p>
                    )}
                    <div className="mt-auto pt-1 flex items-center justify-between text-[11px] text-gray-400">
                      <span>{formatDate(report.created_at)}</span>
                      <span>{formatSize(report.file_size)}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full gap-1.5 mt-1"
                      onClick={() => handleDownload(report)}
                      disabled={downloadingId === report.id}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {downloadingId === report.id ? 'Preparing…' : 'Download'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── AI-Generated Reports (coming soon) ──────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-800">AI-Generated Reports</h3>
          <Badge className="bg-gray-200 text-gray-700 px-2 py-0.5 text-[10px] font-semibold">Coming Soon</Badge>
        </div>
        <Card className="border-[0.5px] border-dashed shadow-none bg-gray-50/50">
          <CardContent className="py-10 text-center">
            <p className="text-sm font-medium text-gray-500">
              Generate proprietary PerceptionX analysis reports on demand.
            </p>
            <p className="text-xs text-gray-400 mt-1">
              This feature is coming soon.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
};
