import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Eye, Target, MessageSquare, ExternalLink } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/utils';

interface PromptGap {
  id: string;
  promptText: string;
  promptType: string;
  promptCategory: string;
  aiModel: string;
  responseText: string;
  sources: any[];
  suggestion: string;
  gapType: 'not_mentioned' | 'no_owned_sources';
}

interface GroupedPromptGap {
  promptText: string;
  promptType: string;
  promptCategory: string;
  responses: {
    id: string;
    aiModel: string;
    responseText: string;
    sources: any[];
    suggestion: string;
  }[];
  commonSuggestion: string;
  actionableInsights: string[];
  gapTypes: string[];
}

export const AnswerGapsTab = () => {
  const [gaps, setGaps] = useState<GroupedPromptGap[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      loadAnswerGaps();
    }
  }, [user]);

  const loadAnswerGaps = async () => {
    if (!user) return;

    setLoading(true);
    
    try {
      // Get user's AI responses where company wasn't mentioned
      const { data: userPrompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('id, prompt_text, prompt_type, prompt_category')
        .eq('user_id', user.id);

      if (promptsError) throw promptsError;

      if (!userPrompts || userPrompts.length === 0) {
        setGaps([]);
        return;
      }

      const promptIds = userPrompts.map(p => p.id);

      const { data: responses, error: responsesError } = await supabase
        .from('prompt_responses')
        .select('*')
        .in('confirmed_prompt_id', promptIds);

      if (responsesError) throw responsesError;

      // Get company information
      const { data: onboarding } = await supabase
        .from('user_onboarding')
        .select('company_name, industry')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const companyName = onboarding?.company_name || 'Your Company';
      const industry = onboarding?.industry || 'Technology';

      // Helper function to check if sources include owned content
      const hasOwnedSources = (sources: any[], companyName: string): boolean => {
        return sources.some(source => {
          const domain = source.domain?.toLowerCase() || '';
          const title = source.title?.toLowerCase() || '';
          const companyLower = companyName.toLowerCase();
          
          // Check for company domain, subdomain, or company name in title
          return domain.includes(companyLower.replace(/\s+/g, '')) || 
                 domain.includes(companyLower.replace(/\s+/g, '-')) ||
                 title.includes(companyLower);
        });
      };

      // Filter responses with gaps
      const gaps: PromptGap[] = [];
      
      responses?.forEach(response => {
        const prompt = userPrompts.find(p => p.id === response.confirmed_prompt_id);
        if (!prompt) return;
        
        const sources = response.citations || [];
        
        // Skip if no sources
        if (sources.length === 0) return;
        
        const companyMentioned = response.company_mentioned || false;
        const hasOwned = hasOwnedSources(sources, companyName);
        
        // Case 1: Company not mentioned at all
        if (!companyMentioned) {
          const suggestion = generateSuggestion(prompt?.prompt_type || 'general', companyName, industry, sources);
          gaps.push({
            id: response.id,
            promptText: prompt?.prompt_text || 'Unknown prompt',
            promptType: prompt?.prompt_type || 'general',
            promptCategory: prompt?.prompt_category || 'general',
            aiModel: response.ai_model,
            responseText: response.response_text || '',
            sources,
            suggestion,
            gapType: 'not_mentioned'
          });
        }
        // Case 2: Company mentioned but no owned sources used
        else if (companyMentioned && !hasOwned) {
          const suggestion = `Company mentioned but AI used third-party sources. Create more authoritative ${prompt?.prompt_type || 'general'} content on your owned properties.`;
          gaps.push({
            id: response.id,
            promptText: prompt?.prompt_text || 'Unknown prompt',
            promptType: prompt?.prompt_type || 'general',
            promptCategory: prompt?.prompt_category || 'general',
            aiModel: response.ai_model,
            responseText: response.response_text || '',
            sources,
            suggestion,
            gapType: 'no_owned_sources'
          });
        }
      });

      // Group gaps by prompt text
      const groupedGaps = groupGapsByPrompt(gaps, companyName);
      setGaps(groupedGaps);
      
    } catch (error) {
      logger.error('Error loading answer gaps:', error);
      toast({
        title: "Error",
        description: "Failed to load answer gaps data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const generateSuggestion = (promptType: string, companyName: string, industry: string, sources: any[]): string => {
    if (sources.length === 0) {
      return `Create comprehensive content about ${companyName} for ${promptType} topics. AI has no sources to reference about your company.`;
    }

    const hasCompanySources = sources.some(source => 
      source.domain?.includes(companyName.toLowerCase()) || 
      source.title?.includes(companyName)
    );

    if (hasCompanySources) {
      return `Your sources exist but AI didn't highlight ${companyName}. Improve content relevance, add specific examples, and make your ${promptType} information more prominent.`;
    }

    return `AI is using competitor sources. Create superior ${promptType} content about ${companyName} that will rank higher and be more relevant.`;
  };

  const generateActionableInsights = (promptText: string, promptType: string, sources: any[], companyName: string): string[] => {
    const insights = [];
    
    // Analyze prompt type and suggest specific actions
    if (promptText.toLowerCase().includes('culture') || promptText.toLowerCase().includes('workplace')) {
      insights.push('Create detailed culture blog posts, employee testimonials, and workplace environment content');
    }
    
    if (promptText.toLowerCase().includes('benefits') || promptText.toLowerCase().includes('compensation')) {
      insights.push('Develop comprehensive benefits pages, compensation guides, and total rewards content');
    }
    
    if (promptText.toLowerCase().includes('remote') || promptText.toLowerCase().includes('flexible')) {
      insights.push('Create content about your remote work policies, flexible arrangements, and work-life balance');
    }
    
    // Source-based insights
    const hasCompanySources = sources.some(source => 
      source.domain?.includes(companyName.toLowerCase()) || 
      source.title?.includes(companyName)
    );
    
    if (hasCompanySources) {
      insights.push('Optimize existing content: add more specific details, examples, and make your information more prominent');
    } else {
      insights.push('Create new content: competitor sources are being used, develop superior content in this area');
    }
    
    return insights;
  };

  const groupGapsByPrompt = (gaps: PromptGap[], companyName: string): GroupedPromptGap[] => {
    const grouped = new Map<string, GroupedPromptGap>();
    
    gaps.forEach(gap => {
      const key = gap.promptText;
      
      if (!grouped.has(key)) {
        grouped.set(key, {
          promptText: gap.promptText,
          promptType: gap.promptType,
          promptCategory: gap.promptCategory,
          responses: [],
          commonSuggestion: gap.suggestion,
          actionableInsights: generateActionableInsights(gap.promptText, gap.promptType, gap.sources, companyName),
          gapTypes: []
        });
      }
      
      // Add gap type if not already present
      if (!grouped.get(key)!.gapTypes.includes(gap.gapType)) {
        grouped.get(key)!.gapTypes.push(gap.gapType);
      }
      
      grouped.get(key)!.responses.push({
        id: gap.id,
        aiModel: gap.aiModel,
        responseText: gap.responseText,
        sources: gap.sources,
        suggestion: gap.suggestion
      });
    });
    
    return Array.from(grouped.values());
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-pulse">Loading...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">

             {gaps.length === 0 ? (
         <Card>
           <CardContent className="text-center py-12">
             <Eye className="h-16 w-16 mx-auto mb-4 text-green-600" />
             <h3 className="text-lg font-semibold text-gray-900 mb-2">No Answer Gaps Found</h3>
             <p className="text-gray-600">
               Either your company is being mentioned in all AI responses, or there are no responses with sources to analyze.
             </p>
           </CardContent>
         </Card>
       ) : (
        <div className="space-y-4">
                     <div className="text-sm text-gray-600">
             Found {gaps.length} prompts where your company wasn't mentioned (with sources to analyze)
           </div>
          
                     <div className="overflow-x-auto">
             <table className="w-full border-collapse">
               <thead>
                 <tr className="border-b border-gray-200">
                   <th className="text-left py-3 px-4 font-medium text-gray-600 text-sm">Prompt</th>
                   <th className="text-left py-3 px-4 font-medium text-gray-600 text-sm">Prompt Type</th>
                   <th className="text-left py-3 px-4 font-medium text-gray-600 text-sm">Prompt Category</th>
                   <th className="text-left py-3 px-4 font-medium text-gray-600 text-sm">Gap Type</th>
                   <th className="text-left py-3 px-4 font-medium text-gray-600 text-sm">AI Models</th>
                 </tr>
               </thead>
               <tbody>
                 {gaps.map((groupedGap, groupIndex) => (
                   <tr key={groupIndex} className="border-b border-gray-100 hover:bg-gray-50">
                     <td className="py-4 px-4 max-w-md">
                       <span className="text-sm text-gray-700 line-clamp-2">
                         {groupedGap.promptText}
                       </span>
                     </td>
                     <td className="py-4 px-4">
                       <Badge variant="outline">{groupedGap.promptType}</Badge>
                     </td>
                     <td className="py-4 px-4">
                       <Badge variant="secondary">{groupedGap.promptCategory.replace('TalentX:', '')}</Badge>
                     </td>
                     <td className="py-4 px-4">
                       <div className="space-y-1">
                         {groupedGap.gapTypes.map((gapType, index) => (
                           <Badge 
                             key={index} 
                             variant={gapType === 'not_mentioned' ? 'destructive' : 'default'}
                             className="text-xs"
                           >
                             {gapType === 'not_mentioned' ? 'Not Mentioned' : 'No Owned Sources'}
                           </Badge>
                         ))}
                       </div>
                     </td>
                     <td className="py-4 px-4">
                       <span className="text-sm text-gray-600">
                         {groupedGap.responses.length} models
                       </span>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        </div>
      )}
    </div>
  );
};
