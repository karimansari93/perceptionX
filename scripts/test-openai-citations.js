#!/usr/bin/env node

/**
 * Test script for OpenAI GPT-5.2 citations functionality
 * 
 * Usage:
 *   node scripts/test-openai-citations.js [options]
 * 
 * Options:
 *   --prompt <text>        : Custom prompt to test (default: example prompt)
 *   --use-responses-api    : Force use of Responses API (default: auto-detect)
 *   --use-chat-completions : Force use of Chat Completions API
 *   --verbose              : Show full response details
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env file manually if it exists
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

try {
  const envFile = readFileSync(join(projectRoot, '.env.local'), 'utf8');
  envFile.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = value;
      }
    }
  });
} catch (e) {
  // .env.local doesn't exist, try .env
  try {
    const envFile = readFileSync(join(projectRoot, '.env'), 'utf8');
    envFile.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = value;
        }
      }
    });
  } catch (e2) {
    // No .env file, use process.env directly
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  prompt: null,
  useResponsesApi: null,
  useChatCompletions: false,
  verbose: false
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--prompt':
      options.prompt = args[++i];
      break;
    case '--use-responses-api':
      options.useResponsesApi = true;
      break;
    case '--use-chat-completions':
      options.useChatCompletions = true;
      options.useResponsesApi = false;
      break;
    case '--verbose':
    case '-v':
      options.verbose = true;
      break;
    case '--help':
    case '-h':
      console.log(`
Test OpenAI GPT-5.2 Citations

Usage: node scripts/test-openai-citations.js [options]

Options:
  --prompt <text>              Custom prompt to test
  --use-responses-api          Force use of Responses API
  --use-chat-completions        Force use of Chat Completions API
  --verbose, -v                 Show full response details
  --help, -h                    Show this help message

Examples:
  node scripts/test-openai-citations.js
  node scripts/test-openai-citations.js --prompt "What companies in Technology are known for innovation?"
  node scripts/test-openai-citations.js --verbose
      `);
      process.exit(0);
  }
}

// Default test prompt
const defaultPrompt = options.prompt || 
  "What companies in Technology are known for having a strong, purpose-driven employer brand?";

async function testOpenAICitations() {
  console.log('🧪 Testing OpenAI GPT-5.2 Citations\n');
  console.log('📝 Prompt:', defaultPrompt);
  console.log('');

  try {
    console.log('⏳ Calling test-prompt-openai edge function...\n');
    
    const { data, error } = await supabase.functions.invoke('test-prompt-openai', {
      body: { prompt: defaultPrompt }
    });

    if (error) {
      console.error('❌ Error calling edge function:', error);
      console.error('Details:', JSON.stringify(error, null, 2));
      
      // Try to get error response body
      if (error.context && error.context.body) {
        try {
          const errorText = await error.context.text();
          console.error('Error response body:', errorText);
        } catch (e) {
          console.error('Could not read error body');
        }
      }
      
      process.exit(1);
    }

    if (!data) {
      console.error('❌ No data returned from edge function');
      process.exit(1);
    }

    // Display results
    console.log('✅ Response received!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📄 RESPONSE TEXT:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(data.response || 'No response text');
    console.log('');

    // Display citations
    const citations = data.citations || [];
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔗 CITATIONS (${citations.length} found):`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (citations.length === 0) {
      console.log('⚠️  No citations found in response');
      console.log('');
      console.log('💡 This could mean:');
      console.log('   - Responses API is not available (check OpenAI API access)');
      console.log('   - Citation extraction needs improvement');
      console.log('   - Model did not include citations in response');
    } else {
      citations.forEach((citation, index) => {
        console.log(`\n[${index + 1}] ${citation.title || 'Untitled'}`);
        if (citation.domain) {
          console.log(`    Domain: ${citation.domain}`);
        }
        if (citation.url) {
          console.log(`    URL: ${citation.url}`);
        } else {
          console.log(`    ⚠️  No URL provided`);
        }
      });
    }
    console.log('');

    // Show full data if verbose
    if (options.verbose) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📊 FULL RESPONSE DATA:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(JSON.stringify(data, null, 2));
      console.log('');
    }

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 SUMMARY:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Response length: ${(data.response || '').length} characters`);
    console.log(`Citations found: ${citations.length}`);
    console.log(`Citations with URLs: ${citations.filter(c => c.url).length}`);
    console.log(`Citations without URLs: ${citations.filter(c => !c.url).length}`);
    console.log('');

    // Test multiple prompts
    if (!options.prompt) {
      console.log('💡 Tip: Test with custom prompt:');
      console.log('   node scripts/test-openai-citations.js --prompt "Your prompt here"');
      console.log('');
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the test
testOpenAICitations().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
