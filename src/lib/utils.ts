import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Production-safe logging utility with security considerations
export const logger = {
  log: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.log(...args);
    }
  },
  error: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.error(...args);
    }
    // In production, send to error tracking service
    if (import.meta.env.PROD) {
      // TODO: Integrate with Sentry or similar service
      // captureException(error, { extra: context });
    }
  },
  warn: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.warn(...args);
    }
  },
  info: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.info(...args);
    }
  }
};

// Security utilities
export const sanitizeInput = (input: string): string => {
  // Basic XSS prevention
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validateUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if a prompt response already exists for the given prompt and AI model
 * @param supabase - Supabase client instance
 * @param confirmedPromptId - The confirmed prompt ID
 * @param aiModel - The AI model name
 * @returns Promise<boolean> - True if response exists, false otherwise
 */
export async function checkExistingPromptResponse(
  supabase: any,
  confirmedPromptId: string,
  aiModel: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('prompt_responses')
      .select('id')
      .eq('confirmed_prompt_id', confirmedPromptId)
      .eq('ai_model', aiModel)
      .maybeSingle();

    if (error) {
      console.error('Error checking existing prompt response:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('Exception checking existing prompt response:', error);
    return false;
  }
}

/**
 * Safely store or update a prompt response, preventing duplicates
 * @param supabase - Supabase client instance
 * @param responseData - The response data to store
 * @returns Promise<{success: boolean, data?: any, error?: any}>
 */
export async function safeStorePromptResponse(
  supabase: any,
  responseData: {
    confirmed_prompt_id: string;
    ai_model: string;
    response_text: string;
    sentiment_score?: number;
    sentiment_label?: string;
    citations?: any[];
    company_mentioned?: boolean;
    mention_ranking?: number | null;
    competitor_mentions?: any[];
    first_mention_position?: number | null;
    total_words?: number;
    visibility_score?: number;
    competitive_score?: number;
    detected_competitors?: string;
  }
): Promise<{success: boolean, data?: any, error?: any}> {
  try {
    // Check if response already exists
    const exists = await checkExistingPromptResponse(
      supabase,
      responseData.confirmed_prompt_id,
      responseData.ai_model
    );

    if (exists) {
      // Update existing response
      const { data, error } = await supabase
        .from('prompt_responses')
        .update(responseData)
        .eq('confirmed_prompt_id', responseData.confirmed_prompt_id)
        .eq('ai_model', responseData.ai_model)
        .select()
        .single();

      if (error) {
        console.error('Error updating existing prompt response:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } else {
      // Insert new response
      const { data, error } = await supabase
        .from('prompt_responses')
        .insert(responseData)
        .select()
        .single();

      if (error) {
        console.error('Error inserting new prompt response:', error);
        return { success: false, error };
      }

      // Trigger AI thematic analysis and recency cache for new responses during onboarding
      if (data) {
        try {
          // First, get the onboarding_id from the confirmed prompt
          const { data: promptData, error: promptError } = await supabase
            .from('confirmed_prompts')
            .select('onboarding_id')
            .eq('id', responseData.confirmed_prompt_id)
            .single();

          if (promptError) {
            console.warn('Error fetching prompt data:', promptError);
            return { success: true, data };
          }

          // Then get the company name from user_onboarding
          const { data: onboardingData, error: onboardingError } = await supabase
            .from('user_onboarding')
            .select('company_name')
            .eq('id', promptData.onboarding_id)
            .single();

          if (!onboardingError && onboardingData?.company_name) {
            // Trigger AI thematic analysis asynchronously (don't wait for completion)
            console.log(`🚀 Triggering AI thematic analysis for response ${data.id} (${responseData.ai_model})`);
            supabase.functions.invoke('ai-thematic-analysis', {
              body: {
                response_id: data.id,
                company_name: onboardingData.company_name,
                response_text: responseData.response_text,
                ai_model: responseData.ai_model
              }
            }).catch(error => {
              // Log error but don't fail the response storage
              console.warn('❌ Failed to trigger AI thematic analysis:', error);
            });

            // Trigger recency cache extraction for citations
            console.log(`🔍 Checking citations for response ${data.id}:`, {
              hasCitations: !!responseData.citations,
              isArray: Array.isArray(responseData.citations),
              length: responseData.citations?.length || 0,
              sampleCitation: responseData.citations?.[0]
            });
            
            if (responseData.citations && Array.isArray(responseData.citations) && responseData.citations.length > 0) {
              console.log(`📅 Triggering recency cache extraction for ${responseData.citations.length} citations from response ${data.id}`);
              
              // Extract URLs from citations for recency scoring
              const citationsWithUrls = responseData.citations
                .filter((citation: any) => {
                  // Filter citations that have URLs
                  if (typeof citation === 'string') {
                    return citation.startsWith('http');
                  } else if (citation && typeof citation === 'object') {
                    return citation.url && citation.url.startsWith('http');
                  }
                  return false;
                })
                .map((citation: any) => {
                  // Normalize citation format to extract URL
                  if (typeof citation === 'string') {
                    return {
                      url: citation,
                      domain: citation.replace(/^https?:\/\/(www\.)?/, '').split('/')[0],
                      title: `Source from ${citation.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}`
                    };
                  } else if (citation && typeof citation === 'object') {
                    return {
                      url: citation.url,
                      domain: citation.domain || citation.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0],
                      title: citation.title || `Source from ${citation.domain || citation.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}`,
                      sourceType: citation.sourceType || 'unknown'
                    };
                  }
                  return null;
                })
                .filter(Boolean);

              console.log(`🔗 Extracted ${citationsWithUrls.length} citations with URLs:`, citationsWithUrls.map(c => c.url));
              
              if (citationsWithUrls.length > 0) {
                // Trigger recency cache extraction asynchronously (don't wait for completion)
                console.log(`🚀 Calling extract-recency-scores edge function with ${citationsWithUrls.length} citations`);
                supabase.functions.invoke('extract-recency-scores', {
                  body: {
                    citations: citationsWithUrls,
                    user_id: data.id // Pass response ID for tracking
                  }
                }).then(response => {
                  console.log('✅ Recency cache extraction completed:', response);
                }).catch(error => {
                  // Log error but don't fail the response storage
                  console.warn('❌ Failed to trigger recency cache extraction:', error);
                });
              } else {
                console.log('⚠️ No citations with valid URLs found, skipping recency extraction');
              }
            }
          } else {
            console.warn('⚠️ Cannot trigger AI analysis: missing company name or onboarding data');
          }
        } catch (analysisError) {
          // Log error but don't fail the response storage
          console.warn('Error triggering AI analysis:', analysisError);
        }
      }

      return { success: true, data };
    }
  } catch (error) {
    console.error('Exception in safeStorePromptResponse:', error);
    return { success: false, error };
  }
}
