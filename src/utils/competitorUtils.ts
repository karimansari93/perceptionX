/**
 * Utility functions for competitor filtering and validation
 */

// Excluded competitors that are not actual companies
const EXCLUDED_COMPETITORS = new Set([
  'glassdoor', 'indeed', 'ambitionbox', 'workday', 'linkedin', 'monster', 
  'careerbuilder', 'ziprecruiter', 'dice', 'angelist', 'wellfound', 
  'builtin', 'stackoverflow', 'github'
]);

// Excluded words that are not company names
const EXCLUDED_WORDS = new Set([
  'none', 'n/a', 'na', 'null', 'undefined', 'n/a', 'n/a.', 'n/a,', 'n/a:', 'n/a;',
  'none.', 'none,', 'none:', 'none;', 'none)', 'none]', 'none}', 'none-', 'none_',
  'n/a)', 'n/a]', 'n/a}', 'n/a-', 'n/a_', 'na.', 'na,', 'na:', 'na;', 'na)', 'na]', 'na}', 'na-', 'na_',
  'null.', 'null,', 'null:', 'null;', 'null)', 'null]', 'null}', 'null-', 'null_',
  'undefined.', 'undefined,', 'undefined:', 'undefined;', 'undefined)', 'undefined]', 'undefined}', 'undefined-', 'undefined_',
]);

// Patterns to exclude invalid competitor names
const EXCLUDED_PATTERNS = [
  /^none$/i,
  /^n\/a$/i,
  /^na$/i,
  /^null$/i,
  /^undefined$/i,
  /^none\.?$/i,
  /^n\/a\.?$/i,
  /^na\.?$/i,
  /^null\.?$/i,
  /^undefined\.?$/i,
  /^none[,:;\)\]\}\-_]$/i,
  /^n\/a[,:;\)\]\}\-_]$/i,
  /^na[,:;\)\]\}\-_]$/i,
  /^null[,:;\)\]\}\-_]$/i,
  /^undefined[,:;\)\]\}\-_]$/i,
  /^[0-9]+$/i, // Pure numbers
  /^[^a-zA-Z0-9]+$/i, // Only special characters
  /^[a-z]{1,2}$/i, // Single or double letter words (likely abbreviations that aren't company names)
];

/**
 * Validates if a competitor name should be included
 * @param competitorName - The competitor name to validate
 * @param companyName - The current company name to exclude
 * @returns true if the competitor should be included, false otherwise
 */
export function isValidCompetitor(competitorName: string, companyName: string): boolean {
  if (!competitorName || !companyName) return false;
  
  const name = competitorName.trim();
  
  // Basic validation
  if (name.length <= 1) return false;
  if (name.toLowerCase() === companyName.toLowerCase()) return false;
  
  // Check excluded competitors
  if (EXCLUDED_COMPETITORS.has(name.toLowerCase())) return false;
  
  // Check excluded words
  if (EXCLUDED_WORDS.has(name.toLowerCase())) return false;
  
  // Check excluded patterns
  if (EXCLUDED_PATTERNS.some(pattern => pattern.test(name))) return false;
  
  return true;
}

/**
 * Parses and filters competitor mentions from a string
 * @param competitorsString - Comma-separated string of competitors
 * @param companyName - The current company name to exclude
 * @returns Array of valid competitor names
 */
export function parseCompetitors(competitorsString: string, companyName: string): string[] {
  if (!competitorsString || !competitorsString.trim()) return [];
  
  return competitorsString
    .split(',')
    .map(comp => comp.trim())
    .filter(comp => comp.length > 0)
    .filter(comp => isValidCompetitor(comp, companyName));
}


