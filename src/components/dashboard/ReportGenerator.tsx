import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Download, Globe, RotateCcw, X } from 'lucide-react';
import { useCompany } from '@/contexts/CompanyContext';
import { downloadPdfReport } from '@/services/pdfReportService';
import { getCountryFlag } from '@/utils/countryFlags';
import { useDashboardData } from '@/hooks/useDashboardData';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ─── constants ────────────────────────────────────────────────────────────────

const COUNTRY_NAMES: Record<string, string> = {
  GLOBAL: 'Global', US: 'United States', GB: 'United Kingdom', CA: 'Canada',
  AU: 'Australia', DE: 'Germany', FR: 'France', IT: 'Italy', ES: 'Spain',
  NL: 'Netherlands', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria',
  SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', IE: 'Ireland',
  PT: 'Portugal', GR: 'Greece', PL: 'Poland', CZ: 'Czech Republic',
  HU: 'Hungary', RO: 'Romania', BG: 'Bulgaria', HR: 'Croatia', SK: 'Slovakia',
  SI: 'Slovenia', LT: 'Lithuania', LV: 'Latvia', EE: 'Estonia', JP: 'Japan',
  CN: 'China', KR: 'South Korea', IN: 'India', SG: 'Singapore', MY: 'Malaysia',
  TH: 'Thailand', PH: 'Philippines', ID: 'Indonesia', VN: 'Vietnam',
  MX: 'Mexico', BR: 'Brazil', AR: 'Argentina', CL: 'Chile', CO: 'Colombia',
  PE: 'Peru', AE: 'United Arab Emirates', SA: 'Saudi Arabia', ZA: 'South Africa',
  NZ: 'New Zealand', TR: 'Turkey', RU: 'Russia',
};

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── helpers ──────────────────────────────────────────────────────────────────

