#!/usr/bin/env node

/**
 * Script to manually run AI thematic analysis on existing responses
 * Usage: node scripts/run-ai-thematic-analysis.js [options]
 * 
 * Options:
 * --company-name <name>  : Analyze responses for specific company
 * --ai-model <model>     : Analyze responses from specific AI model
 * --limit <number>       : Limit number of responses to analyze (default: 10)
 * --dry-run              : Show what would be analyzed without actually running
 * --force                : Re-analyze responses that already have themes
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  companyName: null,
  aiModel: null,
  limit: 10,
  dryRun: false,
  force: false
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--company-name':
      options.companyName = args[++i];
      break;
    case '--ai-model':
      options.aiModel = args[++i];
      break;
    case '--limit':
      options.limit = parseInt(args[++i]) || 10;
      break;
    case '--dry-run':
      options.dryRun = true;
      break;
    case '--force':
      options.force = true;
      break;
    case '--help':
      console.log(`
Usage: node scripts/run-ai-thematic-analysis.js [options]

Options:
  --company-name <name>  Analyze responses for specific company
  --ai-model <model>     Analyze responses from specific AI model  
  --limit <number>       Limit number of responses to analyze (default: 10)
  --dry-run              Show what would be analyzed without actually running
  --force                Re-analyze responses that already have themes
  --help                 Show this help message

Examples:
  node scripts/run-ai-thematic-analysis.js --company-name "Google" --limit 5
  node scripts/run-ai-thematic-analysis.js --ai-model "gpt-4" --dry-run
  node scripts/run-ai-thematic-analysis.js --force --limit 20
      `);
      process.exit(0);
  }
}

async function getResponsesToAnalyze() {
  let query = supabase
    .from('prompt_responses')
    .select(`
      id,
      response_text,
      ai_model,
      tested_at,
      confirmed_prompts!inner (
        prompt_text,
        prompt_category,
        onboarding_id
      )
    `)
    .not('response_text', 'is', null)
    .not('response_text', 'eq', '')
    .order('tested_at', { ascending: false });

  // For company name filtering, we need to do it differently since we can't use nested joins
  // We'll filter the results after fetching if needed

  if (options.aiModel) {
    query = query.eq('ai_model', options.aiModel);
  }

  if (!options.force) {
    // Only get responses that don't already have themes
    query = query.not('id', 'in', `(
      SELECT DISTINCT response_id 
      FROM ai_themes 
      WHERE response_id IS NOT NULL
    )`);
  }

  const { data: responses, error } = await query.limit(options.limit);

  if (error) {
    throw new Error(`Failed to fetch responses: ${error.message}`);
  }

  // Now we need to fetch company names separately and filter if needed
  const responsesWithCompany = [];
  
  for (const response of responses || []) {
    if (response.confirmed_prompts?.onboarding_id) {
      // Fetch company name from user_onboarding
      const { data: onboardingData, error: onboardingError } = await supabase
        .from('user_onboarding')
        .select('company_name')
        .eq('id', response.confirmed_prompts.onboarding_id)
        .single();
      
      if (!onboardingError && onboardingData?.company_name) {
        // Add company name to the response structure
        response.confirmed_prompts.company_name = onboardingData.company_name;
        
        // Apply company name filter if specified
        if (!options.companyName || onboardingData.company_name === options.companyName) {
          responsesWithCompany.push(response);
        }
      }
    }
  }

  return responsesWithCompany;
}

async function analyzeResponse(response) {
  const companyName = response.confirmed_prompts?.company_name;
  
  if (!companyName) {
    console.warn(`⚠️  Skipping response ${response.id}: No company name found`);
    return null;
  }

  try {
    const { data, error } = await supabase.functions.invoke('ai-thematic-analysis', {
      body: {
        response_id: response.id,
        company_name: companyName,
        response_text: response.response_text,
        ai_model: response.ai_model
      }
    });

    if (error) {
      throw new Error(`Edge function error: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error(`❌ Failed to analyze response ${response.id}:`, error.message);
    return null;
  }
}

async function main() {
  console.log('🔍 AI Thematic Analysis Script');
  console.log('==============================');
  
  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No actual analysis will be performed');
  }
  
  console.log(`📊 Options:`, {
    companyName: options.companyName || 'All companies',
    aiModel: options.aiModel || 'All models',
    limit: options.limit,
    force: options.force,
    dryRun: options.dryRun
  });
  console.log('');

  try {
    // Get responses to analyze
    console.log('📋 Fetching responses to analyze...');
    const responses = await getResponsesToAnalyze();
    
    if (responses.length === 0) {
      console.log('✅ No responses found matching the criteria');
      return;
    }

    console.log(`📝 Found ${responses.length} response(s) to analyze`);
    console.log('');

    if (options.dryRun) {
      console.log('📋 Responses that would be analyzed:');
      responses.forEach((response, index) => {
        const companyName = response.confirmed_prompts?.user_onboarding?.company_name;
        const preview = response.response_text.substring(0, 100) + '...';
        console.log(`  ${index + 1}. [${response.id}] ${companyName} (${response.ai_model})`);
        console.log(`     Preview: ${preview}`);
        console.log('');
      });
      return;
    }

    // Analyze responses
    let successCount = 0;
    let errorCount = 0;
    const results = [];

    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      const companyName = response.confirmed_prompts?.user_onboarding?.company_name;
      
      console.log(`🔄 Analyzing response ${i + 1}/${responses.length} (${response.id})`);
      console.log(`   Company: ${companyName}`);
      console.log(`   Model: ${response.ai_model}`);
      
      const result = await analyzeResponse(response);
      
      if (result && result.success) {
        successCount++;
        results.push({
          responseId: response.id,
          companyName,
          aiModel: response.ai_model,
          totalThemes: result.total_themes,
          positiveThemes: result.positive_themes,
          negativeThemes: result.negative_themes,
          neutralThemes: result.neutral_themes
        });
        
        console.log(`   ✅ Success: ${result.total_themes} themes identified`);
        console.log(`      Positive: ${result.positive_themes}, Negative: ${result.negative_themes}, Neutral: ${result.neutral_themes}`);
      } else {
        errorCount++;
        console.log(`   ❌ Failed to analyze`);
      }
      
      console.log('');
      
      // Add a small delay to avoid rate limiting
      if (i < responses.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Summary
    console.log('📊 Analysis Summary');
    console.log('==================');
    console.log(`✅ Successfully analyzed: ${successCount} responses`);
    console.log(`❌ Failed to analyze: ${errorCount} responses`);
    console.log('');

    if (results.length > 0) {
      console.log('📈 Results by Company:');
      const companyStats = {};
      results.forEach(result => {
        if (!companyStats[result.companyName]) {
          companyStats[result.companyName] = {
            totalResponses: 0,
            totalThemes: 0,
            positiveThemes: 0,
            negativeThemes: 0,
            neutralThemes: 0
          };
        }
        companyStats[result.companyName].totalResponses++;
        companyStats[result.companyName].totalThemes += result.totalThemes;
        companyStats[result.companyName].positiveThemes += result.positiveThemes;
        companyStats[result.companyName].negativeThemes += result.negativeThemes;
        companyStats[result.companyName].neutralThemes += result.neutralThemes;
      });

      Object.entries(companyStats).forEach(([company, stats]) => {
        console.log(`  ${company}:`);
        console.log(`    Responses: ${stats.totalResponses}`);
        console.log(`    Total Themes: ${stats.totalThemes}`);
        console.log(`    Positive: ${stats.positiveThemes}, Negative: ${stats.negativeThemes}, Neutral: ${stats.neutralThemes}`);
        console.log('');
      });
    }

  } catch (error) {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
