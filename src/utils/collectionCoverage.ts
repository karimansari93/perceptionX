/**
 * Expected number of AI models per prompt (one response from each model).
 * "Completed" = every prompt has 5 responses (openai, perplexity, gemini, deepseek, google-ai-overviews).
 */
export const EXPECTED_MODELS_PER_PROMPT = 5;

export function isCoverageComplete(promptCount: number, responseCount: number): boolean {
  if (promptCount === 0) return true;
  const expected = promptCount * EXPECTED_MODELS_PER_PROMPT;
  return responseCount >= expected;
}

export function coverageLabel(
  promptCount: number,
  responseCount: number,
  inProgressStatus: string | null,
  /** When set, "Completed" only when every prompt has >= 5 responses (promptsWithFullCoverage === promptCount) */
  promptsWithFullCoverage?: number
): string {
  if (inProgressStatus === 'collecting_search_insights') return 'Collecting search';
  if (inProgressStatus === 'collecting_llm_data') return 'Collecting AI';
  if (promptCount === 0) return responseCount > 0 ? 'Complete' : 'No prompts';
  const expected = promptCount * EXPECTED_MODELS_PER_PROMPT;
  const allPromptsComplete = promptsWithFullCoverage !== undefined && promptsWithFullCoverage === promptCount;
  if (allPromptsComplete) return 'Completed';
  if (promptsWithFullCoverage !== undefined) {
    return `Incomplete (${promptsWithFullCoverage}/${promptCount} prompts)`;
  }
  // Never use total response count to show "Completed" - distribution matters.
  // Without per-prompt data we cannot confirm every prompt has 5 model responses.
  return `Incomplete (${responseCount}/${expected})`;
}
