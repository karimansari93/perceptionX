import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { RefreshCw, Users, Calendar, Building2, LogOut, FileText, Download, Brain, Clock, TestTube, AlertCircle, CheckCircle, ChevronDown, Search, Briefcase } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { checkExistingPromptResponse, logger } from '@/lib/utils';
import { TalentXProService } from '@/services/talentXProService';
import { CompanyReportTab } from '@/components/admin/CompanyReportTab';
import { CompanyReportTextTab } from '@/components/admin/CompanyReportTextTab';
import { CompanyManagementTab } from '@/components/admin/CompanyManagementTab';
import { OrganizationManagementTab } from '@/components/admin/OrganizationManagementTab';
import { useAdminReportGeneration } from '@/hooks/useAdminReportGeneration';

interface UserRow {
  id: string;
  email: string;
  organization_name: string;
  company_name: string;
  company_id: string;
  industry: string;
  last_updated: string | null;
  created_at: string;
  has_prompts: boolean;
  has_talentx_prompts?: boolean;
  subscription_type?: string;
  response_count?: number;
}

interface RefreshProgress {
  currentPrompt: string;
  currentModel: string;
  completed: number;
  total: number;
  isRegularPrompt: boolean;
}

interface RefreshConfirmation {
  userId: string;
  userName: string;
  isProUser: boolean;
  regularPrompts: any[];
  talentXPrompts: any[];
  models: { name: string; fn: string }[];
  selectedModels: { name: string; fn: string }[];
  allPromptTypes: string[];
  selectedPromptTypes: string[];
  totalOperations: number;
}

