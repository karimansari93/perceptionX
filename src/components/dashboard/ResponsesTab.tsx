import { useState, useMemo, useCallback, memo } from "react";
import LLMLogo from "@/components/LLMLogo";
import { ResponseDetailsModal } from "./ResponseDetailsModal";
import { getLLMDisplayName } from '@/config/llmLogos';
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSubscription } from "@/hooks/useSubscription";
import { getCompetitorFavicon } from "@/utils/citationUtils";
import { usePersistedState } from "@/hooks/usePersistedState";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 25;

// Excluded sources that aren't real competitors
const EXCLUDED_SOURCES = new Set([
  'glassdoor', 'indeed', 'linkedin', 'monster', 'careerbuilder', 'ziprecruiter',
  'trustpilot', 'g2', 'capterra', 'reuters', 'bloomberg', 'twitter', 'facebook',
  'crunchbase', 'pitchbook', 'gartner', 'forrester'
]);

/** Parse competitor string once and return filtered names */
function parseCompetitors(detected: string | null | undefined): string[] {
  if (!detected) return [];
  return detected
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !EXCLUDED_SOURCES.has(s.toLowerCase()));
}

/** Memoized competitor badges — avoids re-parsing on every render */
const CompetitorBadges = memo(function CompetitorBadges({ competitors, noneLabel }: { competitors: string[]; noneLabel?: boolean }) {
  if (competitors.length === 0) {
    return noneLabel ? <span className="text-xs text-gray-400">None</span> : null;
  }

  const maxToShow = 1;
  const extraCount = competitors.length - maxToShow;

  return (
    <div className="flex flex-nowrap gap-1">
      {competitors.slice(0, maxToShow).map((name, idx) => {
        const faviconUrl = getCompetitorFavicon(name);
        const initials = name.charAt(0).toUpperCase();
        return (
          <Badge key={idx} variant="secondary" className="text-xs flex items-center gap-1.5 px-2 py-0.5 bg-gray-100 text-gray-700 whitespace-nowrap">
            <div className="w-3 h-3 flex-shrink-0 bg-gray-100 rounded flex items-center justify-center">
              {faviconUrl ? (
                <img
                  src={faviconUrl}
                  alt={`${name} favicon`}
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
                className="text-[8px] font-bold text-gray-600"
                style={{ display: faviconUrl ? 'none' : 'flex' }}
              >
                {initials}
              </span>
            </div>
            <span className="truncate max-w-[120px]" title={name}>{name}</span>
          </Badge>
        );
      })}
      {extraCount > 0 && (
        <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-700 whitespace-nowrap">+{extraCount} more</Badge>
      )}
    </div>
  );
});

interface ResponsesTabProps {
  responses: any[];
  parseCitations: (citations: any) => any[];
  companyName?: string;
  responseTexts?: Record<string, string>;
  responseTextsLoading?: boolean;
  fetchResponseTexts?: (ids: string[]) => Promise<Record<string, string>>;
}

export const ResponsesTab = memo(function ResponsesTab({
  responses,
  companyName = 'your company',
  responseTexts = {},
  responseTextsLoading = false,
  fetchResponseTexts,
}: ResponsesTabProps) {
  const { isPro } = useSubscription();
  const [categoryFilter, setCategoryFilter] = usePersistedState<string>('responsesTab.categoryFilter', 'all');
  const [selectedResponse, setSelectedResponse] = usePersistedState<any | null>('responsesTab.selectedResponse', null);
  const [isModalOpen, setIsModalOpen] = usePersistedState<boolean>('responsesTab.isModalOpen', false);
  const [page, setPage] = useState(0);
  const isMobile = useIsMobile();

  const availableCategories = useMemo(() => {
    const categories = new Set<string>();
    responses.forEach(r => {
      const category = r.confirmed_prompts?.prompt_category;
      if (category && category.trim()) {
        categories.add(category);
      }
    });
    const categoryOrder = ['General', 'Employee Experience', 'Candidate Experience'];
    return Array.from(categories).sort((a, b) => {
      const indexA = categoryOrder.indexOf(a);
      const indexB = categoryOrder.indexOf(b);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [responses]);

  const filteredResponses = useMemo(() => {
    if (categoryFilter === "all") return responses;
    return responses.filter(r => r.confirmed_prompts?.prompt_category === categoryFilter);
  }, [responses, categoryFilter]);

  // Pre-compute competitors for the current page only
  const totalPages = Math.ceil(filteredResponses.length / PAGE_SIZE);
  const pagedResponses = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filteredResponses.slice(start, start + PAGE_SIZE);
  }, [filteredResponses, page]);

  const competitorsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of pagedResponses) {
      map.set(r.id, parseCompetitors(r.detected_competitors));
    }
    return map;
  }, [pagedResponses]);

  const handleRowClick = useCallback((response: any) => {
    setSelectedResponse(response);
    setIsModalOpen(true);
  }, [setSelectedResponse, setIsModalOpen]);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, [setIsModalOpen]);

  // Reset page when filter changes
  const handleFilterChange = useCallback((value: string) => {
    setCategoryFilter(value);
    setPage(0);
  }, [setCategoryFilter]);

  const truncateText = (text: string, maxLength: number = 150) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  return (
    <div className="space-y-4">
      {/* Main Section Header */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">Responses</h2>
        <p className="text-gray-600">
          Review individual AI responses about {companyName} and track performance across different prompts and categories.
        </p>
      </div>

      {/* Filters - Only show for Pro users */}
      {isPro && availableCategories.length > 0 && (
        <div className="w-full">
          <Select value={categoryFilter} onValueChange={handleFilterChange}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {availableCategories.map(category => (
                <SelectItem key={category} value={category}>{category}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Content */}
      {filteredResponses.length > 0 ? (
        <>
          {isMobile ? (
            // Mobile-friendly card layout
            <div className="space-y-4">
              {pagedResponses.map((response: any) => {
                const competitors = competitorsMap.get(response.id) || [];
                return (
                  <Card
                    key={response.id}
                    className="cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => handleRowClick(response)}
                  >
                    <CardContent className="p-4">
                      <div className="mb-3">
                        <p className="text-sm text-gray-900 leading-relaxed">
                          {truncateText(responseTexts[response.id] || response.response_text || '', 200)}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="flex items-center gap-2">
                          <div className="inline-flex items-center bg-gray-100/80 px-2 py-1 rounded-lg">
                            <LLMLogo modelName={response.ai_model} size="sm" className="mr-1" />
                            <span className="text-xs text-gray-700">{getLLMDisplayName(response.ai_model)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">Mentioned:</span>
                          <Badge className={response.company_mentioned ? 'bg-[#06b6d4] text-white' : 'bg-gray-100 text-gray-800'}>
                            {response.company_mentioned ? 'Yes' : 'No'}
                          </Badge>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">Competitors:</span>
                            <CompetitorBadges competitors={competitors} noneLabel />
                          </div>
                          <div className="text-xs text-gray-500">
                            {response.answered ? response.answered : (response.tested_at ? new Date(response.tested_at).toLocaleDateString() : '-')}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            // Desktop table layout
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Response</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Mentioned</TableHead>
                        <TableHead className="w-40">Competitors</TableHead>
                        <TableHead>Answered</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedResponses.map((response: any) => {
                        const competitors = competitorsMap.get(response.id) || [];
                        return (
                          <TableRow
                            key={response.id}
                            className="cursor-pointer hover:bg-gray-50"
                            onClick={() => handleRowClick(response)}
                          >
                            <TableCell className="max-w-xs">
                              <div className="truncate whitespace-nowrap max-w-[300px] text-[#13274F]">
                                {responseTexts[response.id] || response.response_text || ''}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="inline-flex items-center bg-gray-100/80 px-2 py-1 rounded-lg w-fit">
                                <LLMLogo modelName={response.ai_model} size="sm" className="mr-1" />
                                <span className="text-sm text-gray-700">{getLLMDisplayName(response.ai_model)}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge className={response.company_mentioned ? 'bg-[#06b6d4] text-white' : 'bg-gray-100 text-gray-800'}>
                                {response.company_mentioned ? 'Yes' : 'No'}
                              </Badge>
                            </TableCell>
                            <TableCell className="w-20">
                              <div className="truncate max-w-sm overflow-hidden">
                                <CompetitorBadges competitors={competitors} />
                              </div>
                            </TableCell>
                            <TableCell className="text-[#13274F]">
                              {response.answered ? response.answered : (response.tested_at ? new Date(response.tested_at).toLocaleDateString() : '-')}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-gray-500">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredResponses.length)} of {filteredResponses.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p - 1)}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-gray-700">
                  {page + 1} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= totalPages - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-8 text-gray-500">
          No responses collected yet. Start monitoring to see AI responses here.
        </div>
      )}

      {selectedResponse && isModalOpen && (
        <ResponseDetailsModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          promptText={selectedResponse.confirmed_prompts?.prompt_text || ''}
          responses={[selectedResponse]}
          companyName={companyName}
          responseTexts={responseTexts}
          fetchResponseTexts={fetchResponseTexts}
        />
      )}
    </div>
  );
});
