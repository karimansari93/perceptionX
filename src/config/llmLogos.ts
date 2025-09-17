import { getFavicon } from '@/utils/citationUtils';

// Domain mapping for LLM models to their company domains
export const LLM_DOMAINS = {
  'openai': 'openai.com',
  'gpt-4': 'openai.com',
  'gpt-4o': 'openai.com',
  'gpt-4o-mini': 'openai.com',
  'gpt-3.5-turbo': 'openai.com',
  'gemini': 'gemini.google.com',
  'gemini-pro': 'gemini.google.com',
  'gemini-1.5': 'gemini.google.com',
  'deepseek': 'deepseek.com',
  'deepseek-chat': 'deepseek.com',
  'deepseek-coder': 'deepseek.com',
  'deepseek-llm': 'deepseek.com',
  'grok': 'grok.com',
  'grok-1': 'grok.com',
  'meta': 'meta.ai',
  'llama': 'meta.ai',
  'llama-2': 'meta.ai',
  'llama-3': 'meta.ai',
  'perplexity': 'perplexity.ai',
  'pplx': 'perplexity.ai',
  'llama-3.1-sonar-small-128k-online': 'perplexity.ai',
  'llama-3.1-sonar-large-128k-online': 'perplexity.ai',
  'llama-3.1-sonar-huge-128k-online': 'perplexity.ai',
  'google-ai-overviews': 'google.com',
  'ai-overviews': 'google.com',
  'claude': 'anthropic.com',
  'claude-3': 'anthropic.com',
  'claude-3-opus': 'anthropic.com',
  'claude-3-sonnet': 'anthropic.com',
  'claude-3-haiku': 'anthropic.com',
} as const;

export type LLMModel = keyof typeof LLM_DOMAINS;

export const getLLMLogo = (modelName: string): string | null => {
  const normalizedModel = modelName.toLowerCase().trim();
  
  // Direct match
  if (LLM_DOMAINS[normalizedModel as LLMModel]) {
    return getFavicon(LLM_DOMAINS[normalizedModel as LLMModel]);
  }
  
  // Partial match for complex model names
  for (const [key, domain] of Object.entries(LLM_DOMAINS)) {
    if (normalizedModel.includes(key) || key.includes(normalizedModel)) {
      return getFavicon(domain);
    }
  }
  
  return null;
};

export const LLM_DISPLAY_NAMES = {
  'openai': 'OpenAI',
  'gpt-4': 'OpenAI',
  'gpt-4o': 'OpenAI',
  'gpt-4o-mini': 'OpenAI',
  'gpt-3.5-turbo': 'OpenAI',
  'gpt-4.1-nano': 'OpenAI',
  'gemini': 'Gemini',
  'gemini-pro': 'Gemini',
  'gemini-1.5': 'Gemini',
  'gemini-1.5-flash': 'Gemini',
  'deepseek': 'DeepSeek',
  'deepseek-chat': 'DeepSeek',
  'deepseek-coder': 'DeepSeek',
  'deepseek-llm': 'DeepSeek',
  'grok': 'Grok',
  'grok-1': 'Grok',
  'meta': 'Meta',
  'llama': 'Meta',
  'llama-2': 'Meta',
  'llama-3': 'Meta',
  'perplexity': 'Perplexity',
  'pplx': 'Perplexity',
  'llama-3.1-sonar-small-128k-online': 'Perplexity',
  'llama-3.1-sonar-large-128k-online': 'Perplexity',
  'google-ai-overviews': 'Google AI Overviews',
  'ai-overviews': 'Google AI Overviews',
  'claude': 'Claude',
  'claude-3': 'Claude',
  'claude-3-opus': 'Claude',
  'claude-3-sonnet': 'Claude',
  'claude-3-haiku': 'Claude',
};

export function getLLMDisplayName(modelName: string): string {
  const normalized = modelName?.toLowerCase().trim();
  return LLM_DISPLAY_NAMES[normalized] || modelName;
}
