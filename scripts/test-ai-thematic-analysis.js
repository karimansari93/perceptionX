#!/usr/bin/env node

/**
 * Test script for AI thematic analysis edge function
 * Usage: node scripts/test-ai-thematic-analysis.js
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://ofyjvfmcgtntwamkubui.supabase.co";
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9meWp2Zm1jZ3RudHdhbWt1YnVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgwNzk1ODgsImV4cCI6MjA2MzY1NTU4OH0.vkzuvNTDMlAS77MHjNDBvBmm0tFGTSPIE7y_Ce3dy2k";

const supabase = createClient(supabaseUrl, supabaseKey);

async function testEdgeFunction() {
  console.log('🧪 Testing AI Thematic Analysis Edge Function');
  console.log('============================================');
  console.log('');

  try {
    // First, get a real response from the database
    console.log('📋 Fetching a real response from the database...');
    const { data: responses, error: fetchError } = await supabase
      .from('prompt_responses')
      .select('id, response_text, ai_model')
      .not('response_text', 'is', null)
      .not('response_text', 'eq', '')
      .limit(1);

    if (fetchError) {
      console.error('❌ Error fetching responses:', fetchError);
      return;
    }

    if (!responses || responses.length === 0) {
      console.error('❌ No responses found in the database');
      return;
    }

    const response = responses[0];

    console.log('📝 Test Response:');
    console.log(`Response ID: ${response.id}`);
    console.log(`Model: ${response.ai_model}`);
    console.log(`Text Preview: ${response.response_text.substring(0, 200)}...`);
    console.log('');

    console.log('🔄 Calling edge function...');
    
    const { data, error } = await supabase.functions.invoke('ai-thematic-analysis', {
      body: {
        response_id: response.id,
        company_name: 'Test Company', // Use a generic company name for testing
        response_text: response.response_text,
        ai_model: response.ai_model
      }
    });

    if (error) {
      console.error('❌ Edge function error:', error);
      return;
    }

    console.log('✅ Edge function response:');
    console.log(JSON.stringify(data, null, 2));
    console.log('');

    if (data.success && data.themes) {
      console.log('📊 Analysis Results:');
      console.log(`Total themes: ${data.total_themes}`);
      console.log(`Positive themes: ${data.positive_themes}`);
      console.log(`Negative themes: ${data.negative_themes}`);
      console.log(`Neutral themes: ${data.neutral_themes}`);
      console.log('');

      console.log('🎯 Identified Themes:');
      data.themes.forEach((theme, index) => {
        console.log(`  ${index + 1}. ${theme.theme_name}`);
        console.log(`     Description: ${theme.theme_description}`);
        console.log(`     Sentiment: ${theme.sentiment} (${theme.sentiment_score})`);
        console.log(`     TalentX Attribute: ${theme.talentx_attribute_name}`);
        console.log(`     Confidence: ${theme.confidence_score}`);
        console.log(`     Keywords: ${theme.keywords.join(', ')}`);
        console.log('');
      });
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testEdgeFunction();