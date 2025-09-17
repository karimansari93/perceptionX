# AI-Powered Thematic Analysis

This document describes the new AI-powered thematic analysis feature that uses OpenAI to analyze individual responses and extract meaningful themes about company employer branding.

## Overview

The AI thematic analysis system provides sophisticated theme extraction that goes beyond the current keyword-based approach. It uses OpenAI's GPT-4 to:

- Identify specific themes in responses about companies
- Determine sentiment (positive, negative, neutral) for each theme
- Map themes to TalentX attributes
- Extract relevant keywords and context snippets
- Provide confidence scores for each theme

## Architecture

### Database Schema

**New Table: `ai_themes`**
- Stores AI-analyzed themes for each response
- Links to `prompt_responses` table
- Maps themes to TalentX attributes
- Includes sentiment analysis and confidence scores

**New View: `theme_analysis_summary`**
- Aggregates theme data for easy querying
- Provides summary statistics per response

### Edge Function

**`ai-thematic-analysis`**
- Uses OpenAI GPT-4 to analyze response text
- Extracts themes with sentiment and TalentX mapping
- Stores results in the `ai_themes` table
- Prevents duplicate analysis of the same response

## Files Created

### Database Migration
- `supabase/migrations/20250103000014_create_ai_themes_table.sql`
  - Creates `ai_themes` table
  - Creates `theme_analysis_summary` view
  - Adds necessary indexes and triggers

### Edge Function
- `supabase/functions/ai-thematic-analysis/index.ts`
  - Main edge function for theme analysis
  - OpenAI integration
  - Database storage logic

### Scripts
- `scripts/run-ai-thematic-analysis.js`
  - Manual execution script for existing responses
  - Supports filtering by company, AI model, etc.
  - Includes dry-run mode

- `scripts/test-ai-thematic-analysis.js`
  - Test script to verify edge function works
  - Uses sample response data

## Usage

### 1. Deploy the Edge Function

```bash
# Deploy the edge function
supabase functions deploy ai-thematic-analysis

# Apply the database migration
supabase db push
```

### 2. Set Environment Variables

Ensure you have the OpenAI API key set in your Supabase project:

```bash
supabase secrets set OPENAI_API_KEY=your_openai_api_key_here
```

### 3. Test the Function

```bash
# Test with sample data
node scripts/test-ai-thematic-analysis.js
```

### 4. Run Analysis on Existing Responses

```bash
# Analyze all responses (limit 10)
node scripts/run-ai-thematic-analysis.js

# Analyze specific company
node scripts/run-ai-thematic-analysis.js --company-name "Google" --limit 5

# Analyze specific AI model
node scripts/run-ai-thematic-analysis.js --ai-model "gpt-4" --limit 10

# Dry run to see what would be analyzed
node scripts/run-ai-thematic-analysis.js --dry-run

# Force re-analysis of responses that already have themes
node scripts/run-ai-thematic-analysis.js --force --limit 20
```

## API Usage

### Call the Edge Function Directly

```javascript
const { data, error } = await supabase.functions.invoke('ai-thematic-analysis', {
  body: {
    response_id: 'uuid-of-response',
    company_name: 'Company Name',
    response_text: 'The response text to analyze...',
    ai_model: 'gpt-4'
  }
});
```

### Query Analyzed Themes

```sql
-- Get all themes for a specific response
SELECT * FROM ai_themes WHERE response_id = 'response-uuid';

-- Get theme summary for a company
SELECT * FROM theme_analysis_summary 
WHERE confirmed_prompts.user_onboarding.company_name = 'Google';

-- Get positive themes only
SELECT * FROM ai_themes WHERE sentiment = 'positive';

-- Get themes by TalentX attribute
SELECT * FROM ai_themes WHERE talentx_attribute_id = 'company-culture';
```

## Theme Structure

Each theme includes:

```typescript
{
  theme_name: string;           // Clear, concise theme name
  theme_description: string;    // Brief description
  sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_score: number;      // -1 to 1
  talentx_attribute_id: string; // Maps to TalentX attribute
  talentx_attribute_name: string;
  confidence_score: number;     // 0 to 1
  keywords: string[];           // Relevant keywords
  context_snippets: string[];   // Supporting text snippets
}
```

## TalentX Attribute Mapping

Themes are automatically mapped to these TalentX attributes:

- **mission-purpose**: Mission & Purpose
- **rewards-recognition**: Rewards & Recognition
- **company-culture**: Company Culture
- **social-impact**: Social Impact
- **inclusion**: Inclusion
- **innovation**: Innovation
- **wellbeing-balance**: Wellbeing & Balance
- **leadership**: Leadership
- **security-perks**: Security & Perks
- **career-opportunities**: Career Opportunities

## Benefits Over Current Approach

1. **More Sophisticated Analysis**: Uses AI to understand context and nuance
2. **Better Theme Identification**: Identifies themes that keyword matching might miss
3. **Accurate Sentiment Analysis**: AI understands sentiment better than keyword counting
4. **Automatic TalentX Mapping**: Intelligently maps themes to relevant attributes
5. **Context Preservation**: Extracts supporting snippets for each theme
6. **Confidence Scoring**: Provides confidence levels for each analysis

## Cost Considerations

- Uses OpenAI GPT-4o-mini for cost efficiency
- Processes one response at a time to avoid rate limits
- Includes 1-second delay between requests in batch processing
- Skips responses that already have themes (unless --force is used)

## Future Enhancements

1. **Batch Processing**: Process multiple responses in a single API call
2. **Theme Clustering**: Group similar themes across responses
3. **Trend Analysis**: Track theme changes over time
4. **Custom Attributes**: Allow custom TalentX attributes
5. **Multi-language Support**: Analyze responses in different languages
6. **Confidence Filtering**: Filter out low-confidence themes in UI

## Troubleshooting

### Common Issues

1. **Missing OpenAI API Key**: Ensure `OPENAI_API_KEY` is set in Supabase secrets
2. **Rate Limiting**: The script includes delays, but you may need to increase them
3. **Empty Responses**: Script skips responses with empty or null text
4. **Duplicate Analysis**: Use `--force` flag to re-analyze responses with existing themes

### Debugging

1. Check Supabase function logs for errors
2. Use `--dry-run` to see what would be processed
3. Test with a single response using the test script
4. Verify database permissions and table structure

## Integration with Frontend

The analyzed themes can be integrated into the existing thematic analysis UI by:

1. Querying the `ai_themes` table instead of using the current keyword-based analysis
2. Displaying themes with their confidence scores and context snippets
3. Filtering by TalentX attributes and sentiment
4. Showing theme trends over time
5. Providing more detailed theme descriptions and supporting evidence
