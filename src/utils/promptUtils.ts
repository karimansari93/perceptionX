/**
 * Utility functions for managing and updating prompt texts
 */

/**
 * Updates industry references in a prompt text
 * @param promptText - The original prompt text
 * @param oldIndustry - The industry to replace
 * @param newIndustry - The new industry to use
 * @returns Updated prompt text with industry references replaced
 */
export function updateIndustryInPrompt(
  promptText: string,
  oldIndustry: string,
  newIndustry: string
): string {
  if (!oldIndustry || !newIndustry || oldIndustry === newIndustry) {
    return promptText;
  }

  let updatedText = promptText;

  // Define patterns to match different industry reference formats
  const industryPatterns = [
    // Exact industry name
    new RegExp(`\\b${escapeRegExp(oldIndustry)}\\b`, 'gi'),
    // Industry with "industry" suffix
    new RegExp(`\\b${escapeRegExp(oldIndustry)} industry\\b`, 'gi'),
    // Industry with "in the" prefix
    new RegExp(`\\bin the ${escapeRegExp(oldIndustry)}\\b`, 'gi'),
  ];

  // Apply each pattern replacement
  industryPatterns.forEach(pattern => {
    if (pattern.test(updatedText)) {
      updatedText = updatedText.replace(pattern, (match) => {
        // Preserve the original case and context
        if (match.toLowerCase().includes('industry')) {
          return match.replace(new RegExp(escapeRegExp(oldIndustry), 'gi'), newIndustry);
        } else if (match.toLowerCase().startsWith('in the')) {
          return match.replace(new RegExp(escapeRegExp(oldIndustry), 'gi'), newIndustry);
        } else {
          return match.replace(new RegExp(escapeRegExp(oldIndustry), 'gi'), newIndustry);
        }
      });
    }
  });

  return updatedText;
}

/**
 * Updates company name references in a prompt text
 * @param promptText - The original prompt text
 * @param oldCompany - The company name to replace
 * @param newCompany - The new company name to use
 * @returns Updated prompt text with company references replaced
 */
export function updateCompanyInPrompt(
  promptText: string,
  oldCompany: string,
  newCompany: string
): string {
  if (!oldCompany || !newCompany || oldCompany === newCompany) {
    return promptText;
  }

  // Create a pattern to match the company name with word boundaries
  const companyPattern = new RegExp(`\\b${escapeRegExp(oldCompany)}\\b`, 'gi');
  
  return promptText.replace(companyPattern, newCompany);
}

/**
 * Updates both company and industry references in a prompt text
 * @param promptText - The original prompt text
 * @param oldCompany - The company name to replace
 * @param newCompany - The new company name to use
 * @param oldIndustry - The industry to replace
 * @param newIndustry - The new industry to use
 * @returns Updated prompt text with both company and industry references replaced
 */
export function updatePromptText(
  promptText: string,
  oldCompany: string,
  newCompany: string,
  oldIndustry: string,
  newIndustry: string
): string {
  let updatedText = promptText;
  
  // Update company references first
  updatedText = updateCompanyInPrompt(updatedText, oldCompany, newCompany);
  
  // Then update industry references
  updatedText = updateIndustryInPrompt(updatedText, oldIndustry, newIndustry);
  
  return updatedText;
}

/**
 * Escapes special regex characters in a string
 * @param string - The string to escape
 * @returns Escaped string safe for use in RegExp
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validates if a prompt text update would result in meaningful changes
 * @param originalText - The original prompt text
 * @param updatedText - The updated prompt text
 * @returns True if the update is meaningful, false otherwise
 */
export function isValidPromptUpdate(originalText: string, updatedText: string): boolean {
  // Check if texts are different
  if (originalText === updatedText) {
    return false;
  }
  
  // Check if the update is not just whitespace changes
  if (originalText.trim().replace(/\s+/g, ' ') === updatedText.trim().replace(/\s+/g, ' ')) {
    return false;
  }
  
  // Ensure the updated text is not empty
  if (!updatedText.trim()) {
    return false;
  }
  
  return true;
}
