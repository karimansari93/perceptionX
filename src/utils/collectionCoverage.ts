// "Completed" means every active prompt has a response, in the company's
// latest collection month, from every model collected that month. The caller
// computes that per-prompt count (promptsWithFullCoverage); there is no fixed
// expected-model count, because the collected model set changes over time.

export function coverageLabel(
  promptCount: number,
  responseCount: number,
  inProgressStatus: string | null,
  /** When set, "Completed" only when every prompt is fully covered (promptsWithFullCoverage === promptCount) */
  promptsWithFullCoverage?: number
): string {
  if (inProgressStatus === 'collecting_search_insights') return 'Collecting search';
  if (inProgressStatus === 'collecting_llm_data') return 'Collecting AI';
  if (promptCount === 0) return responseCount > 0 ? 'Complete' : 'No prompts';
  const allPromptsComplete = promptsWithFullCoverage !== undefined && promptsWithFullCoverage === promptCount;
  if (allPromptsComplete) return 'Completed';
  if (promptsWithFullCoverage !== undefined) {
    return `Incomplete (${promptsWithFullCoverage}/${promptCount} prompts)`;
  }
  // Never use total response count to show "Completed" - distribution matters.
  return `Incomplete (${responseCount} responses)`;
}
