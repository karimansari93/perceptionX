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

      return { success: true, data };
    }
  } catch (error) {
    console.error('Exception in safeStorePromptResponse:', error);
    return { success: false, error };
  }
}