export default function Admin() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingUsers, setRefreshingUsers] = useState<Set<string>>(new Set());
  const [refreshProgress, setRefreshProgress] = useState<RefreshProgress | null>(null);
  const [currentRefreshUser, setCurrentRefreshUser] = useState<UserRow | null>(null);
  const [confirmationData, setConfirmationData] = useState<RefreshConfirmation | null>(null);
  const [executionData, setExecutionData] = useState<RefreshConfirmation | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'reports' | 'text-reports' | 'recency-test' | 'search-insights' | 'companies' | 'organizations'>('users');
  const [reportConfirmation, setReportConfirmation] = useState<{userId: string, userEmail: string, organizationName: string, companyName: string} | null>(null);
  const [aiThemesProgress, setAiThemesProgress] = useState<{userId: string, current: number, total: number, currentResponse: string} | null>(null);
  const [isAnalyzingThemes, setIsAnalyzingThemes] = useState(false);
  const [recencyTestResults, setRecencyTestResults] = useState<any[]>([]);
  const [recencyTestLoading, setRecencyTestLoading] = useState(false);
  const [selectedCompanyForRecency, setSelectedCompanyForRecency] = useState<string>('');
  const [showSuccessfulDates, setShowSuccessfulDates] = useState(false);
  const [manualDates, setManualDates] = useState<{[key: number]: string}>({});
  const [selectedCompanyForSearchInsights, setSelectedCompanyForSearchInsights] = useState<string>('');
  const [searchInsightsLoading, setSearchInsightsLoading] = useState(false);
  const [searchInsightsResults, setSearchInsightsResults] = useState<any>(null);
  const { signOut } = useAuth();
  const { generateUserReport, isGenerating, generatingForUser } = useAdminReportGeneration();

  useEffect(() => {
    document.title = 'pX Admin';
  }, []);

  const testRecencyScores = async () => {
    console.log('=== STARTING RECENCY TEST ===');
    console.log('Selected company:', selectedCompanyForRecency);
    
    if (!selectedCompanyForRecency) {
      toast.error('Please select a company to test');
      return;
    }

    setRecencyTestLoading(true);
    setRecencyTestResults([]);
    console.log('Loading state set to true');

    try {
      // Get all citations for the selected company by joining confirmed_prompts with prompt_responses
      const { data: responses, error: responsesError } = await supabase
        .from('confirmed_prompts')
        .select(`
          prompt_type,
          prompt_responses!inner(
            citations,
            ai_model
          )
        `)
        .eq('user_id', selectedCompanyForRecency)
        .in('prompt_type', ['sentiment', 'competitive'])
        .not('prompt_responses.citations', 'is', null);

      console.log('Database query completed');
      console.log('Responses error:', responsesError);
      console.log('Responses data:', responses);
      
      if (responsesError) {
        console.error('Database error:', responsesError);
        throw responsesError;
      }

      if (!responses || responses.length === 0) {
        console.log('No responses found');
        toast.error('No sentiment or competitive citations found for this company');
        return;
      }
      
      console.log('Found responses:', responses.length);

      // Extract all citations from responses
      const allCitations: any[] = [];
      responses.forEach(response => {
        if (response.prompt_responses && Array.isArray(response.prompt_responses)) {
          response.prompt_responses.forEach((pr: any) => {
            if (pr.citations) {
              const citations = Array.isArray(pr.citations) ? pr.citations : JSON.parse(pr.citations);
              citations.forEach((citation: any) => {
                allCitations.push({
                  ...citation,
                  sourceType: response.prompt_type === 'sentiment' ? 'sentiment' : 'competitive',
                  aiModel: pr.ai_model
                });
              });
            }
          });
        }
      });

      console.log('Extracted citations:', allCitations.length);
      console.log('Sample citations:', allCitations.slice(0, 2));
      
      if (allCitations.length === 0) {
        console.log('No citations extracted');
        toast.error('No valid citations found');
        return;
      }

      // Deduplicate citations by URL to avoid analyzing the same source multiple times
      const uniqueCitations = allCitations.reduce((unique, citation) => {
        const url = citation.url || citation.link;
        if (url && !unique.some(existing => (existing.url || existing.link) === url)) {
          unique.push(citation);
        }
        return unique;
      }, []);

      console.log('Unique citations after deduplication:', uniqueCitations.length);
      console.log('Duplicates removed:', allCitations.length - uniqueCitations.length);

           // Call the recency scoring function with ALL unique citations (no limit)
           const testCitations = uniqueCitations;
      console.log('Calling edge function with citations:', testCitations.length);
      console.log('Citation details:', testCitations);
      
      const { data, error } = await supabase.functions.invoke('extract-recency-scores', {
        body: {
          citations: testCitations,
          testMode: false
        }
      });
      
      console.log('Edge function response - data:', data);
      console.log('Edge function response - error:', error);

      if (error) {
        throw error;
      }

      console.log('Full data structure:', data);
      console.log('Checking data.success:', data?.success);
      console.log('Setting results:', data?.results);
      
      // The data might be nested or the success property might be different
      if (data && (data.success === true || data.results)) {
        const results = data.results || [];
        const summary = data.summary || { withDates: 0, withoutDates: 0 };
        
        setRecencyTestResults(results);
        console.log('SUCCESS: Results set, showing success toast');
        toast.success(`Recency test completed! ${summary.withDates} citations with dates, ${summary.withoutDates} without dates`);
      } else {
        console.log('FAILURE: No valid data structure found');
        console.log('Data structure:', JSON.stringify(data, null, 2));
        toast.error('Failed to test recency scores - invalid response format');
      }

    } catch (error) {
      console.error('=== ERROR IN RECENCY TEST ===');
      console.error('Error type:', typeof error);
      console.error('Error message:', error?.message);
      console.error('Full error:', error);
      console.error('Error stack:', error?.stack);
      
      toast.error(`Failed to test recency scores: ${error?.message || 'Unknown error'}`);
    } finally {
      console.log('Setting loading to false');
      setRecencyTestLoading(false);
    }
  };

  const runSearchInsights = async () => {
    console.log('=== STARTING SEARCH INSIGHTS ===');
    console.log('Selected company:', selectedCompanyForSearchInsights);
    
    if (!selectedCompanyForSearchInsights) {
      toast.error('Please select a company to run search insights');
      return;
    }

    setSearchInsightsLoading(true);
    setSearchInsightsResults(null);
    console.log('Loading state set to true');

    try {
      // Get the company name for the selected user
      const selectedUser = users.find(user => user.id === selectedCompanyForSearchInsights);
      if (!selectedUser) {
        toast.error('Selected company not found');
        return;
      }

      console.log('Calling search-insights edge function for company:', selectedUser.company_name);
      
      const { data, error } = await supabase.functions.invoke('search-insights', {
        body: {
          companyName: selectedUser.company_name,
          company_id: selectedUser.company_id
        }
      });
      
      console.log('Search insights edge function response - data:', data);
      console.log('Search insights edge function response - error:', error);
      
      if (error) {
        console.error('Search insights edge function error:', error);
        toast.error(`Search insights failed: ${error.message || 'Unknown error'}`);
        return;
      }

      if (!data) {
        console.error('No data returned from search insights');
        toast.error('No data returned from search insights');
        return;
      }

      console.log('Search insights completed successfully');
      setSearchInsightsResults(data);
      toast.success(`Search insights completed for ${selectedUser.company_name}`);
      
    } catch (error) {
      console.error('Search insights error:', error);
      toast.error(`Search insights failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSearchInsightsLoading(false);
    }
  };

  const updateManualDate = (index: number, date: string) => {
    setManualDates(prev => ({ ...prev, [index]: date }));
    // Auto-calculate recency score when date is entered
    if (date) {
      const updatedResults = [...recencyTestResults];
      const noDateResults = recencyTestResults.filter(r => r.recencyScore === null);
      if (noDateResults[index]) {
        const originalIndex = recencyTestResults.findIndex(r => r === noDateResults[index]);
        if (originalIndex !== -1) {
          updatedResults[originalIndex].publicationDate = date;
          updatedResults[originalIndex].recencyScore = calculateRecencyScore(date);
          updatedResults[originalIndex].extractionMethod = 'manual';
          setRecencyTestResults(updatedResults);
        }
      }
    }
  };

  const markAsNoDate = (index: number) => {
    const updatedResults = [...recencyTestResults];
    const noDateResults = recencyTestResults.filter(r => r.recencyScore === null);
    if (noDateResults[index]) {
      const originalIndex = recencyTestResults.findIndex(r => r === noDateResults[index]);
      if (originalIndex !== -1) {
        updatedResults[originalIndex].extractionMethod = 'manual-no-date';
        setRecencyTestResults(updatedResults);
      }
    }
  };

  const exportResultsToCSV = () => {
    const headers = ['Domain', 'Title', 'URL', 'Publication Date', 'Recency Score', 'Method', 'Source Type'];
    const csvContent = [
      headers.join(','),
      ...recencyTestResults.map(r => [
        r.domain,
        `"${(r.title || '').replace(/"/g, '""')}"`,
        r.url || '',
        r.publicationDate || '',
        r.recencyScore || '',
        r.extractionMethod,
        r.sourceType || ''
      ].join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recency-analysis-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const calculateRecencyScore = (dateString: string): number => {
    const publicationDate = new Date(dateString);
    const now = new Date();
    const diffInDays = Math.floor((now.getTime() - publicationDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffInDays < 0) return 100;
    if (diffInDays <= 30) return 100;
    if (diffInDays <= 90) return 90;
    if (diffInDays <= 180) return 80;
    if (diffInDays <= 365) return 70;
    if (diffInDays <= 730) return 50;
    if (diffInDays <= 1095) return 30;
    if (diffInDays <= 1825) return 20;
    if (diffInDays <= 3650) return 10;
    return 0;
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);

      // 1) Get completed onboarding records (latest per user)
      const { data: allOnboardings, error: onboardingError } = await supabase
        .from('user_onboarding')
        .select('user_id, organization_name, company_name, company_id, industry, created_at')
        .not('company_name', 'is', null)
        .not('industry', 'is', null)
        .order('created_at', { ascending: false });
      if (onboardingError) throw onboardingError;
      const userIdToOnboarding: Record<string, any> = {};
      for (const row of allOnboardings || []) {
        if (!userIdToOnboarding[row.user_id]) userIdToOnboarding[row.user_id] = row;
      }
      const completedUserIds = Object.keys(userIdToOnboarding);



      if (completedUserIds.length === 0) {
        setUsers([]);
        return;
      }

      // 2) Fetch profiles only for completed users
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id,email,created_at,subscription_type')
        .in('id', completedUserIds)
        .order('created_at', { ascending: false });
      
      if (profilesError) throw profilesError;

      // 3) Confirmed prompts per user (also used to compute last response)
      const { data: prompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('user_id, id, company_id')
        .in('user_id', completedUserIds);
      if (promptsError) throw promptsError;
      const usersWithPrompts = new Set<string>((prompts || []).map((r: any) => r.user_id));
      const promptIdToUserId: Record<string, string> = {};
      const promptIdToCompanyId: Record<string, string> = {};
      const promptIds: string[] = [];
      for (const r of prompts || []) {
        promptIdToUserId[r.id] = r.user_id;
        promptIdToCompanyId[r.id] = r.company_id;
        promptIds.push(r.id);
      }

      // 3.5) Check for TalentX Pro prompts (now in confirmed_prompts)
      const { data: talentXPrompts, error: talentXError } = await supabase
        .from('confirmed_prompts')
        .select('user_id')
        .eq('is_pro_prompt', true)
        .in('user_id', completedUserIds);
      if (talentXError) {
        console.error('Error fetching TalentX prompts:', talentXError);
      }
      const usersWithTalentXPrompts = new Set<string>((talentXPrompts || []).map((r: any) => r.user_id));

      // 4) Latest prompt_responses per prompt, then reduce to per user
      const userIdToLastResponse: Record<string, string> = {};
      const userIdToResponseCount: Record<string, number> = {};
      if (promptIds.length > 0) {
        const { data: responses, error: responsesError } = await supabase
          .from('prompt_responses')
          .select('confirmed_prompt_id, created_at')
          .in('confirmed_prompt_id', promptIds)
          .order('created_at', { ascending: false });
        if (responsesError) throw responsesError;
        for (const row of responses || []) {
          const uid = promptIdToUserId[row.confirmed_prompt_id as unknown as string];
          if (uid) {
            if (!userIdToLastResponse[uid]) {
              userIdToLastResponse[uid] = row.created_at as unknown as string;
            }
            userIdToResponseCount[uid] = (userIdToResponseCount[uid] || 0) + 1;
          }
        }
      }

      const profileMap: Record<string, { email: string; created_at: string; subscription_type?: string }> = {};
      for (const p of profiles || []) {
        profileMap[p.id] = { email: p.email || 'No email', created_at: p.created_at, subscription_type: (p as any).subscription_type } as any;
      }

      const rows: UserRow[] = completedUserIds.map((uid: string) => {
        const ob = userIdToOnboarding[uid];
        const prof = profileMap[uid];
        
        return {
          id: uid,
          email: prof?.email || '(no profile) ' + uid,
          organization_name: ob?.organization_name || ob?.company_name || '—',
          company_name: ob?.company_name || '—',
          company_id: ob?.company_id || '—',
          industry: ob?.industry || '—',
          last_updated: userIdToLastResponse[uid] || null,
          created_at: prof?.created_at || ob?.created_at || new Date().toISOString(),
          has_prompts: usersWithPrompts.has(uid),
          has_talentx_prompts: usersWithTalentXPrompts.has(uid),
          subscription_type: prof?.subscription_type || 'free',
          response_count: userIdToResponseCount[uid] || 0,
        };
      });

      setUsers(rows);
    } catch (e: any) {
      console.error('Error fetching users:', e);
      toast.error('Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const prepareRefresh = async (userId: string) => {
    try {
      const target = users.find(u => u.id === userId);
      if (!target) return;

      // Check if user is Pro to determine which models to use
      const isProUser = target.subscription_type === 'pro';

      // Get all confirmed prompts (both regular and TalentX)
      const { data: allPrompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('*')
        .eq('is_active', true)
        .eq('user_id', userId);

      if (promptsError) throw promptsError;

      // Separate regular and TalentX prompts for display purposes
      const regularPrompts = allPrompts?.filter(p => !p.is_pro_prompt) || [];
      const talentXPrompts = allPrompts?.filter(p => p.is_pro_prompt) || [];

      // Check if there are any prompts to process
      const totalPrompts = (allPrompts?.length || 0);
      if (totalPrompts === 0) {
        toast.error('No active prompts found for this user');
        return;
      }

      // Define models based on subscription type
      const freeModels = [
        { name: 'openai', fn: 'test-prompt-openai' },
        { name: 'perplexity', fn: 'test-prompt-perplexity' },
        { name: 'google-ai-overviews', fn: 'test-prompt-google-ai-overviews' },
      ];

      const proModels = [
        { name: 'openai', fn: 'test-prompt-openai' },
        { name: 'perplexity', fn: 'test-prompt-perplexity' },
        { name: 'gemini', fn: 'test-prompt-gemini' },
        { name: 'deepseek', fn: 'test-prompt-deepseek' },
        { name: 'google-ai-overviews', fn: 'test-prompt-google-ai-overviews' },
        { name: 'claude', fn: 'test-prompt-claude' },
      ];

      const models = isProUser ? proModels : freeModels;
      
      // Get all unique prompt types from all prompts
      const allPromptTypes = Array.from(new Set([
        ...regularPrompts.map(p => p.prompt_type),
        ...talentXPrompts.map(p => p.prompt_type)
      ])).sort();
      
      const totalOperations = totalPrompts * models.length;

      // Show confirmation modal
      setConfirmationData({
        userId,
        userName: target.email,
        isProUser,
        regularPrompts,
        talentXPrompts,
        models,
        selectedModels: models, // Initially all models are selected
        allPromptTypes,
        selectedPromptTypes: allPromptTypes, // Initially all prompt types are selected
        totalOperations
      });

    } catch (e: any) {
      console.error('Error preparing refresh:', e);
      toast.error('Failed to prepare refresh data');
    }
  };

  const toggleModelSelection = (modelName: string) => {
    if (!confirmationData) return;
    
    const { models, selectedModels } = confirmationData;
    const model = models.find(m => m.name === modelName);
    if (!model) return;
    
    const isSelected = selectedModels.some(m => m.name === modelName);
    const newSelectedModels = isSelected 
      ? selectedModels.filter(m => m.name !== modelName)
      : [...selectedModels, model];
    
    updateTotalOperations({ ...confirmationData, selectedModels: newSelectedModels });
  };

  const togglePromptTypeSelection = (promptType: string) => {
    if (!confirmationData) return;
    
    const { selectedPromptTypes } = confirmationData;
    const isSelected = selectedPromptTypes.includes(promptType);
    const newSelectedPromptTypes = isSelected 
      ? selectedPromptTypes.filter(pt => pt !== promptType)
      : [...selectedPromptTypes, promptType];
    
    updateTotalOperations({ ...confirmationData, selectedPromptTypes: newSelectedPromptTypes });
  };

  const updateTotalOperations = (newData: RefreshConfirmation) => {
    // Count prompts that match selected prompt types
    const filteredRegularPrompts = newData.regularPrompts.filter(p => 
      newData.selectedPromptTypes.includes(p.prompt_type)
    );
    const filteredTalentXPrompts = newData.talentXPrompts.filter(p => 
      newData.selectedPromptTypes.includes(p.prompt_type)
    );
    
    const totalFilteredPrompts = filteredRegularPrompts.length + filteredTalentXPrompts.length;
    const newTotalOperations = totalFilteredPrompts * newData.selectedModels.length;
    
    setConfirmationData({
      ...newData,
      totalOperations: newTotalOperations
    });
  };

  const selectAllModels = () => {
    if (!confirmationData) return;
    
    updateTotalOperations({ 
      ...confirmationData, 
      selectedModels: [...confirmationData.models] 
    });
  };

  const deselectAllModels = () => {
    if (!confirmationData) return;
    
    updateTotalOperations({ 
      ...confirmationData, 
      selectedModels: [] 
    });
  };

  const selectAllPromptTypes = () => {
    if (!confirmationData) return;
    
    updateTotalOperations({ 
      ...confirmationData, 
      selectedPromptTypes: [...confirmationData.allPromptTypes] 
    });
  };

  const deselectAllPromptTypes = () => {
    if (!confirmationData) return;
    
    updateTotalOperations({ 
      ...confirmationData, 
      selectedPromptTypes: [] 
    });
  };

  const executeRefresh = async () => {
    if (!executionData) return;
    
    const { userId, regularPrompts, talentXPrompts, selectedModels: models, selectedPromptTypes, userName } = executionData;
    
    // Filter prompts by selected types
    const filteredRegularPrompts = regularPrompts.filter(p => selectedPromptTypes.includes(p.prompt_type));
    const filteredTalentXPrompts = talentXPrompts.filter(p => selectedPromptTypes.includes(p.prompt_type));
    try {
      setRefreshingUsers(prev => new Set(prev).add(userId));
      
      const target = users.find(u => u.id === userId);
      if (!target) return;
      
      setCurrentRefreshUser(target);

      // Use the data from executionData (already fetched)
      const totalOperations = executionData.totalOperations;
      let completedOperations = 0;

      // Initialize progress
      setRefreshProgress({
        currentPrompt: '',
        currentModel: '',
        completed: 0,
        total: totalOperations,
        isRegularPrompt: true
      });

      // Process filtered regular confirmed prompts
      if (filteredRegularPrompts && filteredRegularPrompts.length > 0) {
        for (const prompt of filteredRegularPrompts) {
          for (const model of models) {
            // Update progress
            setRefreshProgress({
              currentPrompt: prompt.prompt_text.substring(0, 100) + '...',
              currentModel: model.name.toUpperCase(),
              completed: completedOperations,
              total: totalOperations,
              isRegularPrompt: true
            });
            try {
              // First, get the raw response from the model-specific function
              const { data: resp, error } = await supabase.functions.invoke(model.fn, {
                body: { prompt: prompt.prompt_text }
              });
              
              if (error || !(resp as any)?.response) {
                if (error) {
                  logger.error(`${model.name} invocation error:`, error);
                } else {
                  logger.error(`${model.name} no response data:`, resp);
                }
                continue;
              }

              // Send through analyze-response, which stores with service role and enriches fields
              const analyzeResult = await supabase.functions.invoke('analyze-response', {
                body: {
                  response: (resp as any).response,
                  companyName: target.company_name,
                  promptType: (prompt as any).prompt_type,
                  perplexityCitations: model.name === 'perplexity' ? (resp as any).citations : null,
                  citations: model.name === 'google-ai-overviews' ? (resp as any).citations : null,
                  confirmed_prompt_id: prompt.id,
                  ai_model: model.name,
                  company_id: promptIdToCompanyId[prompt.id],
                  isTalentXPrompt: false
                }
              });
              
              if (analyzeResult.error) {
                logger.error(`${model.name} analyze-response error:`, analyzeResult.error);
              }
            } catch (e) {
              logger.error(`${model.name} unexpected error:`, e);
            }
            
            completedOperations++;
          }
        }
      }

      // Process filtered TalentX Pro prompts
      if (filteredTalentXPrompts.length > 0) {
        for (const talentXPrompt of filteredTalentXPrompts) {
          for (const model of models) {
            // Update progress for TalentX prompts
            setRefreshProgress({
              currentPrompt: `TalentX ${talentXPrompt.prompt_type}: ${talentXPrompt.talentx_attribute_id}`,
              currentModel: model.name.toUpperCase(),
              completed: completedOperations,
              total: totalOperations,
              isRegularPrompt: false
            });
            try {
              // First, get the raw response from the model-specific function
              const { data: resp, error } = await supabase.functions.invoke(model.fn, {
                body: { prompt: talentXPrompt.prompt_text }
              });
              
              if (error || !(resp as any)?.response) {
                if (error) {
                  logger.error(`${model.name} TalentX invocation error:`, error);
                } else {
                  logger.error(`${model.name} TalentX no response data:`, resp);
                }
                continue;
              }

              // Send through analyze-response (TalentX prompts already have confirmed_prompt_id)
              const analyzeResult = await supabase.functions.invoke('analyze-response', {
                body: {
                  response: (resp as any).response,
                  companyName: target.company_name,
                  promptType: talentXPrompt.prompt_type, // Already has the full prompt_type
                  perplexityCitations: model.name === 'perplexity' ? (resp as any).citations : null,
                  citations: model.name === 'google-ai-overviews' ? (resp as any).citations : null,
                  confirmed_prompt_id: talentXPrompt.id, // Use the confirmed_prompts ID directly
                  ai_model: model.name,
                  company_id: promptIdToCompanyId[talentXPrompt.id],
                  isTalentXPrompt: true
                }
              });
              
              if (analyzeResult.error) {
                logger.error(`${model.name} TalentX analyze-response error:`, analyzeResult.error);
              }
            } catch (e) {
              logger.error(`${model.name} TalentX unexpected error:`, e);
            }
            
            completedOperations++;
          }
        }
      }

      const promptCount = filteredRegularPrompts.length + filteredTalentXPrompts.length;
      const modelCount = models.length;
      toast.success(`Refreshed ${modelCount} models for ${promptCount} prompts for ${userName}`);
      await fetchUsers();
    } catch (e: any) {
      console.error('Error refreshing user models:', e);
      toast.error('Failed to refresh user models');
    } finally {
      setRefreshingUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      setRefreshProgress(null);
      setCurrentRefreshUser(null);
      setExecutionData(null);
    }
  };

  const upgradeUserToPro = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ subscription_type: 'pro' })
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        logger.error('Error upgrading user to Pro:', error);
        toast.error('Failed to upgrade user to Pro');
        return;
      }

      // Get user's company info for TalentX prompts
      const { data: onboardingData } = await supabase
        .from('user_onboarding')
        .select('organization_name, company_name, company_id, industry')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (onboardingData) {
        // Generate TalentX Pro prompts
        try {
          await TalentXProService.generateProPrompts(
            userId, 
            onboardingData.company_name || 'Your Company',
            onboardingData.industry || 'Technology'
          );
          toast.success(`User ${data.email} upgraded to Pro with TalentX prompts!`);
        } catch (talentXError) {
          logger.error('Error generating TalentX prompts:', talentXError);
          toast.success(`User ${data.email} upgraded to Pro! (TalentX prompts failed)`);
        }
      } else {
        toast.success(`User ${data.email} upgraded to Pro!`);
      }

      await fetchUsers(); // Refresh the list to show the updated subscription type
    } catch (e: any) {
      logger.error('Error upgrading user to Pro:', e);
      toast.error('Failed to upgrade user to Pro');
    }
  };

  const runAIThemesAnalysis = async (userId: string) => {
    try {
      const target = users.find(u => u.id === userId);
      if (!target) return;

      setIsAnalyzingThemes(true);
      setAiThemesProgress({
        userId,
        current: 0,
        total: 0,
        currentResponse: 'Preparing analysis...'
      });

      // Get user's responses for sentiment and competitive prompts
      const { data: responses, error: responsesError } = await supabase
        .from('prompt_responses')
        .select(`
          id,
          response_text,
          ai_model,
          confirmed_prompts!inner(
            prompt_type,
            user_id,
            prompt_text
          )
        `)
        .eq('confirmed_prompts.user_id', userId)
        .in('confirmed_prompts.prompt_type', ['sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive']);

      if (responsesError) {
        throw responsesError;
      }

      if (!responses || responses.length === 0) {
        toast.error('No sentiment/competitive responses found for this user');
        return;
      }

      setAiThemesProgress(prev => prev ? { ...prev, total: responses.length } : null);

      // Clear existing themes for this user's responses
      const responseIds = responses.map(r => r.id);
      if (responseIds.length > 0) {
        setAiThemesProgress(prev => prev ? { ...prev, currentResponse: 'Clearing existing themes...' } : null);
        const { error: deleteError } = await supabase
          .from('ai_themes')
          .delete()
          .in('response_id', responseIds);
        
        if (deleteError) {
          console.warn('Error clearing existing themes:', deleteError);
        }
      }

      // Process responses one by one
      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];
        const promptText = (response.confirmed_prompts as any)?.prompt_text || 'Unknown prompt';
        const truncatedPrompt = promptText.length > 60 ? promptText.substring(0, 60) + '...' : promptText;
        
        setAiThemesProgress(prev => prev ? {
          ...prev,
          current: i + 1,
          currentResponse: `Analyzing: ${truncatedPrompt}`
        } : null);

        try {
          const { data, error } = await supabase.functions.invoke('ai-thematic-analysis', {
            body: {
              response_id: response.id,
              company_name: target.company_name,
              response_text: response.response_text,
              ai_model: response.ai_model
            }
          });

          if (error) {
            console.error(`Error analyzing response ${response.id}:`, error);
          }
        } catch (error) {
          console.error(`Error analyzing response ${response.id}:`, error);
        }

        // Small delay to show progress
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      setAiThemesProgress(prev => prev ? { ...prev, currentResponse: 'Analysis complete!' } : null);
      toast.success(`AI themes analysis completed for ${target.email}`);
      
    } catch (e: any) {
      console.error('Error running AI themes analysis:', e);
      toast.error('Failed to run AI themes analysis');
    } finally {
      setIsAnalyzingThemes(false);
      setAiThemesProgress(null);
    }
  };

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : 'Never');

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Admin Panel</h1>
          <p className="text-gray-600">Manage users and generate company reports</p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'users' && (
            <Button onClick={fetchUsers} variant="outline">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh List
            </Button>
          )}
          <Button onClick={signOut} variant="ghost" className="text-red-600 hover:text-red-700">
            <LogOut className="w-4 h-4 mr-2" />
            Log out
          </Button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 mb-6">
        <Button
          variant={activeTab === 'users' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('users')}
          className="flex items-center gap-2"
        >
          <Users className="w-4 h-4" />
          Users
        </Button>
        <Button
          variant={activeTab === 'reports' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('reports')}
          className="flex items-center gap-2"
        >
          <FileText className="w-4 h-4" />
          Company Reports
        </Button>
        <Button
          variant={activeTab === 'text-reports' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('text-reports')}
          className="flex items-center gap-2"
        >
          <FileText className="w-4 h-4" />
          Text Reports
        </Button>
        <Button
          variant={activeTab === 'recency-test' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('recency-test')}
          className="flex items-center gap-2"
        >
          <TestTube className="w-4 h-4" />
          Recency Test
        </Button>
        <Button
          variant={activeTab === 'search-insights' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('search-insights')}
          className="flex items-center gap-2"
        >
          <Search className="w-4 h-4" />
          Search Insights
        </Button>
        <Button
          variant={activeTab === 'organizations' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('organizations')}
          className="flex items-center gap-2"
        >
          <Building2 className="w-4 h-4" />
          Organizations
        </Button>
        <Button
          variant={activeTab === 'companies' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('companies')}
          className="flex items-center gap-2"
        >
          <Briefcase className="w-4 h-4" />
          Companies
        </Button>
      </div>

      {/* Tab Content */}
      {activeTab === 'users' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" /> Users ({users.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead>Responses</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>TalentX</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-blue-500" />
                      {u.organization_name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-gray-500" />
                      {u.company_name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{u.industry}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-500" />
                      {fmt(u.last_updated)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-500" />
                      <span className="font-medium">{u.response_count || 0}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.subscription_type === 'pro' ? 'default' : 'secondary'}>
                      {u.subscription_type === 'pro' ? 'Pro' : 'Free'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.has_prompts ? 'default' : 'destructive'}>
                      {u.has_prompts ? 'Active' : 'No Prompts'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {u.subscription_type === 'pro' ? (
                      <Badge variant={u.has_talentx_prompts ? 'default' : 'secondary'}>
                        {u.has_talentx_prompts ? 'Active' : 'None'}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-gray-500">
                        N/A
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        onClick={() => prepareRefresh(u.id)}
                        disabled={refreshingUsers.has(u.id) || !u.has_prompts}
                        size="sm"
                        variant="outline"
                        title={u.subscription_type === 'pro' 
                          ? 'Refresh all 6 LLM models + TalentX Pro prompts' 
                          : 'Refresh 3 LLM models (Free plan)'}
                      >
                        <RefreshCw className={`w-4 h-4 mr-2 ${refreshingUsers.has(u.id) ? 'animate-spin' : ''}`} />
                        {refreshingUsers.has(u.id) 
                          ? 'Refreshing…' 
                          : u.subscription_type === 'pro' 
                            ? 'Refresh All Models' 
                            : 'Refresh Models'}
                      </Button>
                      
                      <Button
                        onClick={() => setReportConfirmation({userId: u.id, userEmail: u.email, organizationName: u.organization_name, companyName: u.company_name})}
                        disabled={isGenerating || !u.has_prompts}
                        size="sm"
                        variant="outline"
                        className="border-blue-600 text-blue-600 hover:bg-blue-50"
                        title="Download comprehensive PDF report for this user"
                      >
                        <Download className={`w-4 h-4 mr-2 ${generatingForUser === u.id ? 'animate-pulse' : ''}`} />
                        {generatingForUser === u.id ? 'Generating...' : 'Download Report'}
                      </Button>
                      
                      <Button
                        onClick={() => runAIThemesAnalysis(u.id)}
                        disabled={isAnalyzingThemes || !u.has_prompts}
                        size="sm"
                        variant="outline"
                        className="border-purple-600 text-purple-600 hover:bg-purple-50"
                        title="Run AI thematic analysis on user's sentiment/competitive responses"
                      >
                        <Brain className={`w-4 h-4 mr-2 ${aiThemesProgress?.userId === u.id ? 'animate-pulse' : ''}`} />
                        {aiThemesProgress?.userId === u.id ? 'Analyzing...' : 'AI Themes'}
                      </Button>
                      
                      {u.subscription_type !== 'pro' && (
                        <Button
                          onClick={() => upgradeUserToPro(u.id)}
                          size="sm"
                          variant="default"
                          className="bg-green-600 hover:bg-green-700"
                          title="Upgrade user to Pro subscription"
                        >
                          Upgrade to Pro
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}

      {/* Company Reports Tab */}
      {activeTab === 'reports' && (
        <CompanyReportTab />
      )}

      {/* Text Reports Tab */}
      {activeTab === 'text-reports' && (
        <CompanyReportTextTab />
      )}

      {/* Recency Test Tab */}
      {activeTab === 'recency-test' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TestTube className="w-5 h-5" />
              Test Recency Scores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Company Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Company to Test</label>
                <select
                  value={selectedCompanyForRecency}
                  onChange={(e) => setSelectedCompanyForRecency(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Choose a company...</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.company_name} ({user.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* Test Button */}
              <div className="flex gap-3">
                <Button
                  onClick={testRecencyScores}
                  disabled={recencyTestLoading || !selectedCompanyForRecency}
                  className="flex items-center gap-2"
                >
                  {recencyTestLoading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <TestTube className="w-4 h-4" />
                  )}
                  {recencyTestLoading ? 'Testing...' : 'Test Recency Scores'}
                </Button>
              </div>

              {/* Enhanced Results Display */}
              {recencyTestResults.length > 0 && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="w-5 h-5" />
                      <h3 className="text-lg font-semibold">Recency Analysis Results</h3>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={exportResultsToCSV}>
                        <Download className="w-4 h-4 mr-2" />
                        Export CSV
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setRecencyTestResults([])}>
                        Clear Results
                      </Button>
                    </div>
                  </div>
                  
                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-green-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-green-600">
                        {recencyTestResults.filter(r => r.recencyScore !== null).length}
                      </div>
                      <div className="text-sm text-green-700">Dates Found</div>
                    </div>
                    <div className="bg-red-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-red-600">
                        {recencyTestResults.filter(r => r.recencyScore === null).length}
                      </div>
                      <div className="text-sm text-red-700">Need Manual Review</div>
                    </div>
                    <div className="bg-yellow-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-yellow-600">
                        {recencyTestResults.filter(r => r.extractionMethod === 'problematic-domain').length}
                      </div>
                      <div className="text-sm text-yellow-700">Problematic Domains</div>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-blue-600">
                        {recencyTestResults.length}
                      </div>
                      <div className="text-sm text-blue-700">Total Citations</div>
                    </div>
                  </div>

                  {/* URLs Needing Manual Review - Priority Section */}
                  {recencyTestResults.filter(r => r.recencyScore === null).length > 0 && (
                    <div className="bg-red-50 p-4 rounded-lg">
                      <h4 className="font-semibold text-red-800 mb-3 flex items-center gap-2">
                        <AlertCircle className="w-5 h-5" />
                        URLs Needing Manual Date Entry ({recencyTestResults.filter(r => r.recencyScore === null).length})
                      </h4>
                      <div className="space-y-3">
                        {recencyTestResults
                          .filter(r => r.recencyScore === null)
                          .map((result, index) => (
                            <div key={index} className="bg-white p-3 rounded border">
                              <div className="flex items-start gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-gray-900">{result.domain}</div>
                                  <div className="text-sm text-gray-600 truncate">{result.title || 'No title'}</div>
                                  <a 
                                    href={result.url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline text-sm break-all"
                                  >
                                    {result.url}
                                  </a>
                                  <div className="flex gap-2 mt-1">
                                    <Badge variant="outline" className="text-xs">{result.extractionMethod}</Badge>
                                    <Badge variant="outline" className="text-xs">{result.sourceType}</Badge>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <input 
                                    type="date" 
                                    className="px-2 py-1 border rounded text-sm"
                                    onChange={(e) => updateManualDate(index, e.target.value)}
                                    placeholder="YYYY-MM-DD"
                                  />
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    onClick={() => markAsNoDate(index)}
                                  >
                                    No Date
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  )}

                  {/* Successfully Found Dates - Collapsed by Default */}
                  {recencyTestResults.filter(r => r.recencyScore !== null).length > 0 && (
                    <div className="bg-green-50 p-4 rounded-lg">
                      <div 
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => setShowSuccessfulDates(!showSuccessfulDates)}
                      >
                        <h4 className="font-semibold text-green-800 flex items-center gap-2">
                          <CheckCircle className="w-5 h-5" />
                          URLs with Dates Found ({recencyTestResults.filter(r => r.recencyScore !== null).length})
                        </h4>
                        <ChevronDown className={`w-5 h-5 transition-transform ${showSuccessfulDates ? 'rotate-180' : ''}`} />
                      </div>
                      
                      {showSuccessfulDates && (
                        <div className="mt-3 space-y-2">
                          {recencyTestResults
                            .filter(r => r.recencyScore !== null)
                            .map((result, index) => (
                              <div key={index} className="bg-white p-2 rounded border text-sm">
                                <div className="flex items-center justify-between">
                                  <div className="flex-1 min-w-0">
                                    <span className="font-medium">{result.domain}</span>
                                    <span className="mx-2 text-gray-500">•</span>
                                    <span className="text-gray-600">{result.publicationDate}</span>
                                    <span className="mx-2 text-gray-500">•</span>
                                    <Badge variant={result.recencyScore >= 70 ? 'default' : 'secondary'} className="text-xs">
                                      {result.recencyScore}%
                                    </Badge>
                                  </div>
                                  <a 
                                    href={result.url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline text-xs"
                                  >
                                    View
                                  </a>
                                </div>
                              </div>
                            ))
                          }
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search Insights Tab */}
      {activeTab === 'search-insights' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="w-5 h-5" />
              Search Insights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Company Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Company to Refresh Search Results</label>
                <select
                  value={selectedCompanyForSearchInsights}
                  onChange={(e) => setSelectedCompanyForSearchInsights(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Choose a company...</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.company_name} ({user.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* Run Search Insights Button */}
              <div className="flex gap-3">
                <Button
                  onClick={runSearchInsights}
                  disabled={searchInsightsLoading || !selectedCompanyForSearchInsights}
                  className="flex items-center gap-2"
                >
                  {searchInsightsLoading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  {searchInsightsLoading ? 'Running Search Insights...' : 'Run Search Insights'}
                </Button>
              </div>

              {/* Results Display */}
              {searchInsightsResults && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <h3 className="text-lg font-semibold">Search Insights Results</h3>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setSearchInsightsResults(null)}>
                      Clear Results
                    </Button>
                  </div>
                  
                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-blue-600">
                        {searchInsightsResults.organicResults?.length || 0}
                      </div>
                      <div className="text-sm text-blue-700">Organic Results</div>
                    </div>
                    <div className="bg-green-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-green-600">
                        {searchInsightsResults.ownedResults?.length || 0}
                      </div>
                      <div className="text-sm text-green-700">Owned Media</div>
                    </div>
                    <div className="bg-purple-50 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-purple-600">
                        {searchInsightsResults.employmentResults?.length || 0}
                      </div>
                      <div className="text-sm text-purple-700">Employment Sites</div>
                    </div>
                  </div>

                  {/* Detailed Results */}
                  {searchInsightsResults.organicResults && searchInsightsResults.organicResults.length > 0 && (
                    <div className="space-y-4">
                      <h4 className="text-md font-semibold">Organic Search Results</h4>
                      <div className="space-y-2">
                        {searchInsightsResults.organicResults.slice(0, 5).map((result: any, index: number) => (
                          <div key={index} className="p-3 border rounded-lg">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h5 className="font-medium text-blue-600 hover:underline">
                                  <a href={result.link} target="_blank" rel="noopener noreferrer">
                                    {result.title}
                                  </a>
                                </h5>
                                <p className="text-sm text-gray-600 mt-1">{result.snippet}</p>
                                <p className="text-xs text-gray-500 mt-1">{result.link}</p>
                              </div>
                              <Badge variant="outline" className="ml-2">
                                #{result.position}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {searchInsightsResults.ownedResults && searchInsightsResults.ownedResults.length > 0 && (
                    <div className="space-y-4">
                      <h4 className="text-md font-semibold">Owned Media Results</h4>
                      <div className="space-y-2">
                        {searchInsightsResults.ownedResults.slice(0, 3).map((result: any, index: number) => (
                          <div key={index} className="p-3 border rounded-lg bg-green-50">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h5 className="font-medium text-green-600 hover:underline">
                                  <a href={result.link} target="_blank" rel="noopener noreferrer">
                                    {result.title}
                                  </a>
                                </h5>
                                <p className="text-sm text-gray-600 mt-1">{result.snippet}</p>
                                <p className="text-xs text-gray-500 mt-1">{result.link}</p>
                              </div>
                              <Badge variant="outline" className="ml-2">
                                #{result.position}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {searchInsightsResults.employmentResults && searchInsightsResults.employmentResults.length > 0 && (
                    <div className="space-y-4">
                      <h4 className="text-md font-semibold">Employment Sites</h4>
                      <div className="space-y-2">
                        {searchInsightsResults.employmentResults.slice(0, 3).map((result: any, index: number) => (
                          <div key={index} className="p-3 border rounded-lg bg-purple-50">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h5 className="font-medium text-purple-600 hover:underline">
                                  <a href={result.link} target="_blank" rel="noopener noreferrer">
                                    {result.title}
                                  </a>
                                </h5>
                                <p className="text-sm text-gray-600 mt-1">{result.snippet}</p>
                                <p className="text-xs text-gray-500 mt-1">{result.link}</p>
                              </div>
                              <Badge variant="outline" className="ml-2">
                                #{result.position}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-blue-50 p-3 rounded-lg">
                <div className="text-xs text-blue-700">
                  <strong>Note:</strong> This will run comprehensive search insights for the selected company, including organic search results, owned media analysis, and employment site monitoring. The process may take 1-2 minutes to complete.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Modal */}
      <Dialog open={confirmationData !== null} onOpenChange={() => setConfirmationData(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Confirm Model Refresh</DialogTitle>
          </DialogHeader>
          
          {confirmationData && (
            <>
              <div className="flex-1 overflow-y-auto space-y-6 pr-2">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-sm font-medium text-blue-900">
                  <strong>User:</strong> {confirmationData.userName}
                </div>
                <div className="text-sm text-blue-700">
                  <strong>Plan:</strong> {confirmationData.isProUser ? 'Pro' : 'Free'}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Models ({confirmationData.selectedModels.length}/{confirmationData.models.length})</h4>
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={selectAllModels}
                        className="text-xs text-blue-600 hover:text-blue-800 underline"
                      >
                        All
                      </button>
                      <span className="text-xs text-gray-400">|</span>
                      <button
                        type="button"
                        onClick={deselectAllModels}
                        className="text-xs text-red-600 hover:text-red-800 underline"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {confirmationData.models.map((model) => {
                      const isSelected = confirmationData.selectedModels.some(m => m.name === model.name);
                      return (
                        <div key={model.name} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`model-${model.name}`}
                            checked={isSelected}
                            onChange={() => toggleModelSelection(model.name)}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <label 
                            htmlFor={`model-${model.name}`}
                            className={`text-sm cursor-pointer ${isSelected ? 'font-medium' : 'text-gray-600'}`}
                          >
                            {model.name.toUpperCase()}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  {confirmationData.selectedModels.length === 0 && (
                    <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                      ⚠️ Please select at least one model to refresh
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Prompt Types ({confirmationData.selectedPromptTypes.length}/{confirmationData.allPromptTypes.length})</h4>
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={selectAllPromptTypes}
                        className="text-xs text-blue-600 hover:text-blue-800 underline"
                      >
                        All
                      </button>
                      <span className="text-xs text-gray-400">|</span>
                      <button
                        type="button"
                        onClick={deselectAllPromptTypes}
                        className="text-xs text-red-600 hover:text-red-800 underline"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {confirmationData.allPromptTypes.map((promptType) => {
                      const isSelected = confirmationData.selectedPromptTypes.includes(promptType);
                      const displayName = promptType.replace('talentx_', '').replace(/_/g, ' ');
                      return (
                        <div key={promptType} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`prompt-${promptType}`}
                            checked={isSelected}
                            onChange={() => togglePromptTypeSelection(promptType)}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <label 
                            htmlFor={`prompt-${promptType}`}
                            className={`text-sm cursor-pointer capitalize ${isSelected ? 'font-medium' : 'text-gray-600'}`}
                          >
                            {displayName}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  {confirmationData.selectedPromptTypes.length === 0 && (
                    <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                      ⚠️ Please select at least one prompt type
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <h4 className="font-medium">Prompts to Process</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    <div className="text-sm bg-gray-50 p-3 rounded">
                      <strong>Total Prompts:</strong> {confirmationData.regularPrompts.length + confirmationData.talentXPrompts.length}
                      <div className="text-xs text-gray-600 mt-2">
                        <div>• Regular prompts: {confirmationData.regularPrompts.length}</div>
                        {confirmationData.talentXPrompts.length > 0 && (
                          <div>• TalentX prompts: {confirmationData.talentXPrompts.length}</div>
                        )}
                      </div>
                      <div className="text-xs text-gray-600 mt-2 max-h-20 overflow-y-auto">
                        {[...confirmationData.regularPrompts, ...confirmationData.talentXPrompts].slice(0, 5).map((p, i) => (
                          <div key={i} className="truncate">
                            • {p.prompt_text?.substring(0, 60) || `${p.talentx_attribute_id} (${p.prompt_type})`}...
                          </div>
                        ))}
                        {(confirmationData.regularPrompts.length + confirmationData.talentXPrompts.length) > 5 && (
                          <div className="text-xs text-gray-500">
                            ...and {(confirmationData.regularPrompts.length + confirmationData.talentXPrompts.length) - 5} more
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-50 p-4 rounded-lg">
                <div className="text-sm font-medium text-yellow-900">
                  <strong>Total Operations:</strong> {confirmationData.totalOperations}
                </div>
                <div className="text-xs text-yellow-700 mt-1">
                  This will make {confirmationData.totalOperations} API calls and may take several minutes to complete.
                </div>
              </div>
            </div>

            {/* Fixed buttons at bottom */}
            <div className="flex justify-end space-x-3 pt-4 border-t bg-white">
                <Button
                  variant="outline"
                  onClick={() => setConfirmationData(null)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (confirmationData.selectedModels.length === 0) {
                      toast.error('Please select at least one model to refresh');
                      return;
                    }
                    if (confirmationData.selectedPromptTypes.length === 0) {
                      toast.error('Please select at least one prompt type to refresh');
                      return;
                    }
                    setExecutionData(confirmationData);
                    setConfirmationData(null);
                    executeRefresh();
                  }}
                  disabled={refreshingUsers.size > 0 || confirmationData.selectedModels.length === 0 || confirmationData.selectedPromptTypes.length === 0}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {refreshingUsers.size > 0 ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Refreshing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Confirm Refresh ({confirmationData.selectedModels.length} models)
                    </>
                  )}
                </Button>
            </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Loading Modal */}
      <Dialog open={refreshProgress !== null} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Refreshing Models</DialogTitle>
          </DialogHeader>
          
          {refreshProgress && currentRefreshUser && (
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                <strong>User:</strong> {currentRefreshUser.email}
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{refreshProgress.completed} / {refreshProgress.total}</span>
                </div>
                <Progress 
                  value={(refreshProgress.completed / refreshProgress.total) * 100} 
                  className="w-full"
                />
              </div>
              
              <div className="space-y-2">
                <div className="text-sm">
                  <strong>Current Model:</strong> {refreshProgress.currentModel}
                </div>
                <div className="text-sm">
                  <strong>Prompt Type:</strong> {refreshProgress.isRegularPrompt ? 'Regular' : 'TalentX Pro'}
                </div>
                <div className="text-sm">
                  <strong>Current Prompt:</strong>
                  <div className="mt-1 p-2 bg-gray-50 rounded text-xs font-mono">
                    {refreshProgress.currentPrompt}
                  </div>
                </div>
              </div>
              
              <div className="text-xs text-gray-500">
                Remaining: {refreshProgress.total - refreshProgress.completed} operations
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Report Generation Confirmation Dialog */}
      <Dialog open={!!reportConfirmation} onOpenChange={() => setReportConfirmation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Generate User Report
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-gray-600">
              Generate a comprehensive PDF report for <strong>{reportConfirmation?.userEmail}</strong> 
              <br />
              <span className="text-sm text-gray-500">
                Organization: {reportConfirmation?.organizationName} | Company: {reportConfirmation?.companyName}
              </span>
            </p>
            <p className="text-sm text-gray-500">
              This will create a detailed AI perception analysis report including executive summary, 
              competitor insights, key themes, sources analysis, and improvement opportunities.
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setReportConfirmation(null)}
                disabled={isGenerating}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (reportConfirmation) {
                    generateUserReport(reportConfirmation.userId, reportConfirmation.userEmail);
                    setReportConfirmation(null);
                  }
                }}
                disabled={isGenerating}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isGenerating ? 'Generating...' : 'Generate Report'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Themes Analysis Progress Modal */}
      <Dialog open={aiThemesProgress !== null} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5" />
              AI Themes Analysis
            </DialogTitle>
          </DialogHeader>
          
          {aiThemesProgress && (
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                <strong>User:</strong> {users.find(u => u.id === aiThemesProgress.userId)?.email}
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{aiThemesProgress.current} / {aiThemesProgress.total}</span>
                </div>
                <Progress 
                  value={(aiThemesProgress.current / aiThemesProgress.total) * 100} 
                  className="w-full"
                />
              </div>
              
              <div className="text-sm">
                <strong>Status:</strong> {aiThemesProgress.currentResponse}
              </div>
              
              <div className="text-xs text-gray-500">
                Analyzing sentiment and competitive responses for thematic insights...
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Recency Test Loading Modal */}
      <Dialog open={recencyTestLoading} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin" />
              Testing Recency Scores
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 relative">
                <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">
                Analyzing Citation Dates
              </h3>
               <p className="text-sm text-gray-600 mt-2">
                 Extracting publication dates from ALL citations (no limit)...
               </p>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span>Checking URL patterns for dates</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span>Using Firecrawl AI to extract dates</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                <span>Scraping HTML for date metadata</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                <span>Calculating recency scores</span>
              </div>
            </div>
            
            <div className="bg-blue-50 p-3 rounded-lg">
               <div className="text-xs text-blue-700">
                 <strong>Note:</strong> Processing ALL citations with no limit. Large batches may take 2-3 minutes but will be much faster on subsequent runs due to caching.
               </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Search Insights Loading Modal */}
      <Dialog open={searchInsightsLoading} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin" />
              Running Search Insights
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 relative">
                <div className="absolute inset-0 border-4 border-green-200 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-green-600 rounded-full border-t-transparent animate-spin"></div>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">
                Collecting Search Results
              </h3>
               <p className="text-sm text-gray-600 mt-2">
                Analyzing organic search results, owned media, and employment sites...
              </p>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span>Fetching organic search results</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span>Analyzing owned media presence</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                <span>Monitoring employment sites</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                <span>Categorizing and storing results</span>
              </div>
            </div>
            
            <div className="bg-green-50 p-3 rounded-lg">
               <div className="text-xs text-green-700">
                 <strong>Note:</strong> This process includes comprehensive search analysis and may take 1-2 minutes to complete.
               </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Organizations Management Tab */}
      {activeTab === 'organizations' && <OrganizationManagementTab />}

      {/* Companies Management Tab */}
      {activeTab === 'companies' && <CompanyManagementTab />}
    </div>
  );
}


