import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { CitationCount } from "@/types/dashboard";
import { ExternalLink, X, Download, Sparkles, Loader2, CheckCircle2, ChevronRight } from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { categorizeSourceByMediaType, getMediaTypeInfo, MEDIA_TYPE_DESCRIPTIONS } from "@/utils/sourceConfig";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import LLMLogo from "@/components/LLMLogo";
import { extractSourceUrl, enhanceCitations, normalizePageKey } from "@/utils/citationUtils";
import { RateDonut } from "@/components/ui/rate-donut";
// Removed chart imports since we're rendering custom bars like SourcesTab

const normalizeDomainKey = (d: string) => (d || '').trim().toLowerCase().replace(/^www\./, '');

// When several URL variants collapse into one page (highlight fragments,
// tracking params), show the cleanest one: no #fragment, then shortest.
const preferDisplayUrl = (a: string, b: string): string => {
  const aHash = a.includes('#');
  const bHash = b.includes('#');
  if (aHash !== bHash) return aHash ? b : a;
  return a.length <= b.length ? a : b;
};

// Some stored citation titles contain literal "&"-style escapes (JSON
// escaping survived as text). Decode them so titles render as "&" etc.
const decodeUnicodeEscapes = (s: string): string => {
  if (!s || !s.includes('\\u')) return s;
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
};

// Prompt types are stored namespaced (e.g. `talentx_discovery`, `informational`).
// The "talentx" prefix is an internal grouping users don't need — show just the
// readable type ("Discovery", "Informational"). Capitalization is handled in CSS.
const formatPromptType = (t?: string): string =>
  (t || '').replace(/^talentx[_\s-]*/i, '').replace(/_/g, ' ').trim();

// Significance gate for the Opportunities tab. A page that shows up in a
// single absent answer is noise; it only ranks as an opportunity once it
// repeats. Filtered pages are summarized in a footnote, never silently dropped.
const OPPORTUNITY_MIN_ANSWERS = 2;
// How many opportunity rows to render before collapsing behind "Show all".
const OPPORTUNITY_PREVIEW_COUNT = 10;

type SourcePromptAgg = {
  id: string;
  text: string;
  theme?: string;
  type?: string;
  total: number;
  mentioned: number;
  models: string[];
};

/** A prompt attached to a gap page — the question that page is answering. */
type GapPagePrompt = {
  id: string;
  text: string;
  theme?: string;
  jobFunction?: string | null;
  count: number;
};

/** A page from this source cited in answers where the company was absent.
 *  The page IS the opportunity; prompts/themes/functions describe its impact. */
type GapPageAgg = {
  url: string;
  title: string;
  answers: number;
  prompts: GapPagePrompt[];
  themes: string[];
  functions: string[];
};

interface SourceDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  source: CitationCount;
  responses: any[];
  companyName?: string;
  searchResults?: any[];
  companyId?: string;
  selectedThemeFilter?: string;
  /** Active Mentioned / Not Mentioned toggle from the sources list. Restricts the
   *  cited pages to responses in that subset; 'all' applies no restriction. */
  companyMentionedFilter?: 'mentioned' | 'not-mentioned' | 'all';
  responseTexts?: Record<string, string>;
  fetchResponseTexts?: (ids: string[]) => Promise<Record<string, string>>;
}

