import { useState, useMemo, useEffect, useRef, useTransition, useDeferredValue, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import ReactMarkdown from 'react-markdown';
import { Sparkles, Loader2, CheckCircle2, TrendingUp, TrendingDown, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollablePills } from "./ScrollablePills";
import { Button } from "@/components/ui/button";
import { extractSourceUrl } from "@/utils/citationUtils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { getCompetitorFavicon } from "@/utils/citationUtils";
import LLMLogo from "@/components/LLMLogo";
import { getLLMDisplayName } from "@/config/llmLogos";
import { usePersistedState } from "@/hooks/usePersistedState";
// Canonicalization now happens at the data layer (prompt_responses_canonical
// view). The dashboard receives detected_competitors with variants already
// merged into canonical entities, so no client-side alias hook is needed.

interface TimeBasedData {
  name: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

interface CompetitorsTabProps {
  topCompetitors: { company: string; count: number }[];
  responses: any[];
  companyName: string;
  searchResults?: any[];
  responseTexts?: Record<string, string>;
  fetchResponseTexts?: (ids: string[]) => Promise<Record<string, string>>;
  previousPeriodResponses?: any[];
  // Global job-function filter, shared across all dashboard tabs and owned by
  // the parent Dashboard so a selection persists when switching tabs.
  selectedJobFunction?: string;
  onJobFunctionChange?: (value: string) => void;
}

export const CompetitorsTab = memo(({ topCompetitors, responses, companyName, searchResults = [], responseTexts = {}, fetchResponseTexts, previousPeriodResponses = [], selectedJobFunction = 'all', onJobFunctionChange }: CompetitorsTabProps) => {
  // Modal states - persisted
  const [selectedCompetitor, setSelectedCompetitor] = usePersistedState<string | null>('competitorsTab.selectedCompetitor', null);
  const [isCompetitorModalOpen, setIsCompetitorModalOpen] = usePersistedState<boolean>('competitorsTab.isCompetitorModalOpen', false);
  const [competitorSnippets, setCompetitorSnippets] = useState<{ snippet: string; full: string }[]>([]);
  const [expandedSnippetIdx, setExpandedSnippetIdx] = useState<number | null>(null);
  const [competitorSummary, setCompetitorSummary] = useState<string>("");
  const [loadingCompetitorSummary, setLoadingCompetitorSummary] = useState(false);
  const [competitorSummaryError, setCompetitorSummaryError] = useState<string | null>(null);
  const [competitorThinkingStep, setCompetitorThinkingStep] = useState<number>(-1);
  const [competitorThinkingSteps, setCompetitorThinkingSteps] = useState<string[]>([]);
  const [competitorSummarySources, setCompetitorSummarySources] = useState<{ domain: string; url: string | null; displayName: string }[]>([]);
  // Track last competitor we auto-fetched a summary for, so reopening the
  // sheet for the same competitor doesn't re-fire, but switching does.
  const lastCompetitorFetchKeyRef = useRef<string>("");

  const [isMentionsDrawerOpen, setIsMentionsDrawerOpen] = usePersistedState<boolean>('competitorsTab.isMentionsDrawerOpen', false);
  const [expandedMentionIdx, setExpandedMentionIdx] = useState<number | null>(null);
  const [selectedSource, setSelectedSource] = usePersistedState<{ domain: string; count: number } | null>('competitorsTab.selectedSource', null);
  const [isSourceModalOpen, setIsSourceModalOpen] = usePersistedState<boolean>('competitorsTab.isSourceModalOpen', false);
  const [showAllCompetitorSources, setShowAllCompetitorSources] = useState(false);
  // Filter state - persisted
  const [selectedCompetitorTypeFilter, setSelectedCompetitorTypeFilter] = usePersistedState<'all' | 'direct'>('competitorsTab.selectedCompetitorTypeFilter', 'direct');
  const deferredCompetitorTypeFilter = useDeferredValue(selectedCompetitorTypeFilter);
  // Controlled by the parent Dashboard so the job-function selection is shared
  // across all tabs and never resets on tab switch.
  const selectedJobFunctionFilter = selectedJobFunction;
  const setSelectedJobFunctionFilter = onJobFunctionChange ?? (() => {});
  const deferredJobFunctionFilter = useDeferredValue(selectedJobFunctionFilter);
  const [, startTransition] = useTransition();

  // Distinct job functions present on the prompts behind these responses.
  const getUniqueJobFunctions = useMemo(() => {
    const fns = new Set<string>();
    responses.forEach(response => {
      const fn = response.confirmed_prompts?.job_function_context?.trim();
      if (fn) fns.add(fn);
    });
    return Array.from(fns).sort();
  }, [responses]);

  const directCompetitorNames = useMemo(() => {
    const names = new Set<string>();
    responses.forEach(response => {
      const isComp = response.confirmed_prompts?.prompt_type === 'competitive' ||
                     response.confirmed_prompts?.prompt_type === 'talentx_competitive';
      if (!isComp || !response.detected_competitors) return;
      response.detected_competitors.split(',').forEach((comp: string) => {
        const name = comp.trim();
        if (name) names.add(name.toLowerCase());
      });
    });
    return names;
  }, [responses]);



  // Helper to get filtered responses based on competitor type toggle
  const getFilteredResponses = useMemo(() => {
    let filtered = responses;

    if (deferredCompetitorTypeFilter === 'direct') {
      filtered = filtered.filter(response => {
        return response.confirmed_prompts?.prompt_type === 'competitive';
      });
    }

    if (deferredJobFunctionFilter !== 'all') {
      filtered = filtered.filter(response =>
        response.confirmed_prompts?.job_function_context?.trim() === deferredJobFunctionFilter
      );
    }

    return filtered;
  }, [responses, deferredCompetitorTypeFilter, deferredJobFunctionFilter]);

  const handleCompetitorTypeToggle = (value: 'all' | 'direct') => {
    startTransition(() => {
      setSelectedCompetitorTypeFilter(value);
    });
  };



  // Helper to normalize competitor names
  const normalizeCompetitorName = (name: string): string => {
    const trimmedName = name.trim();
    const lowerName = trimmedName.toLowerCase();

    // Canonicalization happens server-side (prompt_responses_canonical view),
    // so trimmedName is already the canonical name. This function now only
    // handles noise filtering (none / n/a / numeric-only / etc.) and
    // display-name casing.

    // Check for excluded patterns first
    const excludedPatterns = [
      /^none$/i,
      /^n\/a$/i,
      /^na$/i,
      /^null$/i,
      /^undefined$/i,
      /^none\.?$/i,
      /^n\/a\.?$/i,
      /^na\.?$/i,
      /^null\.?$/i,
      /^undefined\.?$/i,
      /^none[,:;\)\]}\-_]$/i,
      /^n\/a[,:;\)\]}\-_]$/i,
      /^na[,:;\)\]}\-_]$/i,
      /^null[,:;\)\]}\-_]$/i,
      /^undefined[,:;\)\]}\-_]$/i,
      /^[0-9]+$/i, // Pure numbers
      /^[^a-zA-Z0-9]+$/i, // Only special characters
      /^[a-z]{1,2}$/i, // Single or double letter words (likely abbreviations that aren't company names)
    ];
    
    // If the name matches any excluded pattern, return empty string
    if (excludedPatterns.some(pattern => pattern.test(trimmedName))) {
      return '';
    }
    
    // Check for excluded words
    const excludedWords = new Set([
      'none', 'n/a', 'na', 'null', 'undefined', 'n/a', 'n/a.', 'n/a,', 'n/a:', 'n/a;',
      'none.', 'none,', 'none:', 'none;', 'none)', 'none]', 'none}', 'none-', 'none_',
      'n/a)', 'n/a]', 'n/a}', 'n/a-', 'n/a_', 'na.', 'na,', 'na:', 'na;', 'na)', 'na]', 'na}', 'na-', 'na_',
      'null.', 'null,', 'null:', 'null;', 'null)', 'null]', 'null}', 'null-', 'null_',
      'undefined.', 'undefined,', 'undefined:', 'undefined;', 'undefined)', 'undefined]', 'undefined}', 'undefined_',
      'n/a', 'n/a.', 'n/a,', 'n/a:', 'n/a;', 'n/a)', 'n/a]', 'n/a}', 'n/a-', 'n/a_',
      'none', 'none.', 'none,', 'none:', 'none;', 'none)', 'none]', 'none}', 'none-', 'none_',
      'na', 'na.', 'na,', 'na:', 'na;', 'na)', 'na]', 'na}', 'na-', 'na_'
    ]);
    
    if (excludedWords.has(lowerName)) {
      return '';
    }
    
    // If name is too short or empty after trimming, return empty string
    if (trimmedName.length <= 1) {
      return '';
    }
    
    const aliases: { [key: string]: string } = {
      'amazon web services': 'AWS',
      'google cloud': 'GCP',
      // Add other aliases as needed
    };
    for (const alias in aliases) {
      if (lowerName === alias) {
        return aliases[alias];
      }
    }
    return trimmedName.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  // Helper to get sources contributing to competitor mentions
  const getCompetitorSources = (competitorName: string) => {
    const sourceCounts: Record<string, number> = {};
    
    getFilteredResponses.forEach(response => {
      // Check if response mentions the competitor
      if (response.response_text?.toLowerCase().includes(competitorName.toLowerCase())) {
        // Parse citations from the response
        try {
          const citations = typeof response.citations === 'string' 
            ? JSON.parse(response.citations) 
            : response.citations;
          
          if (Array.isArray(citations)) {
            citations.forEach((citation: any) => {
              if (citation.domain) {
                sourceCounts[citation.domain] = (sourceCounts[citation.domain] || 0) + 1;
              }
            });
          }
        } catch {
          // Skip invalid citations
        }
      }
    });
    
    // Convert to array and sort by count
    return Object.entries(sourceCounts)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count);
  };

  // Helper to determine competitor source (AI responses vs search results)
  const getCompetitorSourceInfo = (competitorName: string) => {
    const aiResponseCount = getFilteredResponses.filter(response => {
      if (response.detected_competitors) {
        const mentions = response.detected_competitors
          .split(',')
          .map((comp: string) => comp.trim())
          .filter((comp: string) => comp.length > 0)
          .map((comp: string) => ({ name: comp }));
        return mentions.some((mention: any) => 
          mention.name && mention.name.toLowerCase() === competitorName.toLowerCase()
        );
      }
      return false;
    }).length;

    const searchResultCount = searchResults.filter(result => {
      if (result.detectedCompetitors && result.detectedCompetitors.trim()) {
        const competitors = result.detectedCompetitors
          .split(',')
          .map((comp: string) => comp.trim().toLowerCase());
        return competitors.includes(competitorName.toLowerCase());
      }
      return false;
    }).length;

    return {
      aiResponseCount,
      searchResultCount,
      totalCount: aiResponseCount + searchResultCount,
      sources: []
    };
  };

  // Helper to get favicon for a domain
  const getFavicon = (domain: string): string => {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  };

  // Helper to format domain to a human-friendly name
  const getSourceDisplayName = (domain: string) => {
    // Remove www. and domain extension
    let name = domain.replace(/^www\./, "");
    name = name.replace(/\.(com|org|net|io|co|edu|gov|info|biz|us|uk|ca|au|in|de|fr|jp|ru|ch|it|nl|se|no|es|mil|tv|me|ai|ly|app|site|online|tech|dev|xyz|pro|club|store|blog|io|co|us|ca|uk|au|in|de|fr|jp|ru|ch|it|nl|se|no|es|mil|tv|me|ai|ly|app|site|online|tech|dev|xyz|pro|club|store|blog)(\.[a-z]{2})?$/, "");
    // Capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  // Group responses into current period and previous period (applying same filter to both)
  const groupResponsesByTimePeriod = useMemo(() => {
    let filteredPrevious = previousPeriodResponses;
    if (deferredCompetitorTypeFilter === 'direct') {
      filteredPrevious = filteredPrevious.filter(response =>
        response.confirmed_prompts?.prompt_type === 'competitive'
      );
    }
    if (deferredJobFunctionFilter !== 'all') {
      filteredPrevious = filteredPrevious.filter(response =>
        response.confirmed_prompts?.job_function_context?.trim() === deferredJobFunctionFilter
      );
    }
    return {
      current: getFilteredResponses,
      previous: filteredPrevious
    };
  }, [getFilteredResponses, previousPeriodResponses, deferredCompetitorTypeFilter, deferredJobFunctionFilter]);

  // Coverage denominators: how many responses are analyzed. A competitor's
  // percentage is "share of these responses that mention it", so they do NOT
  // sum to 100 across competitors.
  const totalResponsesAnalyzed = getFilteredResponses.length;
  const totalPrevResponsesAnalyzed = groupResponsesByTimePeriod.previous.length;

  // Calculate time-based competitor data with share % deltas
  const timeBasedCompetitors = useMemo(() => {
    const { current, previous } = groupResponsesByTimePeriod;

    const getCompetitorCounts = (responseList: any[]) => {
      const counts: Record<string, number> = {};
      responseList.forEach(response => {
        if (response.detected_competitors) {
          const mentions = response.detected_competitors
            .split(',')
            .map((comp: string) => comp.trim())
            .filter((comp: string) => comp.length > 0);
          const seen = new Set<string>();
          mentions.forEach((comp: string) => {
            const name = normalizeCompetitorName(comp);
            if (name && name.toLowerCase() !== companyName.toLowerCase() && name.length > 1 && !seen.has(name)) {
              seen.add(name);
              counts[name] = (counts[name] || 0) + 1;
            }
          });
        }
      });
      return counts;
    };

    const currentCompetitors = getCompetitorCounts(current);
    const previousCompetitors = getCompetitorCounts(previous);

    // Combine all unique competitors
    const allNames = new Set([
      ...Object.keys(currentCompetitors),
      ...Object.keys(previousCompetitors)
    ]);

    const timeBasedData: TimeBasedData[] = Array.from(allNames).map(competitor => {
      const currentCount = currentCompetitors[competitor] || 0;
      const previousCount = previousCompetitors[competitor] || 0;

      return {
        name: competitor,
        current: currentCount,
        previous: previousCount,
        change: currentCount - previousCount,
        changePercent: 0  // computed later in renderAllTimeBar using consistent totals
      };
    });

    let result = timeBasedData.sort((a, b) => b.current - a.current);

    if (deferredCompetitorTypeFilter === 'direct') {
      result = result.filter(competitor =>
        directCompetitorNames.has(competitor.name.toLowerCase())
      );
    }

    return result;
  }, [groupResponsesByTimePeriod, companyName, deferredCompetitorTypeFilter, directCompetitorNames]);


  // Calculate all-time competitor data based on filtered responses
  const allTimeCompetitors = useMemo(() => {
    const competitorCounts: Record<string, number> = {};
    
    // Count from filtered AI responses
    getFilteredResponses.forEach(response => {
      if (response.detected_competitors) {
        const mentions = response.detected_competitors
          .split(',')
          .map((comp: string) => comp.trim())
          .filter((comp: string) => comp.length > 0);
        
        // Dedupe per response: a competitor counts once per response so the
        // count is "responses mentioning it", not raw mention occurrences.
        const seen = new Set<string>();
        mentions.forEach((name: string) => {
          const normalized = normalizeCompetitorName(name);
          if (normalized &&
              normalized.toLowerCase() !== companyName.toLowerCase() &&
              normalized.length > 1 &&
              !seen.has(normalized)) {
            seen.add(normalized);
            competitorCounts[normalized] = (competitorCounts[normalized] || 0) + 1;
          }
        });
      }
    });

    if (deferredCompetitorTypeFilter === 'all') {
      searchResults.forEach(result => {
        if (result.detectedCompetitors && result.detectedCompetitors.trim()) {
          const competitors = result.detectedCompetitors
            .split(',')
            .map((comp: string) => comp.trim());
          
          competitors.forEach(competitor => {
            const name = normalizeCompetitorName(competitor);
            if (name && 
                name.toLowerCase() !== companyName.toLowerCase() &&
                name.length > 1) {
              competitorCounts[name] = (competitorCounts[name] || 0) + 1;
            }
          });
        }
      });
    }

    return Object.entries(competitorCounts)
      .map(([name, count]) => ({ name, count, change: 0 }))
      .sort((a, b) => b.count - a.count);
  }, [getFilteredResponses, companyName, deferredCompetitorTypeFilter, searchResults]);

  // Merge change data into all-time competitors
  const allTimeCompetitorsWithChanges = useMemo(() => {
    const changeData = new Map<string, { change: number; changePercent: number; previous: number }>();
    timeBasedCompetitors.forEach(competitor => {
      changeData.set(competitor.name, { change: competitor.change, changePercent: competitor.changePercent, previous: competitor.previous });
    });

    // Excluded competitors and words
    const excludedCompetitors = new Set([
      'glassdoor', 'indeed', 'ambitionbox', 'workday', 'linkedin', 'monster', 'careerbuilder', 'ziprecruiter',
      'dice', 'angelist', 'wellfound', 'builtin', 'stackoverflow', 'github'
    ]);
    
    const excludedWords = new Set([
      'none', 'n/a', 'na', 'null', 'undefined', 'n/a', 'n/a.', 'n/a,', 'n/a:', 'n/a;',
      'none.', 'none,', 'none:', 'none;', 'none)', 'none]', 'none}', 'none-', 'none_',
      'n/a)', 'n/a]', 'n/a}', 'n/a-', 'n/a_', 'na.', 'na,', 'na:', 'na;', 'na)', 'na]', 'na}', 'na-', 'na_',
      'null.', 'null,', 'null:', 'null;', 'null)', 'null]', 'null}', 'null-', 'null_',
      'undefined.', 'undefined,', 'undefined:', 'undefined;', 'undefined)', 'undefined]', 'undefined}', 'undefined_',
      'n/a', 'n/a.', 'n/a,', 'n/a:', 'n/a;', 'n/a)', 'n/a]', 'n/a}', 'n/a-', 'n/a_',
      'none', 'none.', 'none,', 'none:', 'none;', 'none)', 'none]', 'none}', 'none-', 'none_',
      'na', 'na.', 'na,', 'na:', 'na;', 'na)', 'na]', 'na}', 'na-', 'na_'
    ]);

    const filteredCompetitors = allTimeCompetitors
      .filter(competitor => 
        !excludedCompetitors.has(competitor.name.toLowerCase()) &&
        !excludedWords.has(competitor.name.toLowerCase())
      );

    return filteredCompetitors.map(competitor => {
      const prev = changeData.get(competitor.name)?.previous || 0;
      return {
        ...competitor,
        change: changeData.get(competitor.name)?.change || 0,
        previousCount: prev,
        hasPreviousData: prev > 0
      };
    });
  }, [allTimeCompetitors, timeBasedCompetitors]);

  // Helper to extract snippets for a competitor from all responses
  const getSnippetsForCompetitor = (competitor: string) => {
    const snippets: { snippet: string; full: string }[] = [];
    // Regex to match competitor name with optional bolding and punctuation after
    const competitorPattern = `(?:\\*\\*|__)?${competitor.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:\\*\\*|__)?[\\s]*[:*\-]*`;
    const regex = new RegExp(`((?:\\S+\\s+){0,4})(${competitorPattern})`, 'gi');
    getFilteredResponses.forEach(response => {
      if (!response.response_text) return;
      let match;
      while ((match = regex.exec(response.response_text)) !== null) {
        // Get 4 words before
        const before = match[1]?.split(/\s+/).slice(-4).join(' ') || '';
        // Find the index just after the match
        const afterStartIdx = match.index + match[0].length;
        // Take the next 12 words from the remaining text
        const afterText = response.response_text.slice(afterStartIdx).replace(/^([:*\-\s])+/, '');
        const after = afterText.split(/\s+/).slice(0, 12).join(' ');
        snippets.push({
          snippet: `${before} ${match[2]} ${after}`.trim(),
          full: response.response_text
        });
      }
    });
    return snippets;
  };

  const handleCompetitorClick = (competitor: string) => {
    const snippets = getSnippetsForCompetitor(competitor);
    setSelectedCompetitor(competitor);
    setCompetitorSnippets(snippets);
    setShowAllCompetitorSources(false);
    setIsCompetitorModalOpen(true);
  };

  const handleCloseCompetitorModal = () => {
    setIsCompetitorModalOpen(false);
    setSelectedCompetitor(null);
    setCompetitorSnippets([]);
    setShowAllCompetitorSources(false);
    setCompetitorSummary("");
    setCompetitorSummaryError(null);
    setCompetitorThinkingStep(-1);
    setCompetitorThinkingSteps([]);
    setCompetitorSummarySources([]);
  };

  const handleSourceClick = (source: { domain: string; count: number }) => {
    setSelectedSource(source);
    setIsSourceModalOpen(true);
  };

  const handleCloseSourceModal = () => {
    setIsSourceModalOpen(false);
    setSelectedSource(null);
  };

  // Helper to get all full responses mentioning a competitor
  const getFullResponsesForCompetitor = (competitor: string) => {
    return responses.filter(response => {
      // Check if competitor is mentioned in detected_competitors field
      if (response.detected_competitors) {
        const mentions = response.detected_competitors
          .split(',')
          .map((comp: string) => comp.trim())
          .filter((comp: string) => comp.length > 0)
          .map((comp: string) => ({ name: comp }));
        const hasMention = mentions.some((mention: any) => 
          mention.name && mention.name.toLowerCase() === competitor.toLowerCase()
        );
        if (hasMention) return true;
      }
      
      // Also check if competitor is mentioned in response text
      if (response.response_text) {
        const competitorPattern = `(?:\\*\\*|__)?${competitor.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:\\*\\*|__)?[\\s]*[:*\-]*`;
        const regex = new RegExp(competitorPattern, 'i');
        return regex.test(response.response_text);
      }
      
      return false;
    });
  };

  // Helper to highlight competitor name and remove other bold/italic
  function highlightCompetitor(snippet: string, competitor: string) {
    // Remove all markdown bold/italic except for the competitor name
    // 1. Remove all **text** and __text__ and *text* and _text_ except for competitor
    // 2. Highlight competitor name (case-insensitive, all occurrences)
    // 3. Return as HTML string
    // First, escape competitor for regex
    const competitorEscaped = competitor.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    // Remove bold/italic markdown except for competitor name
    let clean = snippet
      // Remove **text** and __text__ unless it's the competitor
      .replace(/(\*\*|__)(?!\s*" + competitorEscaped + ")(.*?)\1/g, '$2')
      // Remove *text* and _text_ unless it's the competitor
      .replace(/(\*|_)(?!\s*" + competitorEscaped + ")(.*?)\1/g, '$2');
    // Now highlight competitor name (all case-insensitive occurrences)
    const regex = new RegExp(`(${competitorEscaped})`, 'gi');
    clean = clean.replace(regex, '<span class="bg-yellow-200 font-bold">$1</span>');
    return clean;
  }

  const fetchCompetitorSummary = async () => {
    if (!selectedCompetitor) return;
    // Capture the key this fetch was kicked off for. If the user switches
    // competitors before the response lands, we'll discard stale results
    // rather than overwriting the new one.
    const fetchKey = selectedCompetitor;
    setCompetitorSummary("");
    setCompetitorSummaryError(null);
    setLoadingCompetitorSummary(true);
    setCompetitorThinkingStep(0);
    setCompetitorThinkingSteps([]);

    const allResponses = getFullResponsesForCompetitor(selectedCompetitor);
    if (allResponses.length === 0) {
      setCompetitorSummaryError("No responses found for this competitor.");
      setLoadingCompetitorSummary(false);
      setCompetitorThinkingStep(-1);
      return;
    }

    // Cap the prompt size to stay well under Claude's per-minute token budget
    // (org limit: 30k input tokens/min). Popular competitors can have 200+
    // mentions; sending all of them blows the budget. Sample down hard.
    const MAX_RESPONSES = 25;
    const RESPONSE_EXCERPT_CHARS = 300;
    const totalResponseCount = allResponses.length;
    const relevantResponses =
      totalResponseCount > MAX_RESPONSES ? allResponses.slice(0, MAX_RESPONSES) : allResponses;

    let texts = responseTexts;
    const missingTextIds = relevantResponses.filter(r => !r.response_text && !texts[r.id]).map(r => r.id);
    if (missingTextIds.length > 0 && fetchResponseTexts) {
      texts = await fetchResponseTexts(missingTextIds) || texts;
    }

    const sourceMap: { domain: string; url: string | null; displayName: string }[] = [];
    const seenDomains = new Set<string>();
    relevantResponses.forEach(r => {
      try {
        const citations = typeof r.citations === 'string' ? JSON.parse(r.citations) : r.citations;
        if (Array.isArray(citations)) {
          citations.forEach((c: any) => {
            if (c.domain && !seenDomains.has(c.domain)) {
              seenDomains.add(c.domain);
              sourceMap.push({
                domain: c.domain,
                url: c.url ? extractSourceUrl(c.url) : null,
                displayName: getSourceDisplayName(c.domain),
              });
            }
          });
        }
      } catch { /* skip */ }
    });
    setCompetitorSummarySources(sourceMap);

    // Each step previews a section the user will see in the sheet.
    const steps = [
      totalResponseCount > MAX_RESPONSES
        ? `Sampling ${relevantResponses.length} of ${totalResponseCount} responses…`
        : `Reading ${relevantResponses.length} responses…`,
      `Writing the summary…`,
      `Comparing mention frequency vs ${companyName}…`,
      `Ranking top sources…`,
      `Counting mentions by model…`,
    ];
    setCompetitorThinkingSteps(steps);

    const stepTimers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < steps.length; i++) {
      stepTimers.push(setTimeout(() => setCompetitorThinkingStep(i), i * 1100));
    }

    const sourcesList = sourceMap.map((s, i) => `[${i + 1}] ${s.displayName} (${s.domain})`).join('\n');

    // Aggregate location + job function from the responses so the AI can
    // ground the summary in the specific markets and roles being asked about.
    const locationCounts = new Map<string, number>();
    const jobFunctionCounts = new Map<string, number>();
    relevantResponses.forEach((r: any) => {
      const loc = r.confirmed_prompts?.location_context;
      const jf = r.confirmed_prompts?.job_function_context;
      if (loc) locationCounts.set(loc, (locationCounts.get(loc) ?? 0) + 1);
      if (jf) jobFunctionCounts.set(jf, (jobFunctionCounts.get(jf) ?? 0) + 1);
    });
    const topLocations = [...locationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([l, c]) => `${l} (${c})`)
      .join(', ');
    const topJobFunctions = [...jobFunctionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([j, c]) => `${j} (${c})`)
      .join(', ');

    const sampleNote =
      totalResponseCount > MAX_RESPONSES
        ? `\n(Below is a sample of ${relevantResponses.length} representative responses out of ${totalResponseCount} total. Don't claim to have read every response.)\n`
        : "";

    const prompt = `You are an employer brand analyst. Write a concise, insightful summary comparing how ${selectedCompetitor} is positioned relative to ${companyName} in the talent market.

Context:
- Markets covered (count of responses): ${topLocations || 'unspecified'}
- Job functions covered (count of responses): ${topJobFunctions || 'unspecified'}

Available sources:
${sourcesList || 'No sources available'}
${sampleNote}
Source responses:
${relevantResponses.map((r) => {
      let responseSources = '';
      try {
        const citations = typeof r.citations === 'string' ? JSON.parse(r.citations) : r.citations;
        if (Array.isArray(citations)) {
          const domains = [...new Set(citations.map((c: any) => c.domain).filter(Boolean))];
          const indices = domains.map((d: string) => sourceMap.findIndex(s => s.domain === d) + 1).filter((n: number) => n > 0);
          if (indices.length > 0) responseSources = ` [Sources: ${indices.join(', ')}]`;
        }
      } catch { /* skip */ }
      return `${(texts[r.id] || r.response_text || '').slice(0, RESPONSE_EXCERPT_CHARS)}${responseSources}`;
    }).join('\n---\n')}

Write a short, actionable analysis with three short sections. Each section uses a markdown bold header on its own line, followed by ONE or TWO short sentences. Total output is short — keep it tight. Where the data points to a specific market or job function, name it explicitly.

**What sets them apart**
What makes ${selectedCompetitor} distinctive as an employer — the one or two things that stand out, naming the relevant market(s) or roles where this is most evident.

**How ${companyName} compares**
Where ${companyName}'s position differs — be specific about a strength and a weakness vs ${selectedCompetitor}, again grounded in a market or role if the data supports it.

**Your move**
One concrete, actionable recommendation for ${companyName}'s talent strategy in response to ${selectedCompetitor} — ideally targeted at a specific market or function.

Be direct, specific, professional. No hedging, no preamble, no summary paragraph. Do not open with "${selectedCompetitor} is...". **Do NOT include a top-level title or heading** (no "# Title", no "## Heading"). Only the three bold section headers exactly as specified.

CRITICAL: When you reference information from a source, add an inline citation like [1], [2], etc. matching the source numbers above. Place citations naturally at the end of the relevant sentence. Use citations frequently. Only cite sources from the numbered list above.`;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setCompetitorSummaryError("Authentication required");
        setLoadingCompetitorSummary(false);
        setCompetitorThinkingStep(-1);
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
      // Drop stale responses if the user has since switched competitors.
      if (lastCompetitorFetchKeyRef.current !== fetchKey) return;
      if (data.response) {
        setCompetitorSummary(data.response.trim());
      } else {
        const isRateLimit = /rate limit|429/i.test(data.error || "");
        setCompetitorSummaryError(
          isRateLimit
            ? "We're a bit overloaded right now — give it a moment."
            : "Couldn't generate the summary. Try again?",
        );
      }
    } catch {
      stepTimers.forEach(clearTimeout);
      if (lastCompetitorFetchKeyRef.current !== fetchKey) return;
      setCompetitorSummaryError("Couldn't generate the summary. Try again?");
    } finally {
      if (lastCompetitorFetchKeyRef.current === fetchKey) {
        setLoadingCompetitorSummary(false);
        setCompetitorThinkingStep(-1);
      }
    }
  };

  // Auto-generate the competitor summary whenever the sheet is opened for a
  // new competitor. Reset stale state so switching competitors re-fetches.
  useEffect(() => {
    if (!isCompetitorModalOpen || !selectedCompetitor) return;
    if (selectedCompetitor === lastCompetitorFetchKeyRef.current) return;
    setCompetitorSummary("");
    setCompetitorSummaryError(null);
    setLoadingCompetitorSummary(false);
    lastCompetitorFetchKeyRef.current = selectedCompetitor;
    fetchCompetitorSummary();
    // fetchCompetitorSummary intentionally omitted — closes over current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompetitorModalOpen, selectedCompetitor]);

  // Stagger-reveal the cards below the AI summary. They stay hidden while
  // the summary is generating, then cascade in once it's ready.
  const [competitorRevealStep, setCompetitorRevealStep] = useState(0);
  useEffect(() => {
    if (!isCompetitorModalOpen) {
      setCompetitorRevealStep(0);
      return;
    }
    if (loadingCompetitorSummary) {
      setCompetitorRevealStep(0);
      return;
    }
    if (competitorSummary || competitorSummaryError) {
      const timers = [
        setTimeout(() => setCompetitorRevealStep(1), 200),
        setTimeout(() => setCompetitorRevealStep(2), 500),
        setTimeout(() => setCompetitorRevealStep(3), 800),
      ];
      return () => timers.forEach(clearTimeout);
    }
  }, [isCompetitorModalOpen, loadingCompetitorSummary, competitorSummary, competitorSummaryError]);

  const competitorRevealClass = (step: number) =>
    `transition-all duration-500 ease-out ${
      competitorRevealStep >= step
        ? "opacity-100 translate-y-0"
        : "opacity-0 translate-y-3 pointer-events-none"
    }`;

  // Top citation domains for the selected competitor — used by the "Top
  // sources where they appear" card in the sheet. Ordered by frequency.
  const competitorComparison = useMemo(() => {
    if (!selectedCompetitor) return null;
    const competitorResponses = getFullResponsesForCompetitor(selectedCompetitor);

    const domainCounts = new Map<string, number>();
    for (const r of competitorResponses) {
      try {
        const citations =
          typeof r.citations === "string" ? JSON.parse(r.citations) : r.citations;
        if (!Array.isArray(citations)) continue;
        const seen = new Set<string>();
        for (const c of citations) {
          const d = (c?.domain || "").toLowerCase().trim();
          if (!d || seen.has(d)) continue;
          seen.add(d);
          domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
        }
      } catch {
        /* skip */
      }
    }
    const topDomains = [...domainCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([domain, count]) => ({ domain, count }));

    return { topDomains };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompetitor, responses]);

  const renderAllTimeBar = (data: { name: string; count: number; change?: number; previousCount?: number; hasPreviousData?: boolean }, maxCount: number, totalResponses: number, totalPreviousResponses: number) => {
    const barWidth = maxCount > 0 ? (data.count / maxCount) * 100 : 0;
    // Coverage: share of analyzed responses that mention this competitor.
    const mentionPercent = totalResponses > 0 ? Math.min(100, (data.count / totalResponses) * 100) : 0;
    
    const displayName = data.name;
    const truncatedName = displayName.length > 15 ? displayName.substring(0, 15) + '...' : displayName;
    
    const faviconUrl = getCompetitorFavicon(displayName);
    const initials = displayName.charAt(0).toUpperCase();
    
    return (
      <div 
        className="flex items-center py-3 hover:bg-gray-50/50 transition-colors cursor-pointer rounded-lg px-3"
        onClick={() => handleCompetitorClick(data.name)}
      >
        {/* Competitor name with favicon */}
        <div className="flex items-center space-x-3 min-w-0 w-1/3 sm:w-1/3 max-w-[140px] sm:max-w-[220px]">
          <div className="w-4 h-4 flex-shrink-0 bg-blue-100 rounded flex items-center justify-center">
            {faviconUrl ? (
              <img 
                src={faviconUrl} 
                alt={`${displayName} favicon`}
                className="w-full h-full rounded object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
                style={{ display: 'block' }}
              />
            ) : null}
            <span 
              className="text-xs font-bold text-blue-600"
              style={{ display: faviconUrl ? 'none' : 'flex' }}
            >
              {initials}
            </span>
          </div>
          <span className="text-sm font-medium text-gray-900 truncate" title={displayName}>
            {truncatedName}
          </span>
        </div>
        
        {/* Bar chart */}
        <div className="flex-1 mx-2 sm:mx-4 bg-gray-200 rounded-full h-4 relative min-w-0 max-w-[120px] sm:max-w-none">
          <div
            className="h-4 rounded-full absolute left-0 top-0"
            style={{ 
              width: `${barWidth}%`,
              backgroundColor: '#0DBCBA'
            }}
          />
        </div>
        
        {/* Percentage + change */}
        <div className="flex items-center min-w-[70px] sm:min-w-[100px] justify-end gap-1.5">
          <span className="text-sm font-semibold text-gray-900">
            {mentionPercent.toFixed(1)}%
          </span>
          <span className="w-[45px] flex justify-end">
            {(() => {
              if (!data.hasPreviousData) return null;
              const prevPct = totalPreviousResponses > 0 ? Math.min(100, ((data.previousCount || 0) / totalPreviousResponses) * 100) : 0;
              const delta = Math.round(mentionPercent - prevPct);
              if (delta === 0) return <span className="text-xs text-gray-400">-</span>;
              return (
                <span className={`text-xs font-semibold flex items-center gap-0.5 ${
                  delta > 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {delta > 0 ? <TrendingUp className="w-3 h-3 flex-shrink-0" /> : <TrendingDown className="w-3 h-3 flex-shrink-0" />}
                  <span className="whitespace-nowrap">{Math.abs(delta)}%</span>
                </span>
              );
            })()}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 w-full h-full">
      {/* Main Section Header */}
      <div className="space-y-2" data-tour="competitors-heading">
        <h2 className="text-2xl font-bold text-gray-900">Competitors</h2>
        <p className="text-gray-600">
          Track competitor mentions and analyze how {companyName} compares in AI responses and search results.
        </p>
      </div>

      {/* Job function filter */}
      {getUniqueJobFunctions.length > 0 && (
        <div className="sticky top-0 z-10 bg-white pb-2">
          <ScrollablePills
            selected={selectedJobFunctionFilter}
            onSelect={setSelectedJobFunctionFilter}
            options={[
              { value: 'all', label: 'All functions' },
              ...getUniqueJobFunctions.map((fn) => ({ value: fn, label: fn })),
            ]}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-h-0">
        <Card className="shadow-sm border border-gray-200 h-full flex flex-col">
          <CardContent className="flex-1 min-h-0 overflow-hidden p-6">
            <div className="space-y-2 h-full overflow-y-auto relative">
              <div className="sticky top-0 z-10 bg-white flex items-center justify-between gap-3 px-3 pb-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1 text-xs font-medium text-gray-400 cursor-help">
                        % of responses
                        <Info className="w-3.5 h-3.5" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[260px]">
                      <p className="text-xs">
                        Share of the analyzed AI responses that mention this competitor. A
                        response often mentions several competitors, so these percentages
                        don't add up to 100%.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-100">
                  <button
                    onClick={() => handleCompetitorTypeToggle('direct')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                      selectedCompetitorTypeFilter === 'direct'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Direct Competitors
                  </button>
                  <button
                    onClick={() => handleCompetitorTypeToggle('all')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                      selectedCompetitorTypeFilter === 'all'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    All Competitors
                  </button>
                </div>
              </div>
              {allTimeCompetitorsWithChanges.length > 0 ? (
                (() => {
                  const maxCount = Math.max(...allTimeCompetitorsWithChanges.map(c => c.count), 1);

                  return allTimeCompetitorsWithChanges.map((competitor, idx) => (
                    <div
                      key={`${competitor.name}-${deferredCompetitorTypeFilter}-${idx}`}
                      className="cursor-pointer"
                      {...(idx === 0 ? { 'data-tour': 'competitors-first-row' } : {})}
                    >
                      {renderAllTimeBar(competitor, maxCount, totalResponsesAnalyzed, totalPrevResponsesAnalyzed)}
                    </div>
                  ));
                })()
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                    <span className="text-xl font-bold text-gray-400">🏢</span>
                  </div>
                  <p className="text-sm">
                    {selectedCompetitorTypeFilter === 'direct'
                      ? "No direct competitors found in competitive prompts."
                      : "No competitor mentions found yet."
                    }
                  </p>
                  {selectedCompetitorTypeFilter === 'direct' && (
                    <p className="text-xs text-gray-400 mt-1">
                      Try switching to "All Competitors" to see all mentions.
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Competitor Panel (slide from right) */}
      <Sheet open={isCompetitorModalOpen} onOpenChange={(open) => { if (!open) handleCloseCompetitorModal(); }}>
        <SheetContent
          side="right"
          className="p-0 flex flex-col gap-0 [&>button]:hidden w-full sm:max-w-2xl inset-y-0 h-full rounded-none"
        >
          <div className="flex items-center justify-between px-5 py-4 bg-white border-b">
            <SheetTitle className="flex items-center gap-2 text-base font-semibold">
              <img
                src={getCompetitorFavicon(selectedCompetitor || '')}
                alt={`${selectedCompetitor} favicon`}
                className="w-5 h-5 rounded"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{ display: 'block' }}
              />
              <span>{selectedCompetitor}</span>
              {(() => {
                const sourceInfo = getCompetitorSourceInfo(selectedCompetitor || '');
                return <Badge variant="secondary">{sourceInfo.totalCount} mentions</Badge>;
              })()}
            </SheetTitle>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="space-y-5">
              {/* AI Summary — auto-fires on open */}
              {competitorSummary ? (
                <Card className="border-[#0DBCBA]/30 bg-[#0DBCBA]/5">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#0DBCBA]" />
                        AI Summary
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={fetchCompetitorSummary} disabled={loadingCompetitorSummary} className="text-xs text-gray-400 hover:text-gray-600 h-auto py-1">
                        {loadingCompetitorSummary ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                        Regenerate
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-gray-800 text-sm leading-relaxed">
                      {competitorSummary.split('\n\n').filter(Boolean).map((paragraph, pIdx) => {
                        const trimmed = paragraph.trim();
                        // Strip stray markdown ATX headings — the prompt forbids them
                        // but models occasionally still produce them.
                        if (/^#{1,6}\s/.test(trimmed)) return null;
                        // Header-only paragraph (just **Title**) → render as a heading
                        const headerOnlyMatch = trimmed.match(/^\*\*([^*]+)\*\*$/);
                        if (headerOnlyMatch) {
                          return (
                            <h4
                              key={pIdx}
                              className="text-sm font-semibold text-gray-900 mt-4 first:mt-0 mb-1.5"
                            >
                              {headerOnlyMatch[1]}
                            </h4>
                          );
                        }
                        // Mixed paragraph — split on citations AND inline bold
                        const parts = paragraph.split(/(\[\d+(?:\s*,\s*\d+)*\]|\*\*[^*]+\*\*)/g);
                        return (
                          <p key={pIdx} className="mb-3 last:mb-0">
                            {parts.map((part, partIdx) => {
                              const citationMatch = part.match(/^\[([\d\s,]+)\]$/);
                              const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
                              if (citationMatch) {
                                const nums = citationMatch[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
                                return (
                                  <span key={partIdx}>
                                    {nums.map((num, nIdx) => {
                                      const source = competitorSummarySources[num - 1];
                                      if (!source) return null;
                                      return (
                                        <button
                                          key={nIdx}
                                          onClick={() => { if (source.url) window.open(source.url, '_blank', 'noopener,noreferrer'); }}
                                          className={`inline-flex items-center gap-1 bg-white hover:bg-gray-50 pl-1 pr-2 py-0.5 rounded-full text-xs text-gray-600 transition-colors border border-gray-200 mx-0.5 align-middle ${source.url ? 'cursor-pointer' : 'cursor-default'}`}
                                        >
                                          <img src={getFavicon(source.domain)} alt="" className="w-3.5 h-3.5 rounded flex-shrink-0" style={{ background: '#fff', display: 'block' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                                          <span>{source.displayName}</span>
                                        </button>
                                      );
                                    })}
                                  </span>
                                );
                              }
                              if (boldMatch) {
                                return (
                                  <strong key={partIdx} className="font-semibold text-gray-900">
                                    {boldMatch[1]}
                                  </strong>
                                );
                              }
                              return <span key={partIdx}>{part}</span>;
                            })}
                          </p>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ) : loadingCompetitorSummary ? (
                <Card className="border-[#0DBCBA]/30 bg-gradient-to-br from-[#0DBCBA]/5 to-[#0DBCBA]/10 overflow-hidden">
                  <CardContent className="py-4 px-5">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="relative">
                        <Sparkles className="w-4 h-4 text-[#0DBCBA]" />
                        <div className="absolute inset-0 animate-ping">
                          <Sparkles className="w-4 h-4 text-[#0DBCBA] opacity-30" />
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-[#0A8B89]">Thinking…</span>
                    </div>
                    <div className="space-y-1">
                      {competitorThinkingSteps.map((step, i) => {
                        const isActive = i === competitorThinkingStep;
                        const isComplete = i < competitorThinkingStep;
                        const isPending = i > competitorThinkingStep;
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-2.5 py-1"
                            style={{
                              opacity: isPending ? 0.35 : 1,
                              transform: isPending ? "translateX(4px)" : "translateX(0)",
                              transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                            }}
                          >
                            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                              {isComplete ? (
                                <CheckCircle2 className="w-4 h-4 text-[#0DBCBA]" />
                              ) : isActive ? (
                                <Loader2 className="w-4 h-4 text-[#0DBCBA] animate-spin" />
                              ) : (
                                <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                              )}
                            </div>
                            <span
                              className={`text-sm ${
                                isActive
                                  ? "text-[#0A8B89] font-medium"
                                  : isComplete
                                    ? "text-[#0DBCBA]"
                                    : "text-gray-400"
                              }`}
                            >
                              {step}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ) : competitorSummaryError ? (
                <Card className="border-amber-200 bg-amber-50/40">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-amber-800 text-sm">{competitorSummaryError}</span>
                      <Button variant="ghost" size="sm" onClick={fetchCompetitorSummary} className="text-xs">
                        Retry
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {/* Top sources where this competitor appears */}
              {competitorComparison && competitorComparison.topDomains.length > 0 && (
                <Card className={competitorRevealClass(2)}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                      Top sources where they appear
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="divide-y">
                      {competitorComparison.topDomains.map(({ domain, count }) => (
                        <div key={domain} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <img
                              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                              alt=""
                              className="w-4 h-4 rounded shrink-0"
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                            <span className="text-sm text-gray-900 truncate">{domain}</span>
                          </div>
                          <span className="text-xs text-gray-500 shrink-0">{count} response{count === 1 ? "" : "s"}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Mentions by model — bar chart */}
              {selectedCompetitor && (() => {
                const competitorResponses = getFullResponsesForCompetitor(selectedCompetitor);
                const modelCounts = new Map<string, number>();
                competitorResponses.forEach((r) => {
                  if (r.ai_model) {
                    modelCounts.set(r.ai_model, (modelCounts.get(r.ai_model) ?? 0) + 1);
                  }
                });
                const sorted = [...modelCounts.entries()]
                  .map(([model, count]) => ({ model, count }))
                  .sort((a, b) => b.count - a.count);
                if (sorted.length === 0) return null;
                const maxCount = sorted[0].count;
                return (
                  <Card className={competitorRevealClass(3)}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                        Mentions by model
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2.5">
                        {sorted.map(({ model, count }) => {
                          const widthPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                          return (
                            <div key={model} className="flex items-center gap-3">
                              <div className="flex items-center gap-1.5 w-44 shrink-0">
                                <LLMLogo modelName={model} size="sm" />
                                <span className="text-sm text-gray-700 truncate">{getLLMDisplayName(model)}</span>
                              </div>
                              <div className="flex-1 relative h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#0DBCBA] rounded-full transition-all duration-500"
                                  style={{ width: `${widthPct}%` }}
                                />
                              </div>
                              <span className="text-sm font-semibold text-gray-900 w-10 text-right shrink-0 tabular-nums">
                                {count}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
            </div>
          </div>

        </SheetContent>
      </Sheet>

      {/* Mentions Drawer Modal */}
      <Dialog open={isMentionsDrawerOpen} onOpenChange={setIsMentionsDrawerOpen}>
        <DialogContent className="max-w-3xl w-full h-[90vh] flex flex-col p-0">
          <div className="flex items-center gap-2 px-6 py-4 border-b">
            <DialogTitle className="text-lg font-semibold">All Mentions of {selectedCompetitor}</DialogTitle>
            <Badge variant="secondary">{competitorSnippets.length} mentions</Badge>
          </div>
          <div className="px-6 py-3 border-b bg-gray-50">
            {/* Search input removed as requested */}
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-white">
            {competitorSnippets.length > 0 ? (
              competitorSnippets.map((item, idx) => {
                // Show only first 2 lines unless expanded
                const lines = item.snippet.split(/\n|\r/);
                const isExpanded = expandedMentionIdx === idx;
                const preview = lines.slice(0, 2).join(' ');
                const rest = lines.slice(2).join(' ');
                return (
                  <div key={idx} className="p-3 bg-gray-50 rounded border text-sm text-gray-800">
                    <div
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{
                        __html: highlightCompetitor(isExpanded ? item.snippet : preview, selectedCompetitor || "")
                      }}
                    />
                    {lines.length > 2 && (
                      <button
                        className="text-xs text-blue-600 underline mt-1 hover:text-blue-800"
                        onClick={() => setExpandedMentionIdx(isExpanded ? null : idx)}
                      >
                        {isExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-gray-500 text-sm">No mentions found.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Source Modal */}
      <Dialog open={isSourceModalOpen} onOpenChange={handleCloseSourceModal}>
        <DialogContent className="max-w-xl w-full sm:max-w-2xl sm:w-[90vw] p-2 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <img 
                src={getFavicon(selectedSource?.domain || '')} 
                alt={`${selectedSource?.domain} favicon`}
                className="w-5 h-5 rounded"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <span>Source: {selectedSource && getSourceDisplayName(selectedSource.domain)}</span>
              <Badge variant="secondary">
                {selectedSource?.count} {selectedSource?.count === 1 ? 'mention' : 'mentions'}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              <p>This source contributes to {selectedCompetitor}'s presence in your analysis.</p>
            </div>
            
            {/* Show responses that mention both the competitor and this source */}
            {selectedSource && selectedCompetitor && (() => {
              const relevantResponses = responses.filter(response => {
                // Check if response mentions both the competitor and has this source
                const mentionsCompetitor = response.response_text?.toLowerCase().includes(selectedCompetitor.toLowerCase());
                if (!mentionsCompetitor) return false;
                
                try {
                  const citations = typeof response.citations === 'string' 
                    ? JSON.parse(response.citations) 
                    : response.citations;
                  
                  if (Array.isArray(citations)) {
                    return citations.some((citation: any) => citation.domain === selectedSource.domain);
                  }
                } catch {
                  return false;
                }
                return false;
              });
              
              return (
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">
                    Responses mentioning {selectedCompetitor} from {getSourceDisplayName(selectedSource.domain)}:
                  </h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {relevantResponses.slice(0, 5).map((response, index) => (
                      <div key={index} className="p-3 bg-gray-50 rounded-lg text-sm text-gray-800">
                        <div
                          className="prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{
                            __html: highlightCompetitor((response.response_text || '').slice(0, 200) + '...', selectedCompetitor)
                          }}
                        />
                      </div>
                    ))}
                    {relevantResponses.length > 5 && (
                      <div className="text-xs text-gray-500 text-center py-2">
                        Showing first 5 of {relevantResponses.length} responses
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
});
CompetitorsTab.displayName = 'CompetitorsTab';