function defaultMonth(offset: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatPeriodShort(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function formatPeriodRange(p1: string, p2: string): string {
  const [y1, m1] = p1.split('-').map(Number);
  const [y2, m2] = p2.split('-').map(Number);
  if (y1 === y2) return `${MONTH_NAMES[m1 - 1]} vs ${MONTH_NAMES[m2 - 1]} ${y1}`;
  return `${MONTH_NAMES[m1 - 1]} ${y1} vs ${MONTH_NAMES[m2 - 1]} ${y2}`;
}

function monthToRange(ym: string) {
  const [year, month] = ym.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(lastDay)}` };
}

// ─── storage ──────────────────────────────────────────────────────────────────

interface ReportEntry {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  period1: string;
  period2: string;
  market: string;
  marketCode: string;
  createdAt: string;
  status: 'generating' | 'ready' | 'failed';
}

function storageKey(companyId: string) {
  return `px_reports_${companyId}`;
}

function loadHistory(companyId: string): ReportEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(companyId));
    if (!raw) return [];
    const entries = JSON.parse(raw) as ReportEntry[];
    // Any entry still "generating" on load means the page was refreshed mid-request
    return entries.map(e => e.status === 'generating' ? { ...e, status: 'failed' } : e);
  } catch {
    return [];
  }
}

// ─── sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ReportEntry['status'] }) {
  if (status === 'generating') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Generating…
      </span>
    );
  }
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Ready
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
      <X className="w-3 h-3" />
      Failed
    </span>
  );
}

function ReportRow({
  entry,
  isConfirmingRemove,
  onDownload,
  onRetry,
  onRemoveClick,
  onRemoveConfirm,
}: {
  entry: ReportEntry;
  isConfirmingRemove: boolean;
  onDownload: (e: ReportEntry) => void;
  onRetry: (e: ReportEntry) => void;
  onRemoveClick: (id: string) => void;
  onRemoveConfirm: (id: string) => void;
}) {
  const isGenerating = entry.status === 'generating';
  const createdDate = new Date(entry.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <tr className="group border-b border-gray-50 last:border-0 hover:bg-gray-50/70 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="font-medium text-gray-800 text-sm truncate">{entry.name}</span>
        </div>
      </td>
      <td className="px-4 py-3 hidden sm:table-cell text-gray-500 text-sm whitespace-nowrap">
        {formatPeriodShort(entry.period1)} → {formatPeriodShort(entry.period2)}
      </td>
      <td className="px-4 py-3 hidden md:table-cell text-gray-500 text-sm">{entry.market}</td>
      <td className="px-4 py-3 hidden lg:table-cell text-gray-400 text-xs whitespace-nowrap">{createdDate}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        <StatusBadge status={entry.status} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 justify-end">
          {isConfirmingRemove ? (
            <>
              <span className="text-xs text-gray-500 mr-1">Sure?</span>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 px-2 text-xs"
                onClick={() => onRemoveConfirm(entry.id)}
              >
                Yes, remove
              </Button>
            </>
          ) : (
            <>
              {entry.status === 'ready' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-xs gap-1"
                  onClick={() => onDownload(entry)}
                >
                  <Download className="w-3 h-3" />
                  Download
                </Button>
              )}
              {entry.status === 'generating' && (
                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" disabled>
                  <Download className="w-3 h-3" />
                  Download
                </Button>
              )}
              {entry.status === 'failed' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-xs gap-1"
                  onClick={() => onRetry(entry)}
                >
                  <RotateCcw className="w-3 h-3" />
                  Retry
                </Button>
              )}
              {!isGenerating && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50"
                  onClick={() => onRemoveClick(entry.id)}
                >
                  Remove
                </Button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

interface ReportGeneratorProps {
  companyName: string;
  metrics?: any;
  responses?: any[];
  sentimentTrend?: any[];
  topCitations?: any[];
  promptsData?: any[];
  answerGapsData?: any;
}

export const ReportGenerator = ({ companyName }: ReportGeneratorProps) => {
  const { currentCompany, userCompanies, loading } = useCompany();
  const companyId = currentCompany?.id ?? '';
  const { availablePeriods } = useDashboardData();

  // Default to oldest and newest available periods once loaded
  const [period1, setPeriod1] = useState(() => defaultMonth(-2));
  const [period2, setPeriod2] = useState(() => defaultMonth(-1));
  const [market, setMarket] = useState('GLOBAL');

  useEffect(() => {
    if (availablePeriods.length >= 2) {
      // availablePeriods is sorted newest-first; pick oldest for p1, newest for p2
      setPeriod1(availablePeriods[availablePeriods.length - 1].key);
      setPeriod2(availablePeriods[0].key);
    } else if (availablePeriods.length === 1) {
      setPeriod1(availablePeriods[0].key);
      setPeriod2(availablePeriods[0].key);
    }
  }, [availablePeriods.length]);
  const [history, setHistory] = useState<ReportEntry[]>(() =>
    companyId ? loadHistory(companyId) : []
  );
  const [confirmingRemove, setConfirmingRemove] = useState<Set<string>>(new Set());
  const confirmTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Reload history when company switches
  const prevCompanyIdRef = useRef(companyId);
  useEffect(() => {
    if (prevCompanyIdRef.current !== companyId) {
      prevCompanyIdRef.current = companyId;
      setHistory(companyId ? loadHistory(companyId) : []);
    }
  }, [companyId]);

  // Persist history to localStorage
  useEffect(() => {
    if (companyId) {
      try {
        localStorage.setItem(storageKey(companyId), JSON.stringify(history));
      } catch {}
    }
  }, [history, companyId]);

  const availableMarkets = useMemo(() => {
    if (loading) return ['GLOBAL'];
    const locs = new Set<string>(['GLOBAL']);
    userCompanies.forEach(c => locs.add((c as any).country || 'GLOBAL'));
    return Array.from(locs).sort((a, b) => {
      if (a === 'GLOBAL') return -1;
      if (b === 'GLOBAL') return 1;
      return (COUNTRY_NAMES[a] || a).localeCompare(COUNTRY_NAMES[b] || b);
    });
  }, [userCompanies, loading]);

  const isDuplicate = useMemo(() => {
    const marketDisplay = COUNTRY_NAMES[market] || market;
    return history.some(
      e => e.period1 === period1 && e.period2 === period2 &&
        e.market === marketDisplay &&
        (e.status === 'ready' || e.status === 'generating')
    );
  }, [history, period1, period2, market]);

  const runDownload = useCallback(async (entry: ReportEntry) => {
    const r1 = monthToRange(entry.period1);
    const r2 = monthToRange(entry.period2);
    try {
      await downloadPdfReport({
        company_id: entry.companyId,
        company_name: entry.companyName,
        market: entry.market,
        p1_start: r1.start,
        p1_end: r1.end,
        p2_start: r2.start,
        p2_end: r2.end,
      });
      setHistory(prev => prev.map(e =>
        e.id === entry.id ? { ...e, status: 'ready' } : e
      ));
      toast.success('Report downloaded');
    } catch (err: any) {
      setHistory(prev => prev.map(e =>
        e.id === entry.id ? { ...e, status: 'failed' } : e
      ));
      toast.error(err.message || 'Report generation failed');
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!companyId) { toast.error('No company selected'); return; }
    const marketDisplay = COUNTRY_NAMES[market] || market;

    // Find the company_id that matches the selected market, not the top-bar selection
    const targetCompany = market === 'GLOBAL'
      ? (userCompanies.find(c => !c.country || c.country === 'GLOBAL') ?? userCompanies[0])
      : (userCompanies.find(c => (c as any).country === market) ?? userCompanies.find(c => !c.country));
    const targetCompanyId = (targetCompany as any)?.id ?? companyId;
    const targetCompanyName = targetCompany?.name ?? companyName;

    const entry: ReportEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: `${targetCompanyName} · ${formatPeriodRange(period1, period2)}`,
      companyId: targetCompanyId,
      companyName: targetCompanyName,
      period1,
      period2,
      market: marketDisplay,
      marketCode: market,
      createdAt: new Date().toISOString(),
      status: 'generating',
    };
    setHistory(prev => [entry, ...prev]);
    await runDownload(entry);
  }, [companyId, companyName, market, period1, period2, runDownload]);

  const handleDownload = useCallback(async (entry: ReportEntry) => {
    setHistory(prev => prev.map(e =>
      e.id === entry.id ? { ...e, status: 'generating' } : e
    ));
    await runDownload(entry);
  }, [runDownload]);

  const handleRemoveClick = useCallback((id: string) => {
    setConfirmingRemove(prev => new Set(prev).add(id));
    const timer = setTimeout(() => {
      setConfirmingRemove(prev => { const s = new Set(prev); s.delete(id); return s; });
      confirmTimers.current.delete(id);
    }, 3000);
    confirmTimers.current.set(id, timer);
  }, []);

  const handleRemoveConfirm = useCallback((id: string) => {
    clearTimeout(confirmTimers.current.get(id));
    confirmTimers.current.delete(id);
    setConfirmingRemove(prev => { const s = new Set(prev); s.delete(id); return s; });
    setHistory(prev => prev.filter(e => e.id !== id));
  }, []);

  return (
    <div className="space-y-6 w-full">

      {/* ── Page header ── */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Reports</h2>
        <p className="text-sm text-gray-500 mt-1">
          Generate an AI-generated report using proprietary PerceptionX analysis — each report reflects how AI models perceive {companyName} as an employer across your selected market and time periods.
        </p>
      </div>

      {/* ── Generate card ── */}
      <Card className="border-[0.5px] shadow-sm">
        <CardContent className="py-5">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Period 1</label>
                <Select value={period1} onValueChange={setPeriod1}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select period" />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePeriods.map(p => (
                      <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Period 2</label>
                <Select value={period2} onValueChange={setPeriod2}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select period" />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePeriods.map(p => (
                      <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 sm:col-span-1 space-y-1.5">
                <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Market</label>
                <Select value={market} onValueChange={setMarket}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue>
                      <span className="flex items-center gap-1.5">
                        {market === 'GLOBAL'
                          ? <Globe className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                          : <span className="text-sm leading-none">{getCountryFlag(market)}</span>}
                        <span className="truncate">{COUNTRY_NAMES[market] || market}</span>
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {availableMarkets.map(code => (
                      <SelectItem key={code} value={code}>
                        <span className="flex items-center gap-2">
                          {code === 'GLOBAL'
                            ? <Globe className="h-3.5 w-3.5 text-gray-500" />
                            : <span>{getCountryFlag(code)}</span>}
                          {COUNTRY_NAMES[code] || code}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              onClick={handleGenerate}
              disabled={isDuplicate || !companyId}
              className="shrink-0 bg-[#13274F] hover:bg-[#183056] text-white disabled:opacity-40"
              title={isDuplicate ? 'A report for this combination already exists' : undefined}
            >
              Generate report
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── History ── */}
      <div>
        <h3 className="text-sm font-semibold text-gray-600 mb-3">Report history</h3>

        {history.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-sm font-medium text-gray-400">Your reports will appear here</p>
            <p className="text-xs text-gray-300 mt-1">Generate your first report above</p>
          </div>
        ) : (
          <Card className="border-[0.5px] shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5">Report</th>
                    <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5 hidden sm:table-cell">Periods</th>
                    <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5 hidden md:table-cell">Market</th>
                    <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5 hidden lg:table-cell">Created</th>
                    <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 w-0" />
                  </tr>
                </thead>
                <tbody>
                  {history.map(entry => (
                    <ReportRow
                      key={entry.id}
                      entry={entry}
                      isConfirmingRemove={confirmingRemove.has(entry.id)}
                      onDownload={handleDownload}
                      onRetry={handleDownload}
                      onRemoveClick={handleRemoveClick}
                      onRemoveConfirm={handleRemoveConfirm}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};
