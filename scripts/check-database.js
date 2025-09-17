#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://ofyjvfmcgtntwamkubui.supabase.co";
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9meWp2Zm1jZ3RudHdhbWt1YnVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgwNzk1ODgsImV4cCI6MjA2MzY1NTU4OH0.vkzuvNTDMlAS77MHjNDBvBmm0tFGTSPIE7y_Ce3dy2k";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDatabase() {
  console.log('🔍 Checking database contents...');
  console.log('================================');
  console.log('');

  try {
    // Check prompt_responses
    const { data: responses, error: responsesError } = await supabase
      .from('prompt_responses')
      .select('id, response_text, ai_model')
      .limit(5);

    console.log('📋 prompt_responses:');
    if (responsesError) {
      console.error('❌ Error:', responsesError);
    } else {
      console.log(`Found ${responses?.length || 0} responses`);
      if (responses && responses.length > 0) {
        responses.forEach((r, i) => {
          console.log(`  ${i + 1}. ID: ${r.id}, Model: ${r.ai_model}, Text: ${r.response_text?.substring(0, 50)}...`);
        });
      }
    }
    console.log('');

    // Check confirmed_prompts
    const { data: prompts, error: promptsError } = await supabase
      .from('confirmed_prompts')
      .select('id, prompt_text, user_id')
      .limit(5);

    console.log('📝 confirmed_prompts:');
    if (promptsError) {
      console.error('❌ Error:', promptsError);
    } else {
      console.log(`Found ${prompts?.length || 0} prompts`);
      if (prompts && prompts.length > 0) {
        prompts.forEach((p, i) => {
          console.log(`  ${i + 1}. ID: ${p.id}, User: ${p.user_id}, Text: ${p.prompt_text?.substring(0, 50)}...`);
        });
      }
    }
    console.log('');

    // Check ai_themes
    const { data: themes, error: themesError } = await supabase
      .from('ai_themes')
      .select('id, theme_name, response_id')
      .limit(5);

    console.log('🎯 ai_themes:');
    if (themesError) {
      console.error('❌ Error:', themesError);
    } else {
      console.log(`Found ${themes?.length || 0} themes`);
      if (themes && themes.length > 0) {
        themes.forEach((t, i) => {
          console.log(`  ${i + 1}. ID: ${t.id}, Theme: ${t.theme_name}, Response: ${t.response_id}`);
        });
      }
    }

  } catch (error) {
    console.error('❌ Check failed:', error.message);
  }
}

checkDatabase();