export const SourceDetailsModal = ({ isOpen, onClose, source, responses, companyName, searchResults = [], companyId, selectedThemeFilter = 'all', companyMentionedFilter = 'all', responseTexts = {}, fetchResponseTexts }: SourceDetailsModalProps) => {
  // ---------------------------------------------------------------------
  // Cited pages — derived from the same `responses` prop as every other
  // number in this modal (NOT a separate DB query). The old fetch hit raw
  // prompt_responses with `company_mentioned = false`, which silently
  // dropped rows where the flag is NULL and domains that only match after
  // canonicalization — so a source could rank in the Not Mentioned list
  // yet show "No pages found" here. Deriving from the prop guarantees the
  // same company scope, period, canonical domains, and NULL-as-not-
  // mentioned semantics as the list the user clicked through from.
  // ---------------------------------------------------------------------
  const uniqueCitations = useMemo(() => {
    if (!source?.domain) return [] as any[];
    const target = normalizeDomainKey(source.domain);
    // Search results carry no company_mentioned signal: they belong to the
    // "not mentioned" world and have no theme data.
    const includeSearch = selectedThemeFilter === 'all' && companyMentionedFilter !== 'mentioned';

    // Keyed by normalized URL (domain + path, no query/hash) so highlight
    // fragments and tracking variants of the same page collapse into one
    // row. Titles are deliberately NOT a grouping key — engines emit the
    // same generic title ("Source from glassdoor.com") for many unrelated
    // pages, which used to lump hundreds of URLs into one row.
    type PageRow = { url: string; variants: Set<string>; title: string; snippet: string; count: number; searchResult?: boolean };
    const byPageKey = new Map<string, PageRow>();
    let urllessCount = 0;

    const addPage = (rawUrl: string, title: string, snippet: string, count: number, searchResult?: boolean) => {
      const key = normalizePageKey(rawUrl);
      const row = byPageKey.get(key);
      if (row) {
        row.count += count;
        row.variants.add(rawUrl);
        row.url = preferDisplayUrl(row.url, rawUrl);
        if (!row.title && title) row.title = title;
        if (!row.snippet && snippet) row.snippet = snippet;
      } else {
        byPageKey.set(key, { url: rawUrl, variants: new Set([rawUrl]), title, snippet, count, searchResult });
      }
    };

    for (const r of responses || []) {
      // Same subset semantics as the sources list (NULL counts as not mentioned).
      if (companyMentionedFilter === 'mentioned' && r.company_mentioned !== true) continue;
      if (companyMentionedFilter === 'not-mentioned' && r.company_mentioned === true) continue;
      if (selectedThemeFilter !== 'all' && r.confirmed_prompts?.prompt_theme !== selectedThemeFilter) continue;

      let parsed: any = r.citations;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { continue; }
      }
      if (!Array.isArray(parsed)) continue;

      const enhanced = enhanceCitations(parsed);
      const seen = new Set<string>();
      let cites = false;
      let hadUrl = false;
      for (const c of enhanced) {
        if (c.type === 'website' && c.domain && normalizeDomainKey(c.domain) === target) {
          cites = true;
          if (c.url) {
            const url = extractSourceUrl(c.url);
            const key = normalizePageKey(url);
            if (seen.has(key)) continue; // count each page once per answer
            seen.add(key);
            hadUrl = true;
            addPage(url, decodeUnicodeEscapes(c.title || ''), (c as any).snippet || '', 1);
          }
        }
      }
      if (cites && !hadUrl) urllessCount += 1;
    }

    if (includeSearch) {
      for (const sres of searchResults || []) {
        if (normalizeDomainKey(sres.domain || '') !== target || !sres.link) continue;
        addPage(sres.link, decodeUnicodeEscapes(sres.title || ''), sres.snippet || '', sres.mentionCount || 1, true);
      }
    }

    const rows: any[] = Array.from(byPageKey.values()).map(g => {
      const urls = Array.from(g.variants);
      return {
        title: g.title.trim(),
        snippet: g.snippet,
        url: g.url,
        urls,
        urlCount: urls.length,
        grouped: urls.length > 1,
        mentionCount: g.count,
      };
    });

    // Citations that matched the domain but carried no URL (cited by name) —
    // one aggregate row so the count isn't silently dropped.
    if (urllessCount > 0) {
      const fallbackDomain = source.domain.replace(/^www\./, '');
      const syntheticUrl = `https://${fallbackDomain}/`;
      rows.push({
        title: `${fallbackDomain} (source mentions)`,
        snippet: '',
        url: syntheticUrl,
        urls: [syntheticUrl],
        urlCount: 1,
        grouped: false,
        mentionCount: urllessCount,
      });
    }

    return rows.sort((a, b) => b.mentionCount - a.mentionCount);
  }, [responses, source?.domain, companyMentionedFilter, selectedThemeFilter, searchResults]);
  const [editingMediaType, setEditingMediaType] = useState(false);
  const [customMediaType, setCustomMediaType] = useState<string | null>(null);
  const [sourceSummary, setSourceSummary] = useState<string>("");
  const [loadingSourceSummary, setLoadingSourceSummary] = useState(false);
  const [sourceSummaryError, setSourceSummaryError] = useState<string | null>(null);
  const [sourceThinkingStep, setSourceThinkingStep] = useState<number>(-1);
  const [sourceThinkingSteps, setSourceThinkingSteps] = useState<string[]>([]);
  const [hoveredSourceCitation, setHoveredSourceCitation] = useState<number | null>(null);

  const getFavicon = (domain: string): string => {
    const cleanDomain = domain.trim().toLowerCase().replace(/^www\./, '');
    return `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=32`;
  };

  const parseAndEnhanceCitations = (citations: any) => {
    if (!citations) return [];
    try {
      const parsed = typeof citations === 'string' ? JSON.parse(citations) : citations;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const truncateText = (text: string, maxLength: number = 150) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  const getSentimentColor = (sentimentScore: number | null) => {
    if (!sentimentScore) return 'text-gray-600';
    if (sentimentScore > 0.1) return 'text-green-600';
    if (sentimentScore < -0.1) return 'text-red-600';
    return 'text-gray-600';
  };

  const getSentimentBgColor = (sentimentScore: number | null) => {
    if (!sentimentScore) return 'bg-gray-100';
    if (sentimentScore > 0.1) return 'bg-green-100';
    if (sentimentScore < -0.1) return 'bg-red-100';
    return 'bg-gray-100';
  };

  // Media type editing functions
  const handleMediaTypeEdit = () => {
    setEditingMediaType(true);
  };

  const handleMediaTypeSave = (newMediaType: string) => {
    setCustomMediaType(newMediaType);
    setEditingMediaType(false);
  };

  const handleMediaTypeCancel = () => {
    setEditingMediaType(false);
  };

  const getSourceDisplayName = (domain: string) => {
    let name = domain.replace(/^www\./, "");
    name = name.replace(/\.(com|org|net|io|co|edu|gov|info|biz)(\.[a-z]{2})?$/, "");
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  const fetchSourceSummary = useCallback(async () => {
    if (!source?.domain) return;
    setSourceSummary("");
    setSourceSummaryError(null);
    setLoadingSourceSummary(true);
    setSourceThinkingStep(0);
    setSourceThinkingSteps([]);

    const relevantResponses = responses.filter(r => {
      if (!r.citations) return false;
      try {
        const citations = typeof r.citations === 'string' ? JSON.parse(r.citations) : r.citations;
        if (!Array.isArray(citations)) return false;
        const targetDomain = source.domain.replace(/^www\./, '').toLowerCase();
        return citations.some((c: any) => {
          const domainField = (c.domain || '').replace(/^www\./, '').toLowerCase();
          const sourceField = (c.source || '').replace(/^www\./, '').toLowerCase();
          const urlField = (c.url || '').toLowerCase();
          return (
            domainField === targetDomain ||
            sourceField === targetDomain ||
            sourceField.includes(targetDomain) ||
            urlField.includes(targetDomain)
          );
        });
      } catch { return false; }
    });

    if (relevantResponses.length === 0) {
      setSourceSummaryError("No responses found citing this source.");
      setLoadingSourceSummary(false);
      setSourceThinkingStep(-1);
      return;
    }

    let texts = responseTexts;
    const missingTextIds = relevantResponses.filter(r => !r.response_text && !texts[r.id]).map(r => r.id);
    if (missingTextIds.length > 0 && fetchResponseTexts) {
      texts = await fetchResponseTexts(missingTextIds) || texts;
    }

    const displayName = getSourceDisplayName(source.domain);

    const steps = [
      `Reading ${relevantResponses.length} responses citing ${displayName}...`,
      `Analyzing how ${displayName} is referenced...`,
      `Identifying key topics and sentiment...`,
      `Writing source analysis...`,
    ];
    setSourceThinkingSteps(steps);

    const stepTimers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < steps.length; i++) {
      stepTimers.push(setTimeout(() => setSourceThinkingStep(i), i * 1800));
    }

    const prompt = `You are an employer brand analyst. Analyze how "${displayName}" (${source.domain}) is cited in AI responses about ${companyName || 'this company'}.

This source was cited ${source.count} times. Here are ${relevantResponses.length} responses that reference it:

${relevantResponses.slice(0, 6).map((r, i) => {
  const text = (texts[r.id] || r.response_text || '').slice(0, 600);
  return `Response ${i + 1}:\n${text}`;
}).join('\n\n---\n\n')}

Write 2-3 paragraphs covering: (1) what specific information from ${displayName} appears in AI responses about ${companyName || 'the company'}, (2) the sentiment and framing around this source, (3) how reliable/relevant this source is for employer brand intelligence. Be specific about actual content mentioned.`;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setSourceSummaryError("Authentication required");
        setLoadingSourceSummary(false);
        setSourceThinkingStep(-1);
        stepTimers.forEach(clearTimeout);
        return;
      }
      const res = await fetch("https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-claude", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          prompt,
          enableWebSearch: false,
          model: "claude-haiku-4-5",
          maxTokens: 900,
        })
      });
      const data = await res.json();
      stepTimers.forEach(clearTimeout);
      if (data.response) {
        setSourceSummary(data.response.trim());
      } else {
        setSourceSummaryError(data.error || "No summary generated.");
      }
    } catch (err) {
      stepTimers.forEach(clearTimeout);
      setSourceSummaryError("Failed to generate summary.");
    } finally {
      setLoadingSourceSummary(false);
      setSourceThinkingStep(-1);
    }
  }, [source?.domain, source?.count, responses, companyName]);

  // Reset summary when modal closes or source changes
  useEffect(() => {
    if (!isOpen) {
      setSourceSummary("");
      setSourceSummaryError(null);
      setSourceThinkingStep(-1);
      setSourceThinkingSteps([]);
      setHoveredSourceCitation(null);
    }
  }, [isOpen, source?.domain]);

  const getEffectiveMediaType = () => {
    // Check if there's a custom override
    if (customMediaType) {
      return customMediaType;
    }
    // Otherwise use the automatic categorization
    return categorizeSourceByMediaType(source.domain, responses, companyName);
  };


  // Get media type for this source using response data
  const mediaType = getEffectiveMediaType();
  const mediaTypeInfo = getMediaTypeInfo(mediaType);

  // ---------------------------------------------------------------------
  // Aggregation for the Prompts / Opportunities tabs.
  //
  // The `responses` prop is already restricted to rows citing this domain
  // (SourcesTab passes responsesByDomain), and each row carries the joined
  // confirmed_prompts data — so no extra fetch is needed and the numbers
  // stay consistent with the sources list the user clicked through from.
  //
  // One pass produces two shapes:
  //  - promptAggs: per-prompt mention stats (Prompts tab)
  //  - gapPages: per-PAGE rollup of answers where the company was absent.
  //    The page is the opportunity; its prompts/themes/functions describe
  //    what it impacts (Opportunities tab).
  // ---------------------------------------------------------------------
  const { promptAggs, gapPages, urllessGapPrompts, gapAnswerCount } = useMemo(() => {
    const empty = {
      promptAggs: [] as SourcePromptAgg[],
      gapPages: [] as GapPageAgg[],
      urllessGapPrompts: [] as GapPagePrompt[],
      gapAnswerCount: 0,
    };
    if (!source?.domain) return empty;
    const target = normalizeDomainKey(source.domain);
    const companyNeedle = (companyName || '').trim().toLowerCase();

    type WorkingPrompt = SourcePromptAgg & { modelSet: Set<string> };
    type WorkingPage = { url: string; title: string; answers: number; promptMap: Map<string, GapPagePrompt> };
    const byPrompt = new Map<string, WorkingPrompt>();
    const byPage = new Map<string, WorkingPage>();
    const urllessByPrompt = new Map<string, GapPagePrompt>();
    let eligibleGapAnswers = 0;

    for (const r of responses || []) {
      let parsed: any = r.citations;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { continue; }
      }
      if (!Array.isArray(parsed)) continue;

      // Same normalization path as SourcesTab, so every row matches the way
      // it was indexed (source-name-only citations resolve to domains too).
      const enhanced = enhanceCitations(parsed);
      const pageSeen = new Set<string>();
      const pages: { key: string; url: string; title: string }[] = [];
      let citesDomain = false;
      for (const c of enhanced) {
        if (c.type === 'website' && c.domain && normalizeDomainKey(c.domain) === target) {
          citesDomain = true;
          if (c.url) {
            const url = extractSourceUrl(c.url);
            const key = normalizePageKey(url);
            if (!pageSeen.has(key)) {
              pageSeen.add(key);
              pages.push({ key, url, title: decodeUnicodeEscapes(c.title || '') });
            }
          }
        }
      }
      if (!citesDomain) continue;

      const pid = String(r.confirmed_prompt_id || r.confirmed_prompts?.id || 'unknown');
      const promptText = r.confirmed_prompts?.prompt_text || 'Untitled prompt';
      const promptTheme = r.confirmed_prompts?.prompt_theme || undefined;
      const jobFunction = r.confirmed_prompts?.job_function_context?.trim() || null;

      let entry = byPrompt.get(pid);
      if (!entry) {
        entry = {
          id: pid,
          text: promptText,
          theme: promptTheme,
          type: formatPromptType(r.confirmed_prompts?.prompt_type) || undefined,
          total: 0,
          mentioned: 0,
          models: [],
          modelSet: new Set<string>(),
        };
        byPrompt.set(pid, entry);
      }

      entry.total += 1;
      if (r.company_mentioned === true) entry.mentioned += 1;
      if (r.ai_model) entry.modelSet.add(r.ai_model);

      // Gap rollup: answers where the company is GENUINELY absent. Two
      // conditions: the answer doesn't mention the company AND the prompt
      // didn't already name it. When a prompt asks about the company
      // directly ("How do candidates rate Ford's interview feedback?"),
      // the whole answer is about the company even if it never repeats the
      // name — counting those as gaps would poison the opportunity signal
      // (verified in prod: ~30% of Glassdoor's "not mentioned" answers were
      // company-named prompts answered in implicit form).
      const promptNamesCompany = companyNeedle.length > 0 && promptText.toLowerCase().includes(companyNeedle);
      if (r.company_mentioned !== true && !promptNamesCompany) {
        eligibleGapAnswers += 1;
        const bumpPrompt = (map: Map<string, GapPagePrompt>) => {
          const existing = map.get(pid);
          if (existing) existing.count += 1;
          else map.set(pid, { id: pid, text: promptText, theme: promptTheme, jobFunction, count: 1 });
        };
        if (pages.length === 0) {
          // Cited by name only — no URL to point at. Tracked separately so
          // the signal isn't lost, surfaced as one aggregate row.
          bumpPrompt(urllessByPrompt);
        } else {
          for (const p of pages) {
            let page = byPage.get(p.key);
            if (!page) {
              page = { url: p.url, title: p.title, answers: 0, promptMap: new Map() };
              byPage.set(p.key, page);
            } else {
              page.url = preferDisplayUrl(page.url, p.url);
            }
            if (!page.title && p.title) page.title = p.title;
            page.answers += 1;
            bumpPrompt(page.promptMap);
          }
        }
      }
    }

    const promptList = Array.from(byPrompt.values())
      .map(({ modelSet, ...agg }) => ({ ...agg, models: Array.from(modelSet) }))
      .sort((a, b) => b.total - a.total);

    const pageList: GapPageAgg[] = Array.from(byPage.values())
      .map(({ promptMap, ...page }) => {
        const prompts = Array.from(promptMap.values()).sort((a, b) => b.count - a.count);
        return {
          ...page,
          prompts,
          themes: Array.from(new Set(prompts.map(p => p.theme).filter(Boolean))) as string[],
          functions: Array.from(new Set(prompts.map(p => p.jobFunction).filter(Boolean))) as string[],
        };
      })
      .sort((a, b) => b.answers - a.answers || b.themes.length - a.themes.length);

    return {
      promptAggs: promptList,
      gapPages: pageList,
      urllessGapPrompts: Array.from(urllessByPrompt.values()).sort((a, b) => b.count - a.count),
      gapAnswerCount: eligibleGapAnswers,
    };
  }, [responses, source?.domain, companyName]);

  const sourceTotals = useMemo(() => {
    const answers = promptAggs.reduce((s, a) => s + a.total, 0);
    const mentioned = promptAggs.reduce((s, a) => s + a.mentioned, 0);
    return {
      answers,
      mentioned,
      mentionRate: answers > 0 ? mentioned / answers : 0,
    };
  }, [promptAggs]);

  // Search-result pages for this domain — organic gaps with no prompt context.
  const searchGapPages = useMemo(() => {
    if (!source?.domain) return [] as { url: string; title: string }[];
    const target = normalizeDomainKey(source.domain);
    const seen = new Set<string>();
    const out: { url: string; title: string }[] = [];
    for (const sres of searchResults || []) {
      if (normalizeDomainKey(sres.domain || '') !== target) continue;
      if (!sres.link || seen.has(sres.link)) continue;
      seen.add(sres.link);
      out.push({ url: sres.link, title: decodeUnicodeEscapes(sres.title || '') || sres.link });
    }
    return out;
  }, [searchResults, source?.domain]);

  // Opportunities worth showing: pages that clear the significance bar.
  // If nothing clears it, fall back to the top pages so the tab isn't empty.
  const significantGapPages = gapPages.filter(p => p.answers >= OPPORTUNITY_MIN_ANSWERS);
  const opportunityPages = significantGapPages.length > 0
    ? significantGapPages
    : gapPages.slice(0, OPPORTUNITY_PREVIEW_COUNT);
  const lowSignalPageCount = gapPages.length - opportunityPages.length;

  // Active tab: land on Opportunities when the user arrives from the
  // Not Mentioned view, otherwise on Cited Pages.
  const [activeTab, setActiveTab] = useState<string>('pages');
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());
  const [showAllOpportunities, setShowAllOpportunities] = useState(false);
  useEffect(() => {
    if (isOpen) {
      setActiveTab(companyMentionedFilter === 'not-mentioned' ? 'opportunities' : 'pages');
      setExpandedPrompts(new Set());
      setShowAllOpportunities(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, source?.domain]);

  const visibleOpportunityPages = showAllOpportunities
    ? opportunityPages
    : opportunityPages.slice(0, OPPORTUNITY_PREVIEW_COUNT);

  const togglePromptExpanded = (id: string) => {
    setExpandedPrompts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // CSV download function
  const handleDownloadCSV = () => {
    if (uniqueCitations.length === 0) return;

    // CSV header
    const headers = ['Title', 'URL', 'All URLs', 'Mention Count', 'URL Count', 'Snippet'];
    
    // Convert citations to CSV rows
    const rows = uniqueCitations.map(citation => {
      const title = citation.title || 'Untitled';
      const primaryUrl = citation.url || '';
      const allUrls = citation.urls && citation.urls.length > 0 
        ? citation.urls.join('; ') 
        : primaryUrl;
      const mentionCount = citation.mentionCount || 1;
      const urlCount = citation.urlCount || 1;
      const snippet = (citation.snippet || '').replace(/"/g, '""'); // Escape quotes for CSV
      
      // Escape fields that might contain commas or quotes
      const escapeCSV = (field: string) => {
        if (field.includes(',') || field.includes('"') || field.includes('\n')) {
          return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
      };
      
      return [
        escapeCSV(title),
        escapeCSV(primaryUrl),
        escapeCSV(allUrls),
        mentionCount.toString(),
        urlCount.toString(),
        escapeCSV(snippet)
      ].join(',');
    });
    
    // Combine headers and rows
    const csvContent = [headers.join(','), ...rows].join('\n');
    
    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cited-sources-${source.domain.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // The questions a gap page is answering — shared by page rows and the
  // "cited by name" aggregate row in the Opportunities tab.
  const renderGapPrompts = (prompts: GapPagePrompt[]) => (
    <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3 pl-10 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-200">
      {prompts.map((p) => (
        <div key={p.id} className="flex items-start gap-2">
          <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-800">{p.text}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {p.theme && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-gray-500 border-gray-200">
                  {p.theme}
                </Badge>
              )}
              {p.jobFunction && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-gray-500 border-gray-200">
                  {p.jobFunction}
                </Badge>
              )}
              {p.count > 1 && (
                <span className="text-[10px] text-gray-400">{p.count} answers</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const tabTriggerCls = "relative rounded-none border-b-2 border-transparent bg-transparent px-0 py-3 text-sm font-medium text-gray-500 shadow-none transition-colors hover:text-[#13274F] data-[state=active]:border-[#13274F] data-[state=active]:text-[#13274F] data-[state=active]:bg-transparent data-[state=active]:shadow-none";

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col gap-0 [&>button]:hidden">
        {/* Header */}
        <div className="border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl border border-gray-100 bg-white shadow-sm grid place-items-center shrink-0">
                <img src={getFavicon(source.domain)} alt="" className="w-6 h-6 object-contain" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="font-headline text-lg font-semibold text-[#13274F] leading-tight truncate">
                  {getSourceDisplayName(source.domain)}
                </SheetTitle>
                <a
                  href={`https://${source.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[#0DBCBA] hover:text-[#0A8B89] hover:underline"
                >
                  <span className="truncate">{source.domain}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <TooltipProvider>
                <Tooltip>
                  <Popover open={editingMediaType} onOpenChange={(open) => !open && handleMediaTypeCancel()}>
                    <PopoverTrigger asChild>
                      <TooltipTrigger asChild>
                        <button type="button" onClick={handleMediaTypeEdit} className="focus:outline-none">
                          <Badge className={`${mediaTypeInfo.colors} cursor-pointer hover:opacity-80 transition-opacity`}>
                            {mediaTypeInfo.label}
                          </Badge>
                        </button>
                      </TooltipTrigger>
                    </PopoverTrigger>
                    <TooltipContent className="max-w-60">
                      <p className="text-xs">{mediaTypeInfo.description}</p>
                      <p className="text-xs text-gray-400 mt-1">Click to change media type</p>
                    </TooltipContent>
                <PopoverContent className="w-64 p-3" align="end">
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm">Change Media Type</h4>
                    <div className="space-y-2">
                      {Object.entries(MEDIA_TYPE_DESCRIPTIONS).map(([type, description]) => (
                        <button
                          key={type}
                          onClick={() => handleMediaTypeSave(type)}
                          className="w-full text-left p-2 rounded-md hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <Badge className={`text-xs ${getMediaTypeInfo(type).colors}`}>
                              {getMediaTypeInfo(type).label}
                            </Badge>
                            <span className="text-xs text-gray-600">{description}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleMediaTypeCancel}
                        className="flex-1"
                      >
                        <X className="w-3 h-3 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
                  </Popover>
                </Tooltip>
              </TooltipProvider>
              <button
                onClick={onClose}
                className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          {/* Stat strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100 border-t border-gray-100">
            <div className="px-6 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Citations</p>
              <p className="mt-0.5 text-sm font-semibold text-[#13274F]">{source.count}</p>
            </div>
            <div className="px-6 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Mention rate</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <RateDonut rate={sourceTotals.mentionRate} size={18} />
                <span className="text-sm font-semibold text-[#13274F]">
                  {sourceTotals.answers > 0 ? `${Math.round(sourceTotals.mentionRate * 100)}%` : '–'}
                </span>
              </div>
            </div>
            <div className="px-6 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Prompts</p>
              <p className="mt-0.5 text-sm font-semibold text-[#13274F]">{promptAggs.length}</p>
            </div>
            <div className="px-6 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Opportunities</p>
              <p className={`mt-0.5 text-sm font-semibold ${gapAnswerCount > 0 ? 'text-[#DB5E89]' : 'text-[#13274F]'}`}>
                {gapAnswerCount}
              </p>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full justify-start gap-6 rounded-none border-b border-gray-200 bg-transparent p-0 px-6 h-auto shrink-0">
            <TabsTrigger value="pages" className={tabTriggerCls}>
              Pages
              {uniqueCitations.length > 0 && (
                <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                  {uniqueCitations.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="prompts" className={tabTriggerCls}>
              Prompts
              <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                {promptAggs.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="opportunities" className={tabTriggerCls}>
              Opportunities
              <span className="ml-1.5 rounded-full bg-[#DB5E89] px-1.5 py-0.5 text-[9px] font-semibold text-white leading-none">
                BETA
              </span>
              {gapAnswerCount > 0 && (
                <span className="ml-1.5 rounded-full bg-[#DB5E89]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#DB5E89]">
                  {opportunityPages.length + (urllessGapPrompts.length > 0 ? 1 : 0)}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto">
            <div className="px-6 pt-4 empty:hidden">


            {/* AI Summary — on demand */}
            {sourceSummary ? (
              <Card className="border-[#0DBCBA]/30 bg-[#0DBCBA]/5">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#0DBCBA]" />
                      AI Summary
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={fetchSourceSummary}
                      disabled={loadingSourceSummary}
                      className="text-xs text-gray-400 hover:text-gray-600 h-auto py-1"
                    >
                      {loadingSourceSummary ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      Regenerate
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-gray-800 text-sm leading-relaxed">
                    {sourceSummary.split('\n\n').filter(Boolean).map((paragraph, pIdx) => (
                      <p key={pIdx} className="mb-3 last:mb-0">{paragraph}</p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : loadingSourceSummary ? (
              <Card className="border-[#0DBCBA]/30 bg-gradient-to-br from-[#0DBCBA]/5 to-[#0DBCBA]/10 overflow-hidden">
                <CardContent className="py-5 px-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="relative">
                      <Sparkles className="w-4 h-4 text-[#0DBCBA]" />
                      <div className="absolute inset-0 animate-ping"><Sparkles className="w-4 h-4 text-[#0DBCBA] opacity-30" /></div>
                    </div>
                    <span className="text-sm font-medium text-[#0A8B89]">Analyzing...</span>
                  </div>
                  <div className="space-y-0.5">
                    {sourceThinkingSteps.map((step, i) => {
                      const isActive = i === sourceThinkingStep;
                      const isComplete = i < sourceThinkingStep;
                      const isPending = i > sourceThinkingStep;
                      return (
                        <div key={i} className={`flex items-center gap-2.5 py-1.5 px-2 rounded-md transition-all duration-500 ${isActive ? 'bg-[#0DBCBA]/15' : ''}`}
                          style={{ opacity: isPending ? 0.3 : 1, transform: isPending ? 'translateX(4px)' : 'translateX(0)', transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                            {isComplete ? <CheckCircle2 className="w-3.5 h-3.5 text-[#0DBCBA]" /> : isActive ? <Loader2 className="w-3.5 h-3.5 text-[#0DBCBA] animate-spin" /> : <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />}
                          </div>
                          <span className={`text-xs transition-colors duration-300 ${isActive ? 'text-[#0A8B89] font-medium' : isComplete ? 'text-[#0DBCBA]' : 'text-gray-400'}`}>{step}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 h-1 bg-[#0DBCBA]/20 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#0DBCBA] to-[#0A8B89] rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${sourceThinkingSteps.length > 0 ? ((sourceThinkingStep + 1) / sourceThinkingSteps.length) * 100 : 0}%` }} />
                  </div>
                </CardContent>
              </Card>
            ) : sourceSummaryError ? (
              <Card className="border-red-100 bg-red-50/30">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-red-600 text-sm">{sourceSummaryError}</span>
                    <Button variant="ghost" size="sm" onClick={fetchSourceSummary} className="text-xs">Retry</Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
            </div>

            {/* Cited pages — the pages from this source that AI answers cite */}
            <TabsContent value="pages" className="px-6 py-4 mt-0 focus-visible:outline-none">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#13274F]">Cited pages</h3>
                  {companyMentionedFilter === 'not-mentioned' && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      Pages cited in responses where {companyName || 'the company'} wasn’t mentioned
                    </p>
                  )}
                  {companyMentionedFilter === 'mentioned' && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      Pages cited in responses where {companyName || 'the company'} was mentioned
                    </p>
                  )}
                </div>
                {uniqueCitations.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadCSV}
                    className="h-7 px-2.5 text-xs gap-1 shrink-0 text-gray-600 hover:text-[#13274F]"
                  >
                    <Download className="w-3 h-3" />
                    Download CSV
                  </Button>
                )}
              </div>
              {uniqueCitations.length > 0 ? (
                <div className="space-y-2.5">
                  {uniqueCitations.map((citation, index) => (
                    <div
                      key={index}
                      className="flex items-start justify-between gap-3 p-3.5 rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all group"
                    >
                      <div className="min-w-0 flex-1">
                        {/* Title */}
                        {citation.title && (
                          <h4 className="text-sm font-medium text-gray-900 group-hover:text-[#13274F] transition-colors mb-1 line-clamp-2">
                            {citation.title}
                          </h4>
                        )}
                        {/* Snippet */}
                        {citation.snippet && (
                          <p className="text-xs text-gray-600 mb-2 line-clamp-2">
                            {decodeUnicodeEscapes(citation.snippet)}
                          </p>
                        )}
                        {/* URLs */}
                        <div className="space-y-1">
                          {citation.urls && citation.urls.length > 1 ? (
                            <div className="space-y-1">
                              {citation.urls.map((url, urlIndex) => (
                                <div key={urlIndex} className="flex items-center gap-2">
                                  <ExternalLink className="w-3 h-3 text-gray-400 group-hover:text-[#0DBCBA] flex-shrink-0" />
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-[#0DBCBA] hover:text-[#0A8B89] truncate hover:underline"
                                  >
                                    {url.length > 80
                                      ? url.substring(0, 80) + '...'
                                      : url
                                    }
                                  </a>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <ExternalLink className="w-3 h-3 text-gray-400 group-hover:text-[#0DBCBA] flex-shrink-0" />
                              <a
                                href={citation.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-[#0DBCBA] hover:text-[#0A8B89] truncate hover:underline"
                              >
                                {citation.url.length > 80
                                  ? citation.url.substring(0, 80) + '...'
                                  : citation.url
                                }
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 whitespace-nowrap"
                          title={`Cited in ${citation.mentionCount || 1} answer${(citation.mentionCount || 1) === 1 ? '' : 's'}`}
                        >
                          {citation.mentionCount || 1} mention{(citation.mentionCount || 1) === 1 ? '' : 's'}
                        </span>
                        {citation.grouped && (
                          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-500 whitespace-nowrap">
                            {citation.urlCount} URL{citation.urlCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10">
                  <p className="text-sm text-gray-500">No pages found for this source.</p>
                </div>
              )}
            </TabsContent>

            {/* Prompts — which prompts surface this source, and how often the company is mentioned alongside */}
            <TabsContent value="prompts" className="px-6 py-4 mt-0 focus-visible:outline-none">
              <p className="text-xs text-gray-500 mb-3">
                Prompts whose AI answers cite {getSourceDisplayName(source.domain)}, and how often {companyName || 'the company'} is mentioned alongside.
              </p>
              {promptAggs.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm text-gray-500">No prompt data for this source in the selected period.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {promptAggs.map((agg) => (
                    <div
                      key={agg.id}
                      className="flex items-center gap-3 rounded-xl border border-gray-100 p-3.5 hover:border-gray-200 hover:shadow-sm transition-all"
                    >
                      <div className="flex flex-col items-center shrink-0 w-11">
                        <RateDonut rate={agg.total > 0 ? agg.mentioned / agg.total : 0} />
                        <span className="mt-1 text-[10px] font-semibold text-gray-500">
                          {agg.total > 0 ? Math.round((agg.mentioned / agg.total) * 100) : 0}%
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 line-clamp-2">{agg.text}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {agg.theme && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-gray-500 border-gray-200">
                              {agg.theme}
                            </Badge>
                          )}
                          {agg.type && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-gray-500 border-gray-200 capitalize">
                              {agg.type}
                            </Badge>
                          )}
                          <span className="text-[11px] text-gray-400">
                            {agg.mentioned} of {agg.total} answer{agg.total === 1 ? '' : 's'} mention {companyName || 'the company'}
                          </span>
                        </div>
                      </div>
                      {agg.models.length > 0 && (
                        <div className="flex -space-x-1.5 shrink-0">
                          {agg.models.slice(0, 4).map((m) => (
                            <div
                              key={m}
                              className="w-6 h-6 rounded-full bg-white border border-gray-100 shadow-sm grid place-items-center"
                              title={m}
                            >
                              <LLMLogo modelName={m} size="sm" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Opportunities — prompts answered without the company, and the pages filling that space */}
            <TabsContent value="opportunities" className="px-6 py-4 mt-0 focus-visible:outline-none">
              {gapAnswerCount === 0 && searchGapPages.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <CheckCircle2 className="w-8 h-8 text-[#0DBCBA] mb-2" />
                  <p className="text-sm font-medium text-[#13274F]">No gaps on this source</p>
                  <p className="text-xs text-gray-500 mt-1 max-w-sm">
                    {companyName || 'The company'} is mentioned in every AI answer citing {getSourceDisplayName(source.domain)} in the selected period.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {gapAnswerCount > 0 && (
                    <div className="rounded-xl border border-[#DB5E89]/20 bg-[#DB5E89]/5 px-4 py-3 text-sm text-[#13274F]">
                      {gapPages.length > 0 ? (
                        <>
                          <span className="font-semibold">{opportunityPages.length} page{opportunityPages.length === 1 ? '' : 's'}</span>
                          {' '}from {getSourceDisplayName(source.domain)} {opportunityPages.length === 1 ? 'is' : 'are'} filling space in{' '}
                          <span className="font-semibold">{gapAnswerCount} answer{gapAnswerCount === 1 ? '' : 's'}</span>
                          {' '}that don’t mention <span className="font-semibold">{companyName || 'your company'}</span>.
                          {' '}Expand a page to see the questions it answers and the themes and job functions it impacts.
                        </>
                      ) : (
                        <>
                          <span className="font-semibold">{gapAnswerCount} answer{gapAnswerCount === 1 ? '' : 's'}</span>
                          {' '}cite{gapAnswerCount === 1 ? 's' : ''} {getSourceDisplayName(source.domain)} without mentioning{' '}
                          <span className="font-semibold">{companyName || 'your company'}</span>, but no specific pages were linked.
                        </>
                      )}
                    </div>
                  )}
                  {(gapPages.length > 0 || urllessGapPrompts.length > 0) && (
                    <div className="space-y-2">
                      {visibleOpportunityPages.map((page) => {
                        const isExpanded = expandedPrompts.has(page.url);
                        return (
                          <div key={page.url} className="rounded-xl border border-gray-100 overflow-hidden hover:border-gray-200 transition-colors">
                            <div
                              role="button"
                              tabIndex={0}
                              aria-expanded={isExpanded}
                              onClick={() => togglePromptExpanded(page.url)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePromptExpanded(page.url); } }}
                              className="w-full flex items-start gap-2.5 p-3.5 text-left cursor-pointer hover:bg-gray-50/70 transition-colors"
                            >
                              <ChevronRight
                                className={`w-4 h-4 text-gray-400 shrink-0 mt-0.5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 line-clamp-1">
                                  {page.title || page.url.replace(/^https?:\/\/(www\.)?/, '')}
                                </p>
                                <a
                                  href={page.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 max-w-full text-[11px] text-[#0DBCBA] hover:text-[#0A8B89] hover:underline"
                                >
                                  <span className="truncate">{page.url}</span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                                {(page.themes.length > 0 || page.functions.length > 0) && (
                                  <p className="mt-0.5 text-[11px] text-gray-400">
                                    Impacts{' '}
                                    {page.themes.length > 0 && `${page.themes.length} theme${page.themes.length === 1 ? '' : 's'}`}
                                    {page.themes.length > 0 && page.functions.length > 0 && ' · '}
                                    {page.functions.length > 0 && `${page.functions.length} job function${page.functions.length === 1 ? '' : 's'}`}
                                  </p>
                                )}
                              </div>
                              <span className="shrink-0 rounded-full bg-[#DB5E89]/10 text-[#DB5E89] text-[11px] font-semibold px-2 py-0.5">
                                {page.answers} answer{page.answers === 1 ? '' : 's'} without you
                              </span>
                            </div>
                            {isExpanded && renderGapPrompts(page.prompts)}
                          </div>
                        );
                      })}
                      {urllessGapPrompts.length > 0 && (() => {
                        const urllessAnswers = urllessGapPrompts.reduce((s, p) => s + p.count, 0);
                        const isExpanded = expandedPrompts.has('__urlless');
                        return (
                          <div key="__urlless" className="rounded-xl border border-gray-100 overflow-hidden hover:border-gray-200 transition-colors">
                            <div
                              role="button"
                              tabIndex={0}
                              aria-expanded={isExpanded}
                              onClick={() => togglePromptExpanded('__urlless')}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePromptExpanded('__urlless'); } }}
                              className="w-full flex items-start gap-2.5 p-3.5 text-left cursor-pointer hover:bg-gray-50/70 transition-colors"
                            >
                              <ChevronRight
                                className={`w-4 h-4 text-gray-400 shrink-0 mt-0.5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900">{getSourceDisplayName(source.domain)} cited by name</p>
                                <p className="text-[11px] text-gray-400">The AI referenced this source without linking a specific page</p>
                              </div>
                              <span className="shrink-0 rounded-full bg-[#DB5E89]/10 text-[#DB5E89] text-[11px] font-semibold px-2 py-0.5">
                                {urllessAnswers} answer{urllessAnswers === 1 ? '' : 's'} without you
                              </span>
                            </div>
                            {isExpanded && renderGapPrompts(urllessGapPrompts)}
                          </div>
                        );
                      })()}
                      {opportunityPages.length > OPPORTUNITY_PREVIEW_COUNT && (
                        <button
                          onClick={() => setShowAllOpportunities(v => !v)}
                          className="w-full rounded-xl border border-dashed border-gray-200 py-2 text-xs font-medium text-gray-500 hover:text-[#13274F] hover:border-gray-300 transition-colors"
                        >
                          {showAllOpportunities
                            ? `Show top ${OPPORTUNITY_PREVIEW_COUNT}`
                            : `Show all ${opportunityPages.length} pages`}
                        </button>
                      )}
                      {lowSignalPageCount > 0 && (
                        <p className="px-1 text-[11px] text-gray-400">
                          {significantGapPages.length > 0
                            ? `${lowSignalPageCount} more page${lowSignalPageCount === 1 ? '' : 's'} appeared in only one answer — hidden as low signal.`
                            : `Showing the top ${opportunityPages.length} of ${gapPages.length} pages — none appears in more than one answer yet.`}
                        </p>
                      )}
                    </div>
                  )}
                  {selectedThemeFilter === 'all' && searchGapPages.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">From Google results</h4>
                      <p className="text-xs text-gray-500 mb-2">
                        Pages from {getSourceDisplayName(source.domain)} ranking in search — outside AI answers.
                      </p>
                      <div className="space-y-2">
                        {searchGapPages.slice(0, 8).map((page) => (
                          <div key={page.url} className="flex items-start gap-2">
                            <ExternalLink className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-gray-800 truncate">{page.title}</p>
                              <a
                                href={page.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-[#0DBCBA] hover:text-[#0A8B89] hover:underline break-all line-clamp-1"
                              >
                                {page.url}
                              </a>
                            </div>
                          </div>
                        ))}
                        {searchGapPages.length > 8 && (
                          <p className="text-[11px] text-gray-400">+{searchGapPages.length - 8} more in search results</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>

        {/* Floating Ask AI button — bottom right of panel */}
        {!sourceSummary && !loadingSourceSummary && !sourceSummaryError && (
          <div className="absolute bottom-6 right-6 z-10 animate-slideUpGlow rounded-full">
            <button
              onClick={fetchSourceSummary}
              className="h-12 rounded-full bg-[#13274F] text-white shadow-lg hover:bg-[#1a3468] transition-all hover:scale-105 flex items-center justify-center gap-2 px-5"
            >
              <img alt="PerceptionX" className="h-5 w-5 object-contain shrink-0 brightness-0 invert" src="/logos/perceptionx-small.png" />
              <span className="text-sm font-medium whitespace-nowrap">Ask AI</span>
              <span className="text-[10px] font-semibold bg-[#DB5E89] text-white px-1.5 py-0.5 rounded-full leading-none">BETA</span>
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}; 