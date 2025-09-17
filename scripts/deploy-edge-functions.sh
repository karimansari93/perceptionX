#!/bin/bash

# Deploy Edge Functions to Supabase
echo "Deploying Edge Functions to Supabase..."

# Navigate to the supabase functions directory
cd supabase/functions

# Deploy the test-prompt-gemini function
echo "Deploying test-prompt-gemini function..."
supabase functions deploy test-prompt-gemini --project-ref ofyjvfmcgtntwamkubui

# Deploy other functions if needed
echo "Deploying analyze-response function..."
supabase functions deploy analyze-response --project-ref ofyjvfmcgtntwamkubui

echo "Deploying test-prompt-openai function..."
supabase functions deploy test-prompt-openai --project-ref ofyjvfmcgtntwamkubui

echo "Deploying test-prompt-deepseek function..."
supabase functions deploy test-prompt-deepseek --project-ref ofyjvfmcgtntwamkubui

echo "Deploying test-prompt-perplexity function..."
supabase functions deploy test-prompt-perplexity --project-ref ofyjvfmcgtntwamkubui

echo "Deploying test-prompt-google-ai-overviews function..."
supabase functions deploy test-prompt-google-ai-overviews --project-ref ofyjvfmcgtntwamkubui

echo "Deploying admin-upgrade-user function..."
supabase functions deploy admin-upgrade-user --project-ref ofyjvfmcgtntwamkubui

echo "Deploying search-insights function..."
supabase functions deploy search-insights --project-ref ofyjvfmcgtntwamkubui

echo "Deploying ai-thematic-analysis function..."
supabase functions deploy ai-thematic-analysis --project-ref ofyjvfmcgtntwamkubui

echo "Deploying company-report function..."
supabase functions deploy company-report --project-ref ofyjvfmcgtntwamkubui

echo "Deploying company-report-text function..."
supabase functions deploy company-report-text --project-ref ofyjvfmcgtntwamkubui

echo "Deploying ai-thematic-analysis-bulk function..."
supabase functions deploy ai-thematic-analysis-bulk --project-ref ofyjvfmcgtntwamkubui

echo "Edge Functions deployment completed!" 