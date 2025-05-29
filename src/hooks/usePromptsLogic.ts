import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface OnboardingData {
  companyName: string;
  industry: string;
  hiringChallenges: string[];
  targetRoles: string[];
  currentStrategy: string;
  talentCompetitors: string[];
}

interface GeneratedPrompt {
  id: string;
  text: string;
  category: string;
  type: 'sentiment' | 'visibility' | 'competitive';
}

export interface ProgressInfo {
  currentModel?: string;
  currentPrompt?: string;
  completed: number;
  total: number;
}

export const usePromptsLogic = (onboardingData: OnboardingData | undefined) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [prompts, setPrompts] = useState<GeneratedPrompt[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [onboardingRecord, setOnboardingRecord] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressInfo>({ completed: 0, total: 0 });

  useEffect(() => {
    if (!user) {
      console.log('No user found, redirecting to auth');
      navigate('/auth');
      return;
    }

    if (!onboardingData) {
      console.log('No onboarding data found, redirecting to onboarding');
      navigate('/onboarding');
      return;
    }

    checkOnboardingRecord();
    generatePrompts();
  }, [onboardingData, user, navigate]);

  const checkOnboardingRecord = async () => {
    if (!user) return;

    try {
      console.log('Checking for existing onboarding record for user:', user.id);
      
      const { data: userOnboarding, error: userError } = await supabase
        .from('user_onboarding')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (userError) {
        console.error('Error fetching user onboarding:', userError);
      }

      if (userOnboarding && userOnboarding.length > 0) {
        console.log('Found existing onboarding record for user:', userOnboarding[0]);
        setOnboardingRecord(userOnboarding[0]);
        return;
      }

      console.log('No user-linked onboarding found, checking for unlinked records');
      
      const { data: unlinkedOnboarding, error: unlinkedError } = await supabase
        .from('user_onboarding')
        .select('*')
        .is('user_id', null)
        .eq('company_name', onboardingData?.companyName)
        .order('created_at', { ascending: false })
        .limit(1);

      if (unlinkedError) {
        console.error('Error fetching unlinked onboarding:', unlinkedError);
      }

      if (unlinkedOnboarding && unlinkedOnboarding.length > 0) {
        console.log('Found unlinked onboarding record, linking to user:', unlinkedOnboarding[0]);
        
        const { data: updatedRecord, error: updateError } = await supabase
          .from('user_onboarding')
          .update({ user_id: user.id })
          .eq('id', unlinkedOnboarding[0].id)
          .select()
          .single();

        if (updateError) {
          console.error('Error linking onboarding record:', updateError);
          throw updateError;
        }

        console.log('Successfully linked onboarding record:', updatedRecord);
        setOnboardingRecord(updatedRecord);
        return;
      }

      console.log('No existing onboarding found, creating new record');
      await createOnboardingRecord();

    } catch (error) {
      console.error('Error in checkOnboardingRecord:', error);
      setError('Failed to find or create onboarding record. Please try going through onboarding again.');
    }
  };

  const createOnboardingRecord = async () => {
    if (!user || !onboardingData) return;

    try {
      const newRecord = {
        user_id: user.id,
        company_name: onboardingData.companyName,
        industry: onboardingData.industry,
        hiring_challenges: onboardingData.hiringChallenges,
        target_roles: onboardingData.targetRoles,
        current_strategy: onboardingData.currentStrategy,
        talent_competitors: onboardingData.talentCompetitors,
        session_id: `session_${user.id}_${Date.now()}`
      };

      const { data: createdRecord, error } = await supabase
        .from('user_onboarding')
        .insert(newRecord)
        .select()
        .single();

      if (error) {
        console.error('Error creating onboarding record:', error);
        throw error;
      }

      console.log('Created new onboarding record:', createdRecord);
      setOnboardingRecord(createdRecord);
    } catch (error) {
      console.error('Error creating onboarding record:', error);
      throw error;
    }
  };

  const generatePrompts = () => {
    if (!onboardingData) return;
    
    const { companyName, industry, targetRoles, talentCompetitors, hiringChallenges } = onboardingData;
    
    console.log('=== GENERATING PROMPTS ===');
    console.log('Company:', companyName);
    console.log('Industry:', industry);
    console.log('Target Roles:', targetRoles);
    console.log('Competitors:', talentCompetitors);
    console.log('Hiring Challenges:', hiringChallenges);
    
    let generatedPrompts: GeneratedPrompt[] = [];

    // Sentiment prompts for each target role
    targetRoles.forEach((role, idx) => {
      generatedPrompts.push({
        id: `sentiment-role-${idx}`,
        text: `What are the pros and cons of working as a ${role} at ${companyName} compared to other ${industry} companies?`,
        category: 'Work Environment',
        type: 'sentiment'
      });
      generatedPrompts.push({
        id: `sentiment-career-${idx}`,
        text: `How does ${companyName}'s approach to ${role} career development compare to industry standards?`,
        category: 'Career Development',
        type: 'sentiment'
      });
    });

    // Sentiment prompts for each hiring challenge
    hiringChallenges.forEach((challenge, idx) => {
      generatedPrompts.push({
        id: `sentiment-challenge-${idx}`,
        text: `How does ${companyName} address the challenge of ${challenge}?`,
        category: 'Hiring Challenge',
        type: 'sentiment'
      });
    });

    // Visibility prompts for each target role
    targetRoles.forEach((role, idx) => {
      generatedPrompts.push({
        id: `visibility-role-${idx}`,
        text: `Which ${industry} companies offer the best career opportunities for ${role} professionals?`,
        category: 'Industry Leaders',
        type: 'visibility'
      });
      generatedPrompts.push({
        id: `visibility-growth-${idx}`,
        text: `What are the top companies for ${role} career growth and development?`,
        category: 'Career Growth',
        type: 'visibility'
      });
      generatedPrompts.push({
        id: `visibility-innovation-${idx}`,
        text: `Which tech companies have the most innovative work environments for ${role} roles?`,
        category: 'Innovation',
        type: 'visibility'
      });
    });

    // Visibility prompt for work-life balance (general)
    generatedPrompts.push({
      id: 'visibility-worklife',
      text: `What companies in the ${industry} sector offer the best work-life balance for technical professionals?`,
      category: 'Work-Life Balance',
      type: 'visibility'
    });

    // Competitive prompts for each target role and competitor
    targetRoles.forEach((role, rIdx) => {
      talentCompetitors.forEach((competitor, cIdx) => {
        generatedPrompts.push({
          id: `competitive-${rIdx}-${cIdx}`,
          text: `Compare career opportunities for ${role} professionals at ${companyName} and ${competitor}.`,
          category: 'Competitive Analysis',
          type: 'competitive'
        });
        generatedPrompts.push({
          id: `competitive-compensation-${rIdx}-${cIdx}`,
          text: `How do compensation and benefits for ${role} roles compare between ${companyName} and ${competitor}?`,
          category: 'Compensation',
          type: 'competitive'
        });
      });
    });

    // Company culture prompt (general)
    generatedPrompts.push({
      id: 'sentiment-culture',
      text: `What are the main advantages and challenges of ${companyName}'s company culture for technical professionals?`,
      category: 'Company Culture',
      type: 'sentiment'
    });

    setPrompts(generatedPrompts);
  };

  const confirmAndStartMonitoring = async () => {
    if (!user || !onboardingRecord) {
      toast.error('Missing user or onboarding data. Please try again.');
      return;
    }
    
    setIsConfirming(true);
    
    try {
      console.log('=== STARTING MONITORING PROCESS ===');
      console.log('Using onboarding record:', onboardingRecord.id);
      console.log('Company:', onboardingRecord.company_name);
      console.log('Competitors:', onboardingRecord.talent_competitors);

      const promptsToInsert = prompts.map(prompt => ({
        onboarding_id: onboardingRecord.id,
        user_id: user.id,
        prompt_text: prompt.text,
        prompt_category: prompt.category,
        prompt_type: prompt.type,
        is_active: true
      }));

      const { data: confirmedPrompts, error: insertError } = await supabase
        .from('confirmed_prompts')
        .insert(promptsToInsert)
        .select();

      if (insertError) {
        console.error('Failed to insert prompts:', insertError);
        throw insertError;
      }

      console.log('Confirmed prompts inserted:', confirmedPrompts?.length);

      // Calculate total operations for progress tracking
      const totalOperations = (confirmedPrompts?.length || 0) * 3; // 3 models per prompt
      setProgress({ completed: 0, total: totalOperations });

      let completedOperations = 0;

      // Test each prompt with all models
      for (const confirmedPrompt of confirmedPrompts || []) {
        console.log('=== TESTING PROMPT ===');
        console.log('Prompt:', confirmedPrompt.prompt_text);
        console.log('Type:', confirmedPrompt.prompt_type);
        
        // Test with OpenAI
        setProgress(prev => ({ 
          ...prev, 
          currentModel: 'OpenAI GPT-4o-mini',
          currentPrompt: confirmedPrompt.prompt_text
        }));
        await testWithModel(confirmedPrompt, 'test-prompt-openai', 'gpt-4o-mini');
        completedOperations++;
        setProgress(prev => ({ ...prev, completed: completedOperations }));
        
        // Test with Claude
        setProgress(prev => ({ 
          ...prev, 
          currentModel: 'Claude 3 Sonnet',
          currentPrompt: confirmedPrompt.prompt_text
        }));
        await testWithModel(confirmedPrompt, 'test-prompt-claude', 'claude-3-sonnet');
        completedOperations++;
        setProgress(prev => ({ ...prev, completed: completedOperations }));
        
        // Test with Perplexity
        setProgress(prev => ({ 
          ...prev, 
          currentModel: 'Perplexity Llama 3.1',
          currentPrompt: confirmedPrompt.prompt_text
        }));
        await testWithModel(confirmedPrompt, 'test-prompt-perplexity', 'llama-3.1-sonar-small-128k-online');
        completedOperations++;
        setProgress(prev => ({ ...prev, completed: completedOperations }));
      }

      console.log('All prompts tested, navigating to dashboard...');
      toast.success('Prompts confirmed and monitoring started!');
      
      // Wait a moment for the user to see completion, then navigate
      setTimeout(() => {
        navigate('/auth', {
          state: {
            onboardingData,
            redirectTo: '/dashboard',
            loadingPrompts: true
          }
        });
      }, 1500);

    } catch (error) {
      console.error('Error confirming prompts:', error);
      toast.error('Failed to confirm prompts. Please try again.');
    } finally {
      setIsConfirming(false);
    }
  };

  const testWithModel = async (confirmedPrompt: any, functionName: string, modelName: string) => {
    try {
      console.log(`=== CALLING ${functionName.toUpperCase()} ===`);
      console.log('Prompt:', confirmedPrompt.prompt_text);
      
      const { data: responseData, error: functionError } = await supabase.functions
        .invoke(functionName, {
          body: { prompt: confirmedPrompt.prompt_text }
        });

      if (functionError) {
        console.error(`${functionName} edge function error:`, functionError);
      } else if (responseData?.response) {
        console.log(`${functionName} response received, analyzing...`);
        
        // Handle citations from Perplexity responses
        const perplexityCitations = functionName === 'test-prompt-perplexity' ? responseData.citations : null;
        
        console.log('=== CALLING ANALYZE-RESPONSE ===');
        console.log('Company Name:', onboardingData?.companyName);
        console.log('Prompt Type:', confirmedPrompt.prompt_type);
        console.log('Competitors:', onboardingData?.talentCompetitors);
        
        // Analyze sentiment and extract citations with enhanced visibility support
        const { data: sentimentData, error: sentimentError } = await supabase.functions
          .invoke('analyze-response', {
            body: { 
              response: responseData.response,
              companyName: onboardingData?.companyName,
              promptType: confirmedPrompt.prompt_type,
              competitors: onboardingData?.talentCompetitors || [],
              perplexityCitations: perplexityCitations
            }
          });

        if (sentimentError) {
          console.error('Sentiment analysis error:', sentimentError);
        }

        console.log('=== ANALYSIS COMPLETE ===');
        console.log('Sentiment data:', sentimentData);

        // Combine Perplexity citations with analyzed citations
        let finalCitations = sentimentData?.citations || [];
        if (perplexityCitations && perplexityCitations.length > 0) {
          finalCitations = [...perplexityCitations, ...finalCitations];
        }

        // Store the response with enhanced analysis
        const { error: storeError } = await supabase
          .from('prompt_responses')
          .insert({
            confirmed_prompt_id: confirmedPrompt.id,
            ai_model: modelName,
            response_text: responseData.response,
            sentiment_score: sentimentData?.sentiment_score || 0,
            sentiment_label: sentimentData?.sentiment_label || 'neutral',
            citations: finalCitations,
            company_mentioned: sentimentData?.company_mentioned || false,
            mention_ranking: sentimentData?.mention_ranking || null,
            competitor_mentions: sentimentData?.competitor_mentions || []
          });

        if (storeError) {
          console.error(`Error storing ${functionName} response:`, storeError);
        } else {
          console.log(`${functionName} response stored successfully`);
          console.log('Stored data - Company mentioned:', sentimentData?.company_mentioned);
          console.log('Stored data - Mention ranking:', sentimentData?.mention_ranking);
          console.log('Stored data - Competitor mentions:', sentimentData?.competitor_mentions?.length);
        }
      }
    } catch (error) {
      console.error(`Error testing with ${functionName}:`, error);
    }
  };

  return {
    prompts,
    isConfirming,
    onboardingRecord,
    error,
    progress,
    confirmAndStartMonitoring
  };
};

