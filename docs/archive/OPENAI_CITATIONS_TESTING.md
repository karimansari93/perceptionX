# OpenAI GPT-5.2 Citations Testing Guide

## Overview

We've updated the OpenAI integration to use GPT-5.2 with automatic citations via the Responses API. The implementation includes:

1. **Primary**: Responses API with `web_search` tool (automatic citations)
2. **Fallback**: Chat Completions API with enhanced prompting (extracted citations)

## What Changed

### Files Updated

1. **`supabase/functions/test-prompt-openai/index.ts`**
   - Now uses GPT-5.2 (`gpt-5.2-chat-latest`)
   - Tries Responses API first for automatic citations
   - Falls back to Chat Completions with enhanced prompting
   - Returns citations in response: `{ response, citations }`

2. **`supabase/functions/collect-industry-visibility/index.ts`**
   - Updated OpenAI calls to use GPT-5.2
   - Includes citation extraction

## Testing Methods

### Method 1: Node.js Test Script (Recommended)

```bash
# Basic test with default prompt
node scripts/test-openai-citations.js

# Test with custom prompt
node scripts/test-openai-citations.js --prompt "What companies in Healthcare are known for innovation?"

# Verbose output (shows full response data)
node scripts/test-openai-citations.js --verbose

# Help
node scripts/test-openai-citations.js --help
```

**Expected Output:**
```
🧪 Testing OpenAI GPT-5.2 Citations

📝 Prompt: What companies in Technology are known for...

⏳ Calling test-prompt-openai edge function...

✅ Response received!

📄 RESPONSE TEXT:
[Response content here]

🔗 CITATIONS (3 found):
[1] Source from glassdoor.com
    Domain: glassdoor.com
    URL: https://glassdoor.com/...

📊 SUMMARY:
Response length: 450 characters
Citations found: 3
Citations with URLs: 3
Citations without URLs: 0
```

### Method 2: Direct Edge Function Call (cURL)

```bash
# Replace YOUR_SUPABASE_URL and YOUR_ANON_KEY
curl -X POST \
  https://YOUR_SUPABASE_URL/functions/v1/test-prompt-openai \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What companies in Technology are known for having a strong, purpose-driven employer brand?"
  }'
```

**Expected Response:**
```json
{
  "response": "Several technology companies are known for...",
  "citations": [
    {
      "url": "https://glassdoor.com/...",
      "domain": "glassdoor.com",
      "title": "Source from glassdoor.com"
    },
    {
      "url": "https://linkedin.com/...",
      "domain": "linkedin.com",
      "title": "Source from linkedin.com"
    }
  ]
}
```

### Method 3: Test via Frontend

1. Go to your dashboard
2. Navigate to Prompts tab
3. Click "Test Prompt" for any prompt
4. Select "ChatGPT" model
5. Check the response - citations should appear in the Sources section

### Method 4: Direct API Test (Postman/Insomnia)

**Endpoint:** `POST /functions/v1/test-prompt-openai`

**Headers:**
```
Authorization: Bearer YOUR_ANON_KEY
Content-Type: application/json
```

**Body:**
```json
{
  "prompt": "What companies in Technology are known for innovation?"
}
```

## Verification Checklist

After testing, verify:

- [ ] Response text is returned correctly
- [ ] Citations array is present in response
- [ ] Citations include URLs when available
- [ ] Citations include domain names
- [ ] Citations include titles/descriptions
- [ ] Fallback works if Responses API fails
- [ ] No errors in edge function logs

## Troubleshooting

### No Citations Returned

**Possible Causes:**
1. Responses API not available (check OpenAI API access)
2. Model didn't include citations in response
3. Citation extraction regex needs adjustment

**Solutions:**
- Check edge function logs: `supabase functions logs test-prompt-openai`
- Try verbose mode: `node scripts/test-openai-citations.js --verbose`
- Verify OpenAI API key has access to GPT-5.2

### Responses API Errors

If you see errors about Responses API:
- The fallback to Chat Completions should activate automatically
- Check OpenAI API documentation for Responses API availability
- Verify your OpenAI account has access to GPT-5.2

### Citation Format Issues

If citations are returned but in wrong format:
- Check the citation extraction logic in `extractCitationsFromResponse()`
- Verify citation structure matches expected format
- Update extraction regex patterns if needed

## Model Variants

You can switch between GPT-5.2 variants by updating the model name:

- `gpt-5.2-chat-latest` - Fastest, cost-effective (default)
- `gpt-5.2` - Better reasoning, same cost
- `gpt-5.2-pro` - Highest quality, more expensive

## Cost Considerations

GPT-5.2 pricing (as of Dec 2025):
- **Instant/Thinking**: $1.75/$14 per 1M tokens
- **Pro**: $21/$168 per 1M tokens

The Responses API may use slightly more tokens due to web search, but provides automatic citations.

## Next Steps

1. Run the test script to verify citations are working
2. Test with real prompts from your application
3. Monitor edge function logs for any issues
4. Adjust citation extraction if needed
5. Update other OpenAI calls if desired

## Support

If you encounter issues:
1. Check edge function logs
2. Verify OpenAI API key and access
3. Test with the provided script
4. Review citation extraction logic
