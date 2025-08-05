// Script to update a user's profile to pro subscription status
// Run this script to manually update your subscription status

import { createClient } from '@supabase/supabase-js';

// Replace with your actual Supabase URL and anon key
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function updateUserToPro(userId) {
  try {
    console.log(`Updating user ${userId} to pro subscription...`);
    
    // First, let's check if the profiles table has the subscription fields
    const { data: profileCheck, error: checkError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (checkError) {
      console.error('Error checking profile:', checkError);
      return;
    }
    
    console.log('Current profile data:', profileCheck);
    
    // Check if subscription_type field exists
    if (!('subscription_type' in profileCheck)) {
      console.log('Subscription fields not found in profiles table. You need to run the migration first.');
      console.log('Please run the migration: supabase/migrations/20250102000000_add_subscription_to_profiles.sql');
      return;
    }
    
    // Update the user to pro subscription
    const { data, error } = await supabase
      .from('profiles')
      .update({
        subscription_type: 'pro',
        subscription_start_date: new Date().toISOString(),
        prompts_used: 0
      })
      .eq('id', userId)
      .select();
    
    if (error) {
      console.error('Error updating profile:', error);
      return;
    }
    
    console.log('Successfully updated user to pro subscription!');
    console.log('Updated profile:', data);
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Usage: Replace 'YOUR_USER_ID' with your actual user ID
// updateUserToPro('YOUR_USER_ID');

export { updateUserToPro }; 