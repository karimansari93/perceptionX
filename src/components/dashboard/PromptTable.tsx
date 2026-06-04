import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PromptData } from "@/types/dashboard";
import { MessageSquare, TrendingUp, TrendingDown, Minus, Target, Filter, HelpCircle, Lightbulb, Search } from "lucide-react";
import { useState, useMemo, useTransition, useDeferredValue, memo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { getCompetitorFavicon } from "@/utils/citationUtils";

interface PromptTableProps {
  prompts: PromptData[];
  onPromptClick: (promptText: string) => void;
}

const INITIAL_ROWS = 50;

export const PromptTable = memo(({ prompts, onPromptClick }: PromptTableProps) => {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showAll, setShowAll] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [, startTransition] = useTransition();
  const deferredTypeFilter = useDeferredValue(typeFilter);
  const deferredCategoryFilter = useDeferredValue(categoryFilter);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const isMobile = useIsMobile();

  // Helper function to format kebab-case attribute IDs to Title Case
  const formatAttributeName = (name: string): string => {
    if (!name || name === 'General') return name;
    // Convert kebab-case to Title Case with spaces
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  // Get unique types and categories for filter options
  const uniqueTypes = useMemo(() => {
    const types = new Set<string>();
    prompts.forEach(prompt => {
      let typeLabel = prompt.type;
      if (prompt.type.startsWith('talentx_')) {
        typeLabel = prompt.type.replace('talentx_', '');
      }
      
      // Map to user-friendly labels
      let displayLabel = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);
      if (typeLabel.toLowerCase() === 'sentiment') {
        displayLabel = 'Employer';
      } else if (typeLabel.toLowerCase() === 'visibility') {
        displayLabel = 'Discovery';
      } else if (typeLabel.toLowerCase() === 'competitive') {
        displayLabel = 'Comparison';
      }
      
      types.add(displayLabel);
    });
    return Array.from(types).sort();
  }, [prompts]);

  const uniqueCategories = useMemo(() => {
    const categories = new Set<string>();
    prompts.forEach(prompt => {
      // ONLY use promptTheme from confirmed_prompts for theme name
      // If blank, it = General
      const categoryLabel = prompt.promptTheme || 'General';
      // Format attribute names (kebab-case to Title Case)
      const formattedLabel = formatAttributeName(categoryLabel);
      categories.add(formattedLabel);
    });
    return Array.from(categories).sort();
  }, [prompts]);

  // Filter prompts based on selected filters
  const filteredPrompts = useMemo(() => {
    return prompts.filter(prompt => {
      // Search by prompt text
      const q = deferredSearchQuery.trim().toLowerCase();
      if (q && !prompt.prompt.toLowerCase().includes(q)) {
        return false;
      }

      // Type filter
      let typeLabel = prompt.type;
      if (prompt.type.startsWith('talentx_')) {
        typeLabel = prompt.type.replace('talentx_', '');
      }
      
      // Map to user-friendly labels for filtering
      let displayType = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);
      if (typeLabel.toLowerCase() === 'sentiment') {
        displayType = 'Employer';
      } else if (typeLabel.toLowerCase() === 'visibility') {
        displayType = 'Discovery';
      } else if (typeLabel.toLowerCase() === 'competitive') {
        displayType = 'Comparison';
      }
      
      if (deferredTypeFilter !== "all" && displayType !== deferredTypeFilter) {
        return false;
      }

      const categoryLabel = prompt.promptTheme || 'General';
      const formattedLabel = formatAttributeName(categoryLabel);
      
      if (deferredCategoryFilter !== "all" && formattedLabel !== deferredCategoryFilter) {
        return false;
      }

      return true;
    });
  }, [prompts, deferredTypeFilter, deferredCategoryFilter, deferredSearchQuery]);

  const displayedPrompts = useMemo(() => {
    return showAll ? filteredPrompts : filteredPrompts.slice(0, INITIAL_ROWS);
  }, [filteredPrompts, showAll]);

  const hasMore = filteredPrompts.length > INITIAL_ROWS && !showAll;

  const getSentimentIcon = (sentiment: number) => {
    if (sentiment > 0.1) return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (sentiment < -0.1) return <TrendingDown className="w-4 h-4 text-red-600" />;
    return <Minus className="w-4 h-4 text-gray-600" />;
  };

  const getSentimentColor = (sentiment: number) => {
    if (sentiment > 0.1) return 'text-green-600';
    if (sentiment < -0.1) return 'text-red-600';
    return 'text-gray-600';
  };

  const getVisibilityScore = (prompt: PromptData) => {
    return typeof prompt.averageVisibility === 'number' ? prompt.averageVisibility : 0;
  };

  const getCompetitiveScore = (prompt: PromptData) => {
    // Calculate competitive score based on relative positioning and mentions
    const baseScore = prompt.competitivePosition ? (1 / prompt.competitivePosition) * 100 : 0;
    const mentionBonus = prompt.detectedCompetitors 
      ? prompt.detectedCompetitors.split(',').filter(c => c.trim().length > 0).length * 10 
      : 0;
    return Math.min(100, baseScore + mentionBonus);
  };

  const getMetricColumn = (prompt: PromptData) => {
    switch (prompt.type) {
      case 'sentiment':
        return (
          <div className="flex items-center justify-center space-x-2">
            {getSentimentIcon(prompt.avgSentiment)}
            <span className={`font-semibold ${getSentimentColor(prompt.avgSentiment)}`}>
              {Math.round(prompt.avgSentiment * 100)}%
            </span>
          </div>
        );
      case 'visibility':
        const visibilityScore = getVisibilityScore(prompt);
        return (
          <div className="flex items-center justify-center space-x-2">
            <Target className="w-4 h-4 text-blue-600" />
            <span className="font-semibold text-blue-600">
              {Math.round(visibilityScore)}%
            </span>
          </div>
        );
      case 'competitive':
        const competitiveScore = getCompetitiveScore(prompt);
        return (
          <div className="flex items-center justify-center space-x-2">
            <TrendingUp className="w-4 h-4 text-purple-600" />
            <span className="font-semibold text-purple-600">
              {competitiveScore.toFixed(0)}%
            </span>
          </div>
        );
      case 'talentx_sentiment':
      case 'talentx_visibility':
      case 'talentx_competitive':
        return (
          <div className="flex items-center justify-center space-x-2">
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              Pro
            </Badge>
          </div>
        );
      default:
        return null;
    }
  };

  // Helper for sentiment pill
  const getSentimentPill = (sentimentLabel?: string) => {
    if (!sentimentLabel) return <span>-</span>;
    let color = "bg-gray-100 text-gray-700";
    let label = "Normal";
    if (sentimentLabel.toLowerCase() === "positive") {
      color = "bg-green-100 text-green-700";
      label = "Positive";
    } else if (sentimentLabel.toLowerCase() === "negative") {
      color = "bg-red-100 text-red-700";
      label = "Negative";
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${color}`}>{label}</span>
    );
  };

  const getTypeBadge = (prompt: PromptData) => {
    // Extract the base type from TalentX prompts (e.g., 'talentx_sentiment' -> 'sentiment')
    let typeLabel = prompt.type;
    if (prompt.type.startsWith('talentx_')) {
      typeLabel = prompt.type.replace('talentx_', '');
    }
    
    // Map to user-friendly labels
    let displayLabel = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);
    if (typeLabel.toLowerCase() === 'sentiment') {
      displayLabel = 'Employer';
    } else if (typeLabel.toLowerCase() === 'visibility') {
      displayLabel = 'Discovery';
    } else if (typeLabel.toLowerCase() === 'competitive') {
      displayLabel = 'Comparison';
    }
    
    // Apply colors matching PromptSummaryCards
    let badgeClass = "bg-gray-100 text-gray-800 border-gray-200"; // default
    if (typeLabel.toLowerCase() === 'sentiment') {
      badgeClass = "bg-blue-100 text-blue-800 border-blue-200";
    } else if (typeLabel.toLowerCase() === 'visibility') {
      badgeClass = "bg-green-100 text-green-800 border-green-200";
    } else if (typeLabel.toLowerCase() === 'competitive') {
      badgeClass = "bg-purple-100 text-purple-800 border-purple-200";
    }
    
    return <Badge variant="outline" className={`${badgeClass} whitespace-nowrap`}>{displayLabel}</Badge>;
  };

  const getCategoryBadge = (prompt: PromptData) => {
    // ONLY use promptTheme from confirmed_prompts for theme name
    // If blank, it = General
    const categoryLabel = prompt.promptTheme || 'General';
    // Format attribute names (kebab-case to Title Case)
    const formattedLabel = formatAttributeName(categoryLabel);
    
    return (
      <Badge variant="outline" title={formattedLabel} className="max-w-full bg-gray-50 text-gray-700 border-gray-200">
        <span className="min-w-0 truncate">{formattedLabel}</span>
      </Badge>
    );
  };

  const getCompetitorsDisplay = (prompt: PromptData) => {
    if (!prompt.detectedCompetitors) {
      return <span className="text-gray-400">—</span>;
    }

    // Drop placeholder values that aren't real competitors — otherwise they
    // render as a generic globe favicon (e.g. "No competitors" -> nocompetitors.com).
    const NON_COMPETITOR = /^(none|n\/?a|not applicable|unknown|no(ne)? (other )?competitors?( (found|mentioned|identified|listed|detected))?|no other companies)$/i;
    const competitors = prompt.detectedCompetitors
      .split(',')
      .map((comp: string) => comp.trim())
      .filter((comp: string) => comp.length > 0 && !NON_COMPETITOR.test(comp));

    if (competitors.length === 0) {
      return <span className="text-gray-400">—</span>;
    }

    const maxToShow = 3;
    const extraCount = competitors.length - maxToShow;

    return (
      <div className="flex flex-nowrap gap-1 justify-center items-center overflow-hidden">
        {competitors.slice(0, maxToShow).map((name: string, idx: number) => {
          const faviconUrl = getCompetitorFavicon(name);
          const initials = name.charAt(0).toUpperCase();
          // Swap favicon → initials. Fires on a real load error (404) and also
          // when Google returns its 16×16 generic globe (no real favicon found).
          const fallbackToInitials = (img: HTMLImageElement) => {
            img.style.display = 'none';
            const fallback = img.nextElementSibling as HTMLElement | null;
            if (fallback) fallback.style.display = 'flex';
          };

          return (
            <span
              key={idx}
              title={name}
              className="w-5 h-5 flex-shrink-0 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden"
            >
              {faviconUrl ? (
                <img
                  src={faviconUrl}
                  alt={`${name} favicon`}
                  className="w-full h-full rounded-full object-contain"
                  onLoad={(e) => {
                    if (e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth <= 16) {
                      fallbackToInitials(e.currentTarget);
                    }
                  }}
                  onError={(e) => fallbackToInitials(e.currentTarget)}
                  style={{ display: 'block' }}
                />
              ) : null}
              <span
                className="text-[9px] font-bold text-gray-600"
                style={{ display: faviconUrl ? 'none' : 'flex' }}
              >
                {initials}
              </span>
            </span>
          );
        })}
        {extraCount > 0 && (
          <span className="flex-shrink-0 whitespace-nowrap text-[10px] font-medium text-gray-500">+{extraCount}</span>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Search (full-width) + Type & Theme filters on the right */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search prompts..."
            className="h-8 w-full pl-8 rounded-lg border-gray-200 bg-white text-xs shadow-sm"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => startTransition(() => setTypeFilter(v))}>
          <SelectTrigger className="h-8 w-auto min-w-[120px] gap-1.5 rounded-lg border-gray-200 bg-white text-xs font-medium text-gray-600 shadow-sm">
            <Filter className="w-3.5 h-3.5 shrink-0 text-gray-400" />
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {uniqueTypes.map(type => (
              <SelectItem key={type} value={type}>{type}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={categoryFilter} onValueChange={(v) => startTransition(() => setCategoryFilter(v))}>
          <SelectTrigger className="h-8 w-auto min-w-[120px] gap-1.5 rounded-lg border-gray-200 bg-white text-xs font-medium text-gray-600 shadow-sm">
            <Lightbulb className="w-3.5 h-3.5 shrink-0 text-gray-400" />
            <SelectValue placeholder="All themes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All themes</SelectItem>
            {uniqueCategories.map(category => (
              <SelectItem key={category} value={category}>{category}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredPrompts.length > 0 ? (
        isMobile ? (
          // Mobile-friendly card layout
          <>
            {displayedPrompts.map((prompt, index) => (
                                 <div
                   key={index}
                   className="p-5 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors mb-4 last:mb-0"
                   onClick={() => onPromptClick(prompt.prompt)}
                 >
                                     {/* Prompt text - full width on mobile */}
                   <div className="mb-4">
                     <p className="text-sm font-medium text-gray-900 leading-relaxed">
                       {prompt.prompt}
                     </p>
                   </div>
                  
                                                        {/* Badges row - Type, Theme */}
                  <div className="flex items-center gap-2 mb-3">
                    {getTypeBadge(prompt)}
                    {getCategoryBadge(prompt)}
                  </div>
                   
                   {/* Responses row */}
                   <div className="flex items-center gap-2 mb-3">
                     <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-700">{prompt.responses} responses</Badge>
                   </div>
                  
                  {/* Visibility score and Competitors - full width */}
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Visibility:</span>
                      {(() => {
                        // Determine if company is mentioned based on visibility scores or averageVisibility
                        const isCompanyMentioned = Array.isArray(prompt.visibilityScores) && prompt.visibilityScores.length > 0
                          ? prompt.visibilityScores.some(score => score > 0)
                          : (prompt.averageVisibility && prompt.averageVisibility > 0);
                        
                        return (
                          <Badge className={isCompanyMentioned ? 'bg-[#06b6d4] text-white' : 'bg-gray-100 text-gray-800'}>
                            {isCompanyMentioned ? 'Yes' : 'No'}
                          </Badge>
                        );
                      })()}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Competitors:</span>
                      {getCompetitorsDisplay(prompt)}
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            // Desktop table layout
            <Card className="max-w-full overflow-hidden">
              <CardContent className="p-0">
                <div>
                  <Table className="table-fixed w-full text-xs font-medium [&_th]:h-9 [&_th]:px-3 [&_td]:px-3 [&_td]:py-2 [&_td_.rounded-full]:font-medium">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1 cursor-help">
                          <span>Prompt</span>
                          <HelpCircle className="w-3 h-3 text-gray-400" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>The question asked to AI models about your company</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="text-center w-[110px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center gap-1 cursor-help">
                          <span>Type</span>
                          <HelpCircle className="w-3 h-3 text-gray-400" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Type of question: employer, discovery, or comparison</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  {(
                    <TableHead className="text-center w-[140px]">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center justify-center gap-1 cursor-help">
                            <span>Theme</span>
                            <HelpCircle className="w-3 h-3 text-gray-400" />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Specific theme or topic area from the prompt</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                  )}
                  <TableHead className="text-center w-[75px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center gap-1 cursor-help">
                          <span>Responses</span>
                          <HelpCircle className="w-3 h-3 text-gray-400" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Number of AI responses from different models</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="text-center w-[60px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center gap-1 cursor-help">
                          <span>Visibility</span>
                          <HelpCircle className="w-3 h-3 text-gray-400" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>How often your company is mentioned in responses</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="text-center w-[120px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center gap-1 cursor-help">
                          <span>Competitors</span>
                          <HelpCircle className="w-3 h-3 text-gray-400" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Competitors mentioned in AI responses</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedPrompts.map((prompt, index) => (
                  <TableRow 
                    key={index} 
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => onPromptClick(prompt.prompt)}
                  >
                    <TableCell className="font-medium">
                  <div className="truncate" title={prompt.prompt}>
                    {prompt.prompt}
                  </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {getTypeBadge(prompt)}
                    </TableCell>
                    {(
                      <TableCell className="text-center">
                        {getCategoryBadge(prompt)}
                      </TableCell>
                    )}
                    <TableCell className="text-center">
                      <Badge variant="secondary" className="bg-gray-100 text-gray-700">{prompt.responses}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {(() => {
                        // Determine if company is mentioned based on visibility scores or averageVisibility
                        const isCompanyMentioned = Array.isArray(prompt.visibilityScores) && prompt.visibilityScores.length > 0
                          ? prompt.visibilityScores.some(score => score > 0)
                          : (prompt.averageVisibility && prompt.averageVisibility > 0);
                        
                        return (
                          <Badge className={isCompanyMentioned ? 'bg-[#06b6d4] text-white' : 'bg-gray-100 text-gray-800'}>
                            {isCompanyMentioned ? 'Yes' : 'No'}
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-center overflow-hidden">
                      <div className="truncate">
                        {getCompetitorsDisplay(prompt)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )
        ) : (
          <Card>
            <CardContent className="px-4 sm:px-6">
              <div className="text-center py-8 text-gray-500">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>No prompts tracked yet.</p>
              </div>
            </CardContent>
          </Card>
        )}
        {hasMore && (
          <div className="text-center py-3">
            <button
              onClick={() => setShowAll(true)}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Show all {filteredPrompts.length} prompts
            </button>
          </div>
        )}
    </>
  );
});
PromptTable.displayName = 'PromptTable';
