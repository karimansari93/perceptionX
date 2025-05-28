import { useState, useEffect, useMemo } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PromptResponse, DashboardMetrics, SentimentTrendData, CitationCount, PromptData, Citation } from "@/types/dashboard";

export const useDashboardData = () => {
  const { user } = useAuth();
  const [responses, setResponses] = useState<PromptResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyName, setCompanyName] = useState<string>("");

  const fetchCompanyName = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('user_onboarding')
        .select('company_name')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        console.error('Error fetching company name:', error);
      } else if (data) {
        setCompanyName(data.company_name);
      }
    } catch (error) {
      console.error('Error fetching company name:', error);
    }
  };

  const fetchResponses = async () => {
    if (!user) return;
    
    try {
      const { data: userPrompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('id')
        .eq('user_id', user.id);

      if (promptsError) throw promptsError;

      if (!userPrompts || userPrompts.length === 0) {
        setResponses([]);
        setLoading(false);
        return;
      }

      const promptIds = userPrompts.map(p => p.id);

      const { data, error } = await supabase
        .from('prompt_responses')
        .select(`
          *,
          confirmed_prompts (
            prompt_text,
            prompt_category,
            prompt_type
          )
        `)
        .in('confirmed_prompt_id', promptIds)
        .order('tested_at', { ascending: false });

      if (error) throw error;
      
      setResponses(data || []);
    } catch (error) {
      console.error('Error fetching responses:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    await fetchResponses();
  };

  useEffect(() => {
    if (user) {
      fetchResponses();
      fetchCompanyName();
    }
  }, [user]);

  const parseCitations = (citations: any): Citation[] => {
    if (!citations) return [];
    if (Array.isArray(citations)) return citations;
    if (typeof citations === 'string') {
      try {
        const parsed = JSON.parse(citations);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const metrics: DashboardMetrics = useMemo(() => {
    const averageSentiment = responses.length > 0 
      ? responses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0) / responses.length 
      : 0;

    const sentimentLabel = averageSentiment > 0.1 ? 'Positive' : averageSentiment < -0.1 ? 'Negative' : 'Neutral';
    const totalCitations = responses.reduce((sum, r) => sum + parseCitations(r.citations).length, 0);
    const uniqueDomains = new Set(
      responses.flatMap(r => parseCitations(r.citations).map((c: Citation) => c.domain).filter(Boolean))
    ).size;

    return {
      averageSentiment,
      sentimentLabel,
      totalCitations,
      uniqueDomains,
      totalResponses: responses.length,
      positiveCount: responses.filter(r => (r.sentiment_score || 0) > 0.1).length,
      neutralCount: responses.filter(r => Math.abs(r.sentiment_score || 0) <= 0.1).length,
      negativeCount: responses.filter(r => (r.sentiment_score || 0) < -0.1).length,
    };
  }, [responses]);

  const sentimentTrend: SentimentTrendData[] = useMemo(() => {
    return responses.reduce((acc: SentimentTrendData[], response) => {
      const date = new Date(response.tested_at).toLocaleDateString();
      const existing = acc.find(item => item.date === date);
      
      if (existing) {
        existing.sentiment = (existing.sentiment + (response.sentiment_score || 0)) / 2;
        existing.count += 1;
      } else {
        acc.push({
          date,
          sentiment: response.sentiment_score || 0,
          count: 1
        });
      }
      
      return acc;
    }, []).slice(0, 7);
  }, [responses]);

  const topCitations: CitationCount[] = useMemo(() => {
    const allCitations = responses.flatMap(r => parseCitations(r.citations));
    const citationCounts = allCitations.reduce((acc: any, citation: Citation) => {
      const domain = citation.domain;
      if (domain) {
        acc[domain] = (acc[domain] || 0) + 1;
      }
      return acc;
    }, {});

    return Object.entries(citationCounts)
      .map(([domain, count]) => ({ domain, count: count as number }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [responses]);

  const promptsData: PromptData[] = useMemo(() => {
    return responses.reduce((acc: PromptData[], response) => {
      const existing = acc.find(item => 
        item.prompt === response.confirmed_prompts?.prompt_text
      );
      
      if (existing) {
        existing.responses += 1;
        existing.avgSentiment = (existing.avgSentiment + (response.sentiment_score || 0)) / 2;
      } else {
        acc.push({
          prompt: response.confirmed_prompts?.prompt_text || '',
          category: response.confirmed_prompts?.prompt_category || '',
          type: response.confirmed_prompts?.prompt_type || 'sentiment',
          responses: 1,
          avgSentiment: response.sentiment_score || 0,
          sentimentLabel: response.sentiment_label || 'neutral'
        });
      }
      
      return acc;
    }, []);
  }, [responses]);

  return {
    responses,
    loading,
    companyName,
    metrics,
    sentimentTrend,
    topCitations,
    promptsData,
    refreshData,
    parseCitations
  };
};
