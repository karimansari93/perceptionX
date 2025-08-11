import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateTalentXPrompts } from "../../../src/config/talentXAttributes.ts";

export class TalentXProService {
  static async generateProPrompts(userId: string, companyName: string, industry: string) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
      // Generate the 30 prompts
      const prompts = generateTalentXPrompts(companyName, industry);
      
      // Insert prompts into talentx_pro_prompts table
      const { error: insertError } = await supabase
        .from('talentx_pro_prompts')
        .insert(
          prompts.map(prompt => ({
            user_id: userId,
            company_name: companyName,
            industry: industry,
            prompt_text: prompt.prompt,
            prompt_type: prompt.type,
            attribute_id: prompt.attributeId,
            is_generated: false
          }))
        );

      if (insertError) {
        console.error('Error inserting TalentX Pro prompts:', insertError);
        throw insertError;
      }

      return prompts;

    } catch (error) {
      console.error('Error in generateProPrompts:', error);
      throw error;
    }
  }

  static async hasProPrompts(userId: string): Promise<boolean> {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
      const { data, error } = await supabase
        .from('talentx_pro_prompts')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

      if (error) throw error;
      return data && data.length > 0;

    } catch (error) {
      console.error('Error checking Pro prompts:', error);
      return false;
    }
  }

  static async getProPrompts(userId: string) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
      const { data, error } = await supabase
        .from('talentx_pro_prompts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data || [];

    } catch (error) {
      console.error('Error fetching Pro prompts:', error);
      return [];
    }
  }
} 