// New utility function to generate and insert prompts
export const generateAndInsertPrompts = async (user: any, onboardingRecord: any, onboardingData: OnboardingData, setProgress: (progress: ProgressInfo) => void) => {
  if (!user || !onboardingRecord) {
    throw new Error('Missing user or onboarding data');
  }
  
  console.log('=== STARTING MONITORING PROCESS ===');
  console.log('Using onboarding record:', onboardingRecord.id);
  console.log('Company:', onboardingRecord.company_name);
  console.log('Competitors:', onboardingRecord.talent_competitors);

  // Generate prompts based on onboarding data
  const promptsToInsert = generatePromptsFromData(onboardingData).map(prompt => ({
    onboarding_id: onboardingRecord.id,
    user_id: user.id,
    prompt_text: prompt.text,
    prompt_category: prompt.category,
    prompt_type: prompt.type,
    is_active: true
  }));

  const { data: confirmedPrompts, error: insertError } = await supabase
    .from('confirmed_prompts')
    .insert(promptsToInsert)
    .select();

  if (insertError) {
    console.error('Failed to insert prompts:', insertError);
    throw insertError;
  }

  console.log('Confirmed prompts inserted:', confirmedPrompts?.length);

  // Calculate total operations for progress tracking
  const totalOperations = (confirmedPrompts?.length || 0) * 3; // 3 models per prompt
  setProgress({ completed: 0, total: totalOperations });

  let completedOperations = 0;

  // Define testWithModel inside this function to avoid scope issues
  const testWithModel = async (confirmedPrompt: any, functionName: string, modelName: string) => {
    try {
      console.log(`=== CALLING ${functionName.toUpperCase()} ===`);
      console.log('Prompt:', confirmedPrompt.prompt_text);
      
      const { data: responseData, error: functionError } = await supabase.functions
        .invoke(functionName, {
          body: { prompt: confirmedPrompt.prompt_text }
        });

      if (functionError) {
        console.error(`${functionName} edge function error:`, functionError);
      } else if (responseData?.response) {
        console.log(`${functionName} response received, analyzing...`);
        
        // Handle citations from Perplexity responses
        const perplexityCitations = functionName === 'test-prompt-perplexity' ? responseData.citations : null;
        
        console.log('=== CALLING ANALYZE-RESPONSE ===');
        console.log('Company Name:', onboardingData?.companyName);
        console.log('Prompt Type:', confirmedPrompt.prompt_type);
        console.log('Competitors:', onboardingData?.talentCompetitors);
        
        // Analyze sentiment and extract citations with enhanced visibility support
        const { data: sentimentData, error: sentimentError } = await supabase.functions
          .invoke('analyze-response', {
            body: { 
              response: responseData.response,
              companyName: onboardingData?.companyName,
              promptType: confirmedPrompt.prompt_type,
              competitors: onboardingData?.talentCompetitors || [],
              perplexityCitations: perplexityCitations
            }
          });

        if (sentimentError) {
          console.error('Sentiment analysis error:', sentimentError);
        }

        console.log('=== ANALYSIS COMPLETE ===');
        console.log('Sentiment data:', sentimentData);

        // Combine Perplexity citations with analyzed citations
        let finalCitations = sentimentData?.citations || [];
        if (perplexityCitations && perplexityCitations.length > 0) {
          finalCitations = [...perplexityCitations, ...finalCitations];
        }
      }
    } catch (error) {
      console.error(`Error testing with ${modelName}:`, error);
    }
  };

  // Test each prompt with all models
  for (const confirmedPrompt of confirmedPrompts || []) {
    console.log('=== TESTING PROMPT ===');
    console.log('Prompt:', confirmedPrompt.prompt_text);
    console.log('Type:', confirmedPrompt.prompt_type);
    
    // Test with OpenAI
    setProgress({ 
      currentModel: 'OpenAI GPT-4o-mini',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    await testWithModel(confirmedPrompt, 'test-prompt-openai', 'gpt-4o-mini');
    completedOperations++;
    setProgress({ 
      currentModel: 'OpenAI GPT-4o-mini',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    
    // Test with Claude
    setProgress({ 
      currentModel: 'Claude 3 Sonnet',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    await testWithModel(confirmedPrompt, 'test-prompt-claude', 'claude-3-sonnet');
    completedOperations++;
    setProgress({ 
      currentModel: 'Claude 3 Sonnet',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    
    // Test with Perplexity
    setProgress({ 
      currentModel: 'Perplexity Llama 3.1',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    await testWithModel(confirmedPrompt, 'test-prompt-perplexity', 'llama-3.1-sonar-small-128k-online');
    completedOperations++;
    setProgress({ 
      currentModel: 'Perplexity Llama 3.1',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
  }

  console.log('All prompts tested.');
  return confirmedPrompts;
};

// Helper function to generate prompts from onboarding data
const generatePromptsFromData = (onboardingData: OnboardingData): GeneratedPrompt[] => {
  const { companyName, industry, targetRoles, talentCompetitors, hiringChallenges } = onboardingData;
  let generatedPrompts: GeneratedPrompt[] = [];

  // Sentiment prompts for each target role
  targetRoles.forEach((role, idx) => {
    generatedPrompts.push({
      id: `sentiment-role-${idx}`,
      text: `What are the pros and cons of working as a ${role} at ${companyName} compared to other ${industry} companies?`,
      category: 'Work Environment',
      type: 'sentiment'
    });
    generatedPrompts.push({
      id: `sentiment-career-${idx}`,
      text: `How does ${companyName}'s approach to ${role} career development compare to industry standards?`,
      category: 'Career Development',
      type: 'sentiment'
    });
  });

  // Sentiment prompts for each hiring challenge
  hiringChallenges.forEach((challenge, idx) => {
    generatedPrompts.push({
      id: `sentiment-challenge-${idx}`,
      text: `How does ${companyName} address the challenge of ${challenge}?`,
      category: 'Hiring Challenge',
      type: 'sentiment'
    });
  });

  // Visibility prompts for each target role
  targetRoles.forEach((role, idx) => {
    generatedPrompts.push({
      id: `visibility-role-${idx}`,
      text: `Which ${industry} companies offer the best career opportunities for ${role} professionals?`,
      category: 'Industry Leaders',
      type: 'visibility'
    });
    generatedPrompts.push({
      id: `visibility-growth-${idx}`,
      text: `What are the top companies for ${role} career growth and development?`,
      category: 'Career Growth',
      type: 'visibility'
    });
    generatedPrompts.push({
      id: `visibility-innovation-${idx}`,
      text: `Which tech companies have the most innovative work environments for ${role} roles?`,
      category: 'Innovation',
      type: 'visibility'
    });
  });

  // Visibility prompt for work-life balance (general)
  generatedPrompts.push({
    id: 'visibility-worklife',
    text: `What companies in the ${industry} sector offer the best work-life balance for technical professionals?`,
    category: 'Work-Life Balance',
    type: 'visibility'
  });

  // Competitive prompts for each target role and competitor
  targetRoles.forEach((role, rIdx) => {
    talentCompetitors.forEach((competitor, cIdx) => {
      generatedPrompts.push({
        id: `competitive-${rIdx}-${cIdx}`,
        text: `Compare career opportunities for ${role} professionals at ${companyName} and ${competitor}.`,
        category: 'Competitive Analysis',
        type: 'competitive'
      });
      generatedPrompts.push({
        id: `competitive-compensation-${rIdx}-${cIdx}`,
        text: `How do compensation and benefits for ${role} roles compare between ${companyName} and ${competitor}?`,
        category: 'Compensation',
        type: 'competitive'
      });
    });
  });

  // Company culture prompt (general)
  generatedPrompts.push({
    id: 'sentiment-culture',
    text: `What are the main advantages and challenges of ${companyName}'s company culture for technical professionals?`,
    category: 'Company Culture',
    type: 'sentiment'
  });

  return generatedPrompts;
};
