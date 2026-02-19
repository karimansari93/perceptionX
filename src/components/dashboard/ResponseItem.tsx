import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import LLMLogo from "@/components/LLMLogo";
import { PromptResponse } from "@/types/dashboard";
import { CitationDisplay } from "@/components/CitationDisplay";
import { EnhancedCitation, groupCitationsByDomain } from "@/utils/citationUtils";
import { getLLMDisplayName } from '@/config/llmLogos';

interface ResponseItemProps {
  response: PromptResponse;
  parseAndEnhanceCitations: (citations: any) => EnhancedCitation[];
  truncateText: (text: string, maxLength?: number) => string;
}

export const ResponseItem = ({ 
  response, 
  parseAndEnhanceCitations, 
  truncateText, 
}: ResponseItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpansion = () => {
    setIsExpanded(!isExpanded);
  };

  const enhancedCitations = parseAndEnhanceCitations(response.citations);
  const groupedCitations = groupCitationsByDomain(enhancedCitations);

  return (
    <div className="border rounded-lg p-4 hover:bg-gray-50">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3">
          <div className="flex items-center bg-blue-50 px-2 py-1 rounded-lg border">
            <LLMLogo modelName={response.ai_model} size="sm" className="mr-1" />
            <span className="text-sm text-blue-700">{getLLMDisplayName(response.ai_model)}</span>
          </div>
          <Badge variant="outline">
            {response.confirmed_prompts?.prompt_category}
          </Badge>
        </div>
        <span className="text-sm text-gray-500">
          {new Date(response.tested_at).toLocaleString()}
        </span>
      </div>
      
      <div className="mb-3">
        <p className="text-sm text-gray-600 mb-2">
          <strong>Prompt:</strong> {truncateText(response.confirmed_prompts?.prompt_text || '', 100)}
        </p>
      </div>

      <div className="bg-gray-50 rounded p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm text-gray-800 leading-relaxed">
              {isExpanded 
                ? (response.response_text || '') 
                : truncateText(response.response_text || '', 200)
              }
            </p>
          </div>
          {(response.response_text || '').length > 200 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleExpansion}
              className="ml-2 flex-shrink-0"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="w-4 h-4 mr-1" />
                  Less
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4 mr-1" />
                  More
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {enhancedCitations.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-gray-500 mb-2">Sources:</p>
          <div className="space-y-1">
            {Array.from(groupedCitations.entries()).slice(0, 3).map(([domain, citations], index) => {
              const primaryCitation = citations.find(c => c.url) || citations[0];
              return (
                <CitationDisplay 
                  key={index} 
                  citation={primaryCitation} 
                  size="sm"
                />
              );
            })}
            {groupedCitations.size > 3 && (
              <Badge variant="outline" className="text-xs">
                +{groupedCitations.size - 3} more sources
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
