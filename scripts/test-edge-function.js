const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = 'https://ofyjvfmcgtntwamkubui.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'your-anon-key-here';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testGoogleAIFunction() {
  try {
    console.log('Testing Google AI edge function (onboarding)...');
    
    const { data, error } = await supabase.functions.invoke('test-prompt-gemini', {
      body: { 
        prompt: 'Hello, this is a test prompt. Please respond with a simple greeting.' 
      }
    });

    if (error) {
      console.error('Error:', error);
      console.error('Error message:', error.message);
      console.error('Error details:', error.details);
    } else {
      console.log('Success! Response:', data);
    }
  } catch (err) {
    console.error('Exception:', err);
  }
}

testGoogleAIFunction(); 