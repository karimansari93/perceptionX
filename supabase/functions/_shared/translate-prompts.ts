/**
 * Translate prompts to the target language based on country code
 */

// Map country codes to language names for translation
const COUNTRY_TO_LANGUAGE_NAME: Record<string, string> = {
  'US': 'English',
  'GB': 'English',
  'CA': 'English',
  'AU': 'English',
  'NZ': 'English',
  'IE': 'English',
  'ZA': 'English',
  'DE': 'German',
  'AT': 'German',
  'CH': 'German',
  'FR': 'French',
  'BE': 'French', // Defaulting to French for Belgium
  'IT': 'Italian',
  'ES': 'Spanish',
  'PT': 'Portuguese',
  'BR': 'Portuguese',
  'NL': 'Dutch',
  'PL': 'Polish',
  'CZ': 'Czech',
  'HU': 'Hungarian',
  'RO': 'Romanian',
  'BG': 'Bulgarian',
  'HR': 'Croatian',
  'SK': 'Slovak',
  'SI': 'Slovenian',
  'LT': 'Lithuanian',
  'LV': 'Latvian',
  'EE': 'Estonian',
  'FI': 'Finnish',
  'SE': 'Swedish',
  'NO': 'Norwegian',
  'DK': 'Danish',
  'GR': 'Greek',
  'JP': 'Japanese',
  'CN': 'Chinese (Simplified)',
  'KR': 'Korean',
  'IN': 'English', // English is common
  'SG': 'English', // English is common
  'MY': 'English', // English is common
  'TH': 'Thai',
  'PH': 'English', // English is common
  'ID': 'Indonesian',
  'VN': 'Vietnamese',
  'TW': 'Chinese (Traditional)',
  'HK': 'English', // English is common
  'MX': 'Spanish',
  'AR': 'Spanish',
  'CL': 'Spanish',
  'CO': 'Spanish',
  'PE': 'Spanish',
  'AE': 'Arabic',
  'SA': 'Arabic',
  'IL': 'Hebrew',
  'TR': 'Turkish',
  'RU': 'Russian',
  'GLOBAL': 'English',
};

/**
 * Get language name for a country code
 */
export function getLanguageName(countryCode: string | null | undefined): string {
  const code = (countryCode || 'GLOBAL').toUpperCase();
  return COUNTRY_TO_LANGUAGE_NAME[code] || 'English';
}

/**
 * Translate a prompt to the target language using OpenAI
 */
export async function translatePrompt(
  prompt: string,
  targetLanguage: string,
  openaiApiKey: string | null
): Promise<string> {
  // If no API key or target is English, return original
  if (!openaiApiKey || targetLanguage === 'English' || !targetLanguage) {
    return prompt;
  }

  try {
    const translationPrompt = `Translate the following question/prompt to ${targetLanguage}. 
Preserve the meaning, tone, and structure. Keep company names, industry names, and proper nouns unchanged.
Only translate the question structure and common words.

Original prompt: "${prompt}"

Translated prompt:`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Using mini for cost efficiency
        messages: [
          {
            role: 'user',
            content: translationPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 200
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`⚠️ Translation failed: ${response.status} - ${errorText}`);
      return prompt; // Return original on error
    }

    const data = await response.json();
    const translated = data.choices[0]?.message?.content?.trim();

    if (translated && translated.length > 0) {
      // Clean up any quotes that might wrap the translation
      const cleaned = translated.replace(/^["']|["']$/g, '');
      console.log(`✅ Translated: "${prompt}" → "${cleaned}" (${targetLanguage})`);
      return cleaned;
    }

    return prompt; // Return original if translation failed
  } catch (error) {
    console.warn(`⚠️ Translation error: ${error.message}`);
    return prompt; // Return original on error
  }
}

/**
 * Translate multiple prompts in batch
 */
export async function translatePrompts(
  prompts: string[],
  targetLanguage: string,
  openaiApiKey: string | null
): Promise<string[]> {
  // If no API key or target is English, return originals
  if (!openaiApiKey || targetLanguage === 'English' || !targetLanguage) {
    return prompts;
  }

  // Translate all prompts
  const translatedPrompts = await Promise.all(
    prompts.map(prompt => translatePrompt(prompt, targetLanguage, openaiApiKey))
  );

  return translatedPrompts;
}

