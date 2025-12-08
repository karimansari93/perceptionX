import { useState, useMemo } from "react";
import LLMLogo from "@/components/LLMLogo";
import { ResponseDetailsModal } from "./ResponseDetailsModal";
import { getLLMDisplayName } from '@/config/llmLogos';
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSubscription } from "@/hooks/useSubscription";
import { getCompetitorFavicon } from "@/utils/citationUtils";
import { usePersistedState } from "@/hooks/usePersistedState";

interface ResponsesTabProps {
  responses: any[];
  parseCitations: (citations: any) => any[];
  companyName?: string;
}

export const ResponsesTab = ({ responses, companyName = 'your company' }: ResponsesTabProps) => {
  const { isPro } = useSubscription();
  const [expandedRows, setExpandedRows] = useState<{ [key: string]: boolean }>({});
  // Filter and modal states - persisted
  const [categoryFilter, setCategoryFilter] = usePersistedState<string>('responsesTab.categoryFilter', 'all');
  const [selectedResponse, setSelectedResponse] = usePersistedState<any | null>('responsesTab.selectedResponse', null);
  const [isModalOpen, setIsModalOpen] = usePersistedState<boolean>('responsesTab.isModalOpen', false);
  const isMobile = useIsMobile();

  // Dynamically get available categories from responses
  const availableCategories = useMemo(() => {
    const categories = new Set<string>();
    responses.forEach(r => {
      const category = r.confirmed_prompts?.prompt_category;
      if (category && category.trim()) {
        categories.add(category);
      }
    });
    
    // Sort categories in a specific order: General, Employee Experience, Candidate Experience
    const categoryOrder = ['General', 'Employee Experience', 'Candidate Experience'];
    const sortedCategories = Array.from(categories).sort((a, b) => {
      const indexA = categoryOrder.indexOf(a);
      const indexB = categoryOrder.indexOf(b);
      // If both are in the order list, sort by their position
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      // If only one is in the order list, prioritize it
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      // If neither is in the order list, sort alphabetically
      return a.localeCompare(b);
    });
    
    return sortedCategories;
  }, [responses]);

  const truncateText = (text: string, maxLength: number = 150) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  const handleExpand = (id: string) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredResponses = useMemo(() => {
    return responses.filter(r => {
      if (categoryFilter === "all") {
        return true;
      }
      const responseCategory = r.confirmed_prompts?.prompt_category;
      return responseCategory === categoryFilter;
    });
  }, [responses, categoryFilter]);

  const handleRowClick = (response: any) => {
    setSelectedResponse(response);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    // Don't clear selectedResponse immediately - let it persist
    // It will be cleared when a new response is selected
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
          <Select
            value={categoryFilter}
            onValueChange={setCategoryFilter}
          >
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {availableCategories.map(category => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Content */}
      {filteredResponses.length > 0 ? (
        isMobile ? (
          // Mobile-friendly card layout
          <div className="space-y-4">
            {filteredResponses.map((response: any) => (
              <Card
                key={response.id}
                className="cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => handleRowClick(response)}
              >
                <CardContent className="p-4">
                  {/* Response text */}
                  <div className="mb-3">
                    <p className="text-sm text-gray-900 leading-relaxed">
                      {truncateText(response.response_text, 200)}
                    </p>
                  </div>
                  
                                     {/* Metrics grid */}
                   <div className="grid grid-cols-2 gap-3 text-xs">
                     <div className="flex items-center gap-2">
                       {!isMobile && <span className="text-gray-500">Model:</span>}
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
                  
                  {/* Competitors and Date - full width */}
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">Competitors:</span>
                        {(() => {
                          if (response.detected_competitors) {
                            const mentions = response.detected_competitors
                              .split(',')
                              .map((comp: string) => comp.trim())
                              .filter((comp: string) => comp.length > 0)
                              .map((comp: string) => ({ name: comp }));
                            
                            if (mentions.length === 0) {
                              return <span className="text-xs text-gray-400">None</span>;
                            }
                            
                            const excluded = [
                              'glassdoor', 'indeed', 'linkedin', 'monster', 'careerbuilder', 'ziprecruiter',
                              'trustpilot', 'g2', 'capterra', 'reuters', 'bloomberg', 'twitter', 'facebook',
                              'crunchbase', 'pitchbook', 'gartner', 'forrester'
                            ];
                            
                            const competitors = mentions
                              .map((mention: any) => mention.name?.trim())
                              .filter(Boolean)
                              .filter((name: string) => !excluded.includes(name.toLowerCase()));
                            
                            if (competitors.length === 0) {
                              return <span className="text-xs text-gray-400">None</span>;
                            }
                            
                            const maxToShow = 1;
                            const extraCount = competitors.length - maxToShow;
                            return (
                              <div className="flex flex-wrap gap-1">
                                {competitors.slice(0, maxToShow).map((name: string, idx: number) => {
                                  const faviconUrl = getCompetitorFavicon(name);
                                  const initials = name.charAt(0).toUpperCase();
                                  
                                  return (
                                    <Badge key={idx} variant="secondary" className="text-xs flex items-center gap-1.5 px-2 py-0.5 bg-gray-100 text-gray-700">
                                      <div className="w-3 h-3 flex-shrink-0 bg-gray-100 rounded flex items-center justify-center">
                                        {faviconUrl ? (
                                          <img 
                                            src={faviconUrl} 
                                            alt={`${name} favicon`}
                                            className="w-full h-full rounded object-contain"
                                            onError={(e) => {
                                              // Fallback to initials if favicon fails to load
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
                                  <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-700">+{extraCount} more</Badge>
                                )}
                              </div>
                            );
                          }
                          return <span className="text-xs text-gray-400">None</span>;
                        })()}
                      </div>
                      <div className="text-xs text-gray-500">
                        {response.answered ? response.answered : (response.tested_at ? new Date(response.tested_at).toLocaleDateString() : '-')}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
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
                    {filteredResponses.map((response: any) => (
                      <TableRow
                        key={response.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => handleRowClick(response)}
                      >
                        <TableCell className="max-w-xs">
                          <div className="truncate whitespace-nowrap max-w-[300px] text-[#13274F]">
                            {response.response_text}
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
                            {(() => {
                              if (response.detected_competitors) {
                                const mentions = response.detected_competitors
                                  .split(',')
                                  .map((comp: string) => comp.trim())
                                  .filter((comp: string) => comp.length > 0)
                                  .map((comp: string) => ({ name: comp }));
                                
                                if (mentions.length === 0) {
                                  return null;
                                }
                                
                                const excluded = [
                                  'glassdoor', 'indeed', 'linkedin', 'monster', 'careerbuilder', 'ziprecruiter',
                                  'trustpilot', 'g2', 'capterra', 'reuters', 'bloomberg', 'twitter', 'facebook',
                                  'crunchbase', 'pitchbook', 'gartner', 'forrester'
                                ];
                                
                                const competitors = mentions
                                  .map((mention: any) => mention.name?.trim())
                                  .filter(Boolean)
                                  .filter((name: string) => !excluded.includes(name.toLowerCase()));
                                
                                if (competitors.length === 0) {
                                  return null;
                                }
                                
                                const maxToShow = 1;
                                const extraCount = competitors.length - maxToShow;
                                return (
                                  <div className="flex flex-nowrap gap-2">
                                    {competitors.slice(0, maxToShow).map((name: string, idx: number) => {
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
                                                  // Fallback to initials if favicon fails to load
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
                              }
                              return null;
                            })()}
                          </div>
                        </TableCell>
                        <TableCell className="text-[#13274F]">{response.answered ? response.answered : (response.tested_at ? new Date(response.tested_at).toLocaleDateString() : '-')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )
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
        />
      )}
    </div>
  );
};
