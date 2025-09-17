import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PromptData } from "@/types/dashboard";
import { MessageSquare, TrendingUp, TrendingDown, Minus, Target, Filter } from "lucide-react";
import { useState, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSubscription } from "@/hooks/useSubscription";

interface PromptTableProps {
  prompts: PromptData[];
  onPromptClick: (promptText: string) => void;
}

export const PromptTable = ({ prompts, onPromptClick }: PromptTableProps) => {
  const { isPro } = useSubscription();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const isMobile = useIsMobile();

  // Helper function to map TalentX attribute IDs to user-friendly labels
  const getTalentXCategoryLabel = (attributeId: string) => {
    const labelMap: { [key: string]: string } = {
      'mission-purpose': 'Mission & Purpose',
      'rewards-recognition': 'Rewards & Recognition',
      'company-culture': 'Company Culture',
      'social-impact': 'Social Impact',
      'inclusion': 'Inclusion',
      'innovation': 'Innovation',
      'wellbeing-balance': 'Wellbeing & Balance',
      'leadership': 'Leadership',
      'security-perks': 'Security & Perks',
      'career-opportunities': 'Career Opportunities'
    };
    
    return labelMap[attributeId] || attributeId
      .replace('-', ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  };

  // Get unique types and categories for filter options
  const uniqueTypes = useMemo(() => {
    const types = new Set<string>();
    prompts.forEach(prompt => {
      let typeLabel = prompt.type;
      if (prompt.type.startsWith('talentx_')) {
        typeLabel = prompt.type.replace('talentx_', '');
      }
      types.add(typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1));
    });
    return Array.from(types).sort();
  }, [prompts]);

  const uniqueCategories = useMemo(() => {
    const categories = new Set<string>();
    prompts.forEach(prompt => {
      // Use the category field directly from PromptData
      let categoryLabel = prompt.category;
      
      // If it's a TalentX category, format it nicely
      if (categoryLabel.startsWith('TalentX: ')) {
        const attributeId = categoryLabel.replace('TalentX: ', '');
        categoryLabel = getTalentXCategoryLabel(attributeId);
      } else {
        // All non-TalentX categories should be classified as "General"
        categoryLabel = 'General';
      }
      
      categories.add(categoryLabel);
    });
    return Array.from(categories).sort();
  }, [prompts]);

  // Filter prompts based on selected filters
  const filteredPrompts = useMemo(() => {
    return prompts.filter(prompt => {
      // Type filter
      let typeLabel = prompt.type;
      if (prompt.type.startsWith('talentx_')) {
        typeLabel = prompt.type.replace('talentx_', '');
      }
      const displayType = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);
      
      if (typeFilter !== "all" && displayType !== typeFilter) {
        return false;
      }

      // Category filter
      let categoryLabel = prompt.category;
      
      // If it's a TalentX category, format it nicely
      if (categoryLabel.startsWith('TalentX: ')) {
        const attributeId = categoryLabel.replace('TalentX: ', '');
        categoryLabel = getTalentXCategoryLabel(attributeId);
      } else {
        // All non-TalentX categories should be classified as "General"
        categoryLabel = 'General';
      }
      
      if (categoryFilter !== "all" && categoryLabel !== categoryFilter) {
        return false;
      }

      return true;
    });
  }, [prompts, typeFilter, categoryFilter]);
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
    const mentionBonus = prompt.competitorMentions ? prompt.competitorMentions.length * 10 : 0;
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
    
    // Capitalize the first letter
    typeLabel = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);
    
    // Apply colors matching PromptSummaryCards
    let badgeClass = "bg-gray-100 text-gray-800"; // default
    if (typeLabel.toLowerCase() === 'sentiment') {
      badgeClass = "bg-blue-100 text-blue-800";
    } else if (typeLabel.toLowerCase() === 'visibility') {
      badgeClass = "bg-green-100 text-green-800";
    } else if (typeLabel.toLowerCase() === 'competitive') {
      badgeClass = "bg-purple-100 text-purple-800";
    }
    
    return <Badge className={badgeClass}>{typeLabel}</Badge>;
  };

  const getCategoryBadge = (prompt: PromptData) => {
    let categoryLabel = prompt.category;
    
    // If it's a TalentX category, format it nicely
    if (categoryLabel.startsWith('TalentX: ')) {
      const attributeId = categoryLabel.replace('TalentX: ', '');
      categoryLabel = getTalentXCategoryLabel(attributeId);
    } else {
      // All non-TalentX categories should be classified as "General"
      categoryLabel = 'General';
    }
    
    return <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">{categoryLabel}</Badge>;
  };

  return (
    <>
      {/* Filters above the card - Only show for Pro users */}
      {isPro && (
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3 mb-4">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {uniqueTypes.map(type => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {uniqueCategories.map(category => (
                <SelectItem key={category} value={category}>{category}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Card>
        <CardContent className="px-4 sm:px-6">
        {filteredPrompts.length > 0 ? (
          isMobile ? (
                         // Mobile-friendly card layout
             <div className="space-y-4">
              {filteredPrompts.map((prompt, index) => (
                                 <div
                   key={index}
                   className="p-5 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                   onClick={() => onPromptClick(prompt.prompt)}
                 >
                                     {/* Prompt text - full width on mobile */}
                   <div className="mb-4">
                     <p className="text-sm font-medium text-gray-900 leading-relaxed">
                       {prompt.prompt}
                     </p>
                   </div>
                  
                                                        {/* Badges row - Type, Category, Sentiment */}
                   <div className="flex items-center gap-2 mb-3">
                     {getTypeBadge(prompt)}
                     {getCategoryBadge(prompt)}
                     {getSentimentPill(prompt.sentimentLabel)}
                   </div>
                   
                   {/* Responses row */}
                   <div className="flex items-center gap-2 mb-3">
                     <Badge variant="secondary" className="text-xs">{prompt.responses} responses</Badge>
                   </div>
                  
                  {/* Visibility score - full width */}
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Visibility:</span>
                      {Array.isArray(prompt.visibilityScores) && prompt.visibilityScores.length > 0 ? (
                        (() => {
                          const avgVisibility = prompt.visibilityScores!.reduce((sum, score) => sum + score, 0) / prompt.visibilityScores!.length;
                          return (
                            <div className="flex items-center gap-2">
                              <svg width="16" height="16" viewBox="0 0 20 20">
                                <circle
                                  cx="10"
                                  cy="10"
                                  r="8"
                                  fill="none"
                                  stroke="#e5e7eb"
                                  strokeWidth="2"
                                />
                                <circle
                                  cx="10"
                                  cy="10"
                                  r="8"
                                  fill="none"
                                  stroke={
                                    avgVisibility >= 95 ? '#22c55e' :
                                    avgVisibility >= 60 ? '#4ade80' :
                                    avgVisibility > 0 ? '#fde047' :
                                    '#e5e7eb'
                                  }
                                  strokeWidth="2"
                                  strokeDasharray={2 * Math.PI * 8}
                                  strokeDashoffset={2 * Math.PI * 8 * (1 - avgVisibility / 100)}
                                  strokeLinecap="round"
                                  style={{ transition: 'stroke-dashoffset 0.4s, stroke 0.4s' }}
                                />
                              </svg>
                              <span className="text-xs font-medium text-gray-900">{Math.round(avgVisibility)}%</span>
                            </div>
                          );
                        })()
                      ) : (
                        <span className="text-xs text-gray-400">N/A</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // Desktop table layout
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Prompt</TableHead>
                  <TableHead className="text-center">Type</TableHead>
                  <TableHead className="text-center">Category</TableHead>
                  <TableHead className="text-center">Responses</TableHead>
                  <TableHead className="text-center">Sentiment</TableHead>
                  <TableHead className="text-center">Visibility</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPrompts.map((prompt, index) => (
                  <TableRow 
                    key={index} 
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => onPromptClick(prompt.prompt)}
                  >
                    <TableCell className="font-medium max-w-md">
                      <div className="truncate" title={prompt.prompt}>
                        {prompt.prompt}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {getTypeBadge(prompt)}
                    </TableCell>
                    <TableCell className="text-center">
                      {getCategoryBadge(prompt)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{prompt.responses}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {getSentimentPill(prompt.sentimentLabel)}
                    </TableCell>
                    <TableCell className="text-center">
                      {Array.isArray(prompt.visibilityScores) && prompt.visibilityScores.length > 0 ? (
                        (() => {
                          const avgVisibility = prompt.visibilityScores!.reduce((sum, score) => sum + score, 0) / prompt.visibilityScores!.length;
                          return (
                            <div className="flex items-center gap-1 justify-center">
                              <svg width="20" height="20" viewBox="0 0 20 20" className="-ml-1">
                                <circle
                                  cx="10"
                                  cy="10"
                                  r="8"
                                  fill="none"
                                  stroke="#e5e7eb"
                                  strokeWidth="2"
                                />
                                <circle
                                  cx="10"
                                  cy="10"
                                  r="8"
                                  fill="none"
                                  stroke={
                                    avgVisibility >= 95 ? '#22c55e' :
                                    avgVisibility >= 60 ? '#4ade80' :
                                    avgVisibility > 0 ? '#fde047' :
                                    '#e5e7eb'
                                  }
                                  strokeWidth="2"
                                  strokeDasharray={2 * Math.PI * 8}
                                  strokeDashoffset={2 * Math.PI * 8 * (1 - avgVisibility / 100)}
                                  strokeLinecap="round"
                                  style={{ transition: 'stroke-dashoffset 0.4s, stroke 0.4s' }}
                                />
                              </svg>
                              <span className="text-xs font-regular text-gray-900">{Math.round(avgVisibility)}%</span>
                            </div>
                          );
                        })()
                      ) : 'N/A'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        ) : (
          <div className="text-center py-8 text-gray-500">
            <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No prompts tracked yet.</p>
          </div>
        )}
        </CardContent>
      </Card>
    </>
  );
};
