import { useState, useMemo, useEffect, useTransition, useDeferredValue, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import ReactMarkdown from 'react-markdown';
import { Sparkles, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { extractSourceUrl } from "@/utils/citationUtils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { getCompetitorFavicon } from "@/utils/citationUtils";
import LLMLogo from "@/components/LLMLogo";
import { getLLMDisplayName } from "@/config/llmLogos";
import { usePersistedState } from "@/hooks/usePersistedState";

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
}

export const CompetitorsTab = memo(({ topCompetitors, responses, companyName, searchResults = [], responseTexts = {}, fetchResponseTexts }: CompetitorsTabProps) => {
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

  const [isMentionsDrawerOpen, setIsMentionsDrawerOpen] = usePersistedState<boolean>('competitorsTab.isMentionsDrawerOpen', false);
  const [expandedMentionIdx, setExpandedMentionIdx] = useState<number | null>(null);
  const [selectedSource, setSelectedSource] = usePersistedState<{ domain: string; count: number } | null>('competitorsTab.selectedSource', null);
  const [isSourceModalOpen, setIsSourceModalOpen] = usePersistedState<boolean>('competitorsTab.isSourceModalOpen', false);
  const [showAllCompetitorSources, setShowAllCompetitorSources] = useState(false);
  // Filter state - persisted
  const [selectedCompetitorTypeFilter, setSelectedCompetitorTypeFilter] = usePersistedState<'all' | 'direct'>('competitorsTab.selectedCompetitorTypeFilter', 'direct');
  const deferredCompetitorTypeFilter = useDeferredValue(selectedCompetitorTypeFilter);
  const [, startTransition] = useTransition();

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

    return filtered;
  }, [responses, deferredCompetitorTypeFilter]);

  const handleCompetitorTypeToggle = (value: 'all' | 'direct') => {
    startTransition(() => {
      setSelectedCompetitorTypeFilter(value);
    });
  };



  // Helper to normalize competitor names
  const normalizeCompetitorName = (name: string): string => {
    const trimmedName = name.trim();
    const lowerName = trimmedName.toLowerCase();
    
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

  // Helper to group responses by time period
  const groupResponsesByTimePeriod = useMemo(() => {
    if (getFilteredResponses.length === 0) return { current: [], previous: [] };

    // Sort responses by tested_at descending
    const sortedResponses = [...getFilteredResponses].sort((a, b) => 
      new Date(b.tested_at).getTime() - new Date(a.tested_at).getTime()
    );

    // Find the most recent date
    const latestDate = new Date(sortedResponses[0].tested_at);
    
    // Group responses into current (latest date) and previous (all other dates)
    const current = sortedResponses.filter(r => {
      const responseDate = new Date(r.tested_at);
      return responseDate.toDateString() === latestDate.toDateString();
    });
    
    const previous = sortedResponses.filter(r => {
      const responseDate = new Date(r.tested_at);
      return responseDate.toDateString() !== latestDate.toDateString();
    });

    // If we only have responses from one date, treat them all as current
    if (previous.length === 0) {
      return { current: sortedResponses, previous: [] };
    }

    return { current, previous };
  }, [getFilteredResponses]);

  // Calculate time-based competitor data
  const timeBasedCompetitors = useMemo(() => {
    const { current, previous } = groupResponsesByTimePeriod;
    
    // Get competitor counts for current period
    const currentCompetitors: Record<string, number> = {};
    current.forEach(response => {
      if (response.detected_competitors) {
        const mentions = response.detected_competitors
          .split(',')
          .map((comp: string) => comp.trim())
          .filter((comp: string) => comp.length > 0)
          .map((comp: string) => ({ name: comp }));
        
        mentions.forEach((mention: any) => {
          if (mention.name) {
            const name = normalizeCompetitorName(mention.name);
            if (name && 
                name.toLowerCase() !== companyName.toLowerCase() &&
                name.length > 1) {
              currentCompetitors[name] = (currentCompetitors[name] || 0) + 1;
            }
          }
        });
      }
    });

    // Get competitor counts for previous period and calculate average
    const previousCompetitors: Record<string, number> = {};
    const previousUniqueDays = new Set(previous.map(r => new Date(r.tested_at).toDateString()));
    const numPreviousDays = Math.max(1, previousUniqueDays.size);

    previous.forEach(response => {
      if (response.detected_competitors) {
        const mentions = response.detected_competitors
          .split(',')
          .map((comp: string) => comp.trim())
          .filter((comp: string) => comp.length > 0)
          .map((comp: string) => ({ name: comp }));
        
        mentions.forEach((mention: any) => {
          if (mention.name) {
            const name = normalizeCompetitorName(mention.name);
            if (name && 
                name.toLowerCase() !== companyName.toLowerCase() &&
                name.length > 1) {
              previousCompetitors[name] = (previousCompetitors[name] || 0) + 1;
            }
          }
        });
      }
    });

    // Combine all unique competitors
    const allCompetitors = new Set([
      ...Object.keys(currentCompetitors),
      ...Object.keys(previousCompetitors)
    ]);

    const timeBasedData: TimeBasedData[] = Array.from(allCompetitors).map(competitor => {
      const currentCount = currentCompetitors[competitor] || 0;
      const previousTotalCount = previousCompetitors[competitor] || 0;
      const previousAverage = Math.round(previousTotalCount / numPreviousDays);

      const change = currentCount - previousAverage;
      const changePercent = previousAverage > 0 ? (change / previousAverage) * 100 : currentCount > 0 ? 100 : 0;

      return {
        name: competitor,
        current: currentCount,
        previous: previousAverage,
        change,
        changePercent
      };
    });

    // Sort by current count descending
    let result = timeBasedData
      .sort((a, b) => b.current - a.current);

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
        
        mentions.forEach((name: string) => {
          const normalized = normalizeCompetitorName(name);
          if (normalized && 
              normalized.toLowerCase() !== companyName.toLowerCase() &&
              normalized.length > 1) {
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
    const changeData = new Map();
    timeBasedCompetitors.forEach(competitor => {
      changeData.set(competitor.name, competitor.change);
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

    return filteredCompetitors.map(competitor => ({
      ...competitor,
      change: changeData.get(competitor.name) || 0
    }));
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
    setCompetitorSummary("");
    setCompetitorSummaryError(null);
    setLoadingCompetitorSummary(true);
    setCompetitorThinkingStep(0);
    setCompetitorThinkingSteps([]);

    const relevantResponses = getFullResponsesForCompetitor(selectedCompetitor);
    if (relevantResponses.length === 0) {
      setCompetitorSummaryError("No responses found for this competitor.");
      setLoadingCompetitorSummary(false);
      setCompetitorThinkingStep(-1);
      return;
    }

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

    const steps = [
      `Reading ${relevantResponses.length} responses mentioning ${selectedCompetitor}...`,
      `Identifying key themes and comparisons...`,
      `Evaluating sentiment across mentions...`,
      `Writing competitive analysis...`,
    ];
    setCompetitorThinkingSteps(steps);

    const stepTimers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < steps.length; i++) {
      stepTimers.push(setTimeout(() => setCompetitorThinkingStep(i), i * 1800));
    }

    const sourcesList = sourceMap.map((s, i) => `[${i + 1}] ${s.displayName} (${s.domain})`).join('\n');

    const prompt = `You are an employer brand analyst. Write a concise, insightful summary comparing how ${selectedCompetitor} is positioned relative to ${companyName} in the talent market.

Available sources:
${sourcesList || 'No sources available'}

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
      return `${(texts[r.id] || r.response_text || '').slice(0, 800)}${responseSources}`;
    }).join('\n---\n')}

Write 2-3 short paragraphs (no bullet points, no headings). Cover: (1) what stands out about ${selectedCompetitor} and how they differ from ${companyName}, (2) areas where ${selectedCompetitor} is stronger or weaker, (3) what this means for ${companyName}'s talent strategy. Be direct and specific. Do not start with "${selectedCompetitor} is..."

CRITICAL: When you reference information from a source, add an inline citation like [1], [2], etc. matching the source numbers above. Place citations naturally at the end of the relevant sentence or claim. Use citations frequently. Only cite sources from the numbered list above.`;

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
        body: JSON.stringify({ prompt, enableWebSearch: false })
      });
      const data = await res.json();
      stepTimers.forEach(clearTimeout);
      if (data.response) {
        setCompetitorSummary(data.response.trim());
      } else {
        setCompetitorSummaryError(data.error || "No summary generated.");
      }
    } catch (err) {
      stepTimers.forEach(clearTimeout);
      setCompetitorSummaryError("Failed to generate summary.");
    } finally {
      setLoadingCompetitorSummary(false);
      setCompetitorThinkingStep(-1);
    }
  };

  const renderAllTimeBar = (data: { name: string; count: number; change?: number }, maxCount: number, totalMentions: number) => {
    const barWidth = maxCount > 0 ? (data.count / maxCount) * 100 : 0;
    const mentionPercent = totalMentions > 0 ? (data.count / totalMentions) * 100 : 0;
    
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
        
        {/* Percentage */}
        <div className="flex items-center min-w-[50px] sm:min-w-[60px] justify-end">
          <span className="text-sm font-semibold text-gray-900">
            {mentionPercent.toFixed(1)}%
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 w-full h-full">
      {/* Main Section Header */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">Competitors</h2>
        <p className="text-gray-600">
          Track competitor mentions and analyze how {companyName} compares in AI responses and search results.
        </p>
      </div>

      {/* Toggle: Direct Competitors / All Competitors */}
      <div className="sticky top-0 z-10 bg-white pb-2">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-100">
          <button
            onClick={() => handleCompetitorTypeToggle('direct')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              selectedCompetitorTypeFilter === 'direct'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Direct Competitors
          </button>
          <button
            onClick={() => handleCompetitorTypeToggle('all')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              selectedCompetitorTypeFilter === 'all'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            All Competitors
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0">
        <Card className="shadow-sm border border-gray-200 h-full flex flex-col">
          <CardContent className="flex-1 min-h-0 overflow-hidden p-6">
            <div className="space-y-2 h-full overflow-y-auto relative">
              {allTimeCompetitorsWithChanges.length > 0 ? (
                (() => {
                  const maxCount = Math.max(...allTimeCompetitorsWithChanges.map(c => c.count), 1);
                  const totalMentions = allTimeCompetitorsWithChanges.reduce((sum, c) => sum + c.count, 0);
                  
                  return allTimeCompetitorsWithChanges.map((competitor, idx) => (
                    <div 
                      key={`${competitor.name}-${deferredCompetitorTypeFilter}-${idx}`} 
                      className="cursor-pointer"
                    >
                      {renderAllTimeBar(competitor, maxCount, totalMentions)}
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
          className={`p-0 flex flex-col gap-0 [&>button]:hidden transition-all duration-500 ease-in-out ${
            competitorSummary || loadingCompetitorSummary || competitorSummaryError 
              ? 'w-full sm:max-w-2xl inset-y-0 h-full rounded-none' 
              : 'w-full sm:max-w-sm !h-auto !inset-y-auto !bottom-6 !right-4 !rounded-2xl !border !shadow-2xl'
          }`}
        >
          <div className={`flex items-center justify-between px-5 py-4 bg-white ${
            competitorSummary || loadingCompetitorSummary || competitorSummaryError ? 'border-b' : 'rounded-t-2xl'
          }`}>
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
          <div className={`overflow-y-auto px-5 py-4 ${
            competitorSummary || loadingCompetitorSummary || competitorSummaryError ? 'flex-1' : ''
          }`}>
            <div className="space-y-4">
              {/* MODELS ROW */}
              {selectedCompetitor && (() => {
                const competitorResponses = getFullResponsesForCompetitor(selectedCompetitor);
                const uniqueLLMs = Array.from(new Set(competitorResponses.map(r => r.ai_model).filter(Boolean)));
                return (
                  <div className="flex flex-row gap-8 mt-1 mb-1 w-full">
                    <div className="flex flex-col items-start min-w-[120px]">
                      <span className="text-xs text-gray-400 font-medium mb-1">Models</span>
                      <div className="flex flex-row flex-wrap items-center gap-2">
                        {uniqueLLMs.length === 0 ? (
                          <span className="text-xs text-gray-400">None</span>
                        ) : (
                          uniqueLLMs.map(model => (
                            <span key={model} className="inline-flex items-center">
                              <LLMLogo modelName={model} size="sm" className="mr-1" />
                              <span className="text-xs text-gray-700 mr-2">{getLLMDisplayName(model)}</span>
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Ask AI — inline for compact state */}
              {!competitorSummary && !loadingCompetitorSummary && !competitorSummaryError && (
                <div className="flex justify-center pt-2 pb-1">
                  <div className="animate-slideUpGlow rounded-full">
                    <button
                      onClick={fetchCompetitorSummary}
                      className="h-11 rounded-full bg-[#13274F] text-white shadow-lg hover:bg-[#1a3468] transition-all hover:scale-105 flex items-center justify-center gap-2 px-5"
                    >
                      <img alt="PerceptionX" className="h-5 w-5 object-contain shrink-0 brightness-0 invert" src="/logos/perceptionx-small.png" />
                      <span className="text-sm font-medium whitespace-nowrap">Ask AI</span>
                      <span className="text-[10px] font-semibold bg-[#DB5E89] text-white px-1.5 py-0.5 rounded-full leading-none">BETA</span>
                    </button>
                  </div>
                </div>
              )}

              {/* AI Summary — on demand */}
              {competitorSummary ? (
                <Card className="border-blue-100 bg-blue-50/30">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-blue-500" />
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
                        const parts = paragraph.split(/(\[\d+(?:\s*,\s*\d+)*\])/g);
                        return (
                          <p key={pIdx} className="mb-3 last:mb-0">
                            {parts.map((part, partIdx) => {
                              const citationMatch = part.match(/^\[([\d\s,]+)\]$/);
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
                              return <span key={partIdx}>{part}</span>;
                            })}
                          </p>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ) : loadingCompetitorSummary ? (
                <Card className="border-blue-100 bg-gradient-to-br from-blue-50/40 to-indigo-50/30 overflow-hidden">
                  <CardContent className="py-5 px-5">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="relative">
                        <Sparkles className="w-4 h-4 text-blue-500" />
                        <div className="absolute inset-0 animate-ping"><Sparkles className="w-4 h-4 text-blue-400 opacity-30" /></div>
                      </div>
                      <span className="text-sm font-medium text-blue-700">Analyzing...</span>
                    </div>
                    <div className="space-y-0.5">
                      {competitorThinkingSteps.map((step, i) => {
                        const isActive = i === competitorThinkingStep;
                        const isComplete = i < competitorThinkingStep;
                        const isPending = i > competitorThinkingStep;
                        return (
                          <div key={i} className={`flex items-center gap-2.5 py-1.5 px-2 rounded-md transition-all duration-500 ${isActive ? 'bg-blue-100/60' : ''}`}
                            style={{ opacity: isPending ? 0.3 : 1, transform: isPending ? 'translateX(4px)' : 'translateX(0)', transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                              {isComplete ? <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" /> : isActive ? <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" /> : <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />}
                            </div>
                            <span className={`text-xs transition-colors duration-300 ${isActive ? 'text-blue-700 font-medium' : isComplete ? 'text-blue-500' : 'text-gray-400'}`}>{step}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 h-1 bg-blue-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${competitorThinkingSteps.length > 0 ? ((competitorThinkingStep + 1) / competitorThinkingSteps.length) * 100 : 0}%` }} />
                    </div>
                  </CardContent>
                </Card>
              ) : competitorSummaryError ? (
                <Card className="border-red-100 bg-red-50/30">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <span className="text-red-600 text-sm">{competitorSummaryError}</span>
                      <Button variant="ghost" size="sm" onClick={fetchCompetitorSummary} className="text-xs">Retry</Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
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