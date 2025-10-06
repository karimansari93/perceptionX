import { supabase } from '@/integrations/supabase/client';

export class CompanyReportTextService {
  /**
   * Generate a text-based company report for a single company
   */
  static async generateCompanyReport(companyId: string): Promise<{ success: boolean; report?: string; error?: string }> {
    try {
      
      const { data, error } = await supabase.functions.invoke('company-report-text', {
        body: {
          companyIds: [companyId],
          comparisonMode: false
        }
      });

      console.log('📡 Edge function response:', { data, error });

      if (error) {
        console.error('Error generating company report:', error);
        return {
          success: false,
          error: error.message || 'Failed to generate company report'
        };
      }

      // Parse the response data if it's a string
      let reportData = data;
      if (typeof data === 'string') {
        try {
          reportData = JSON.parse(data);
        } catch (parseError) {
          console.error('Error parsing response data:', parseError);
          return {
            success: false,
            error: 'Failed to parse response data'
          };
        }
      }

      console.log('📄 Parsed report data:', reportData);

      return {
        success: true,
        report: reportData.report
      };
    } catch (error) {
      console.error('Error generating company report:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Generate a text-based comparison report for multiple companies
   */
  static async generateComparisonReport(companyIds: string[]): Promise<{ success: boolean; report?: string; error?: string }> {
    try {
      if (companyIds.length < 2) {
        return {
          success: false,
          error: 'At least 2 companies required for comparison'
        };
      }

      const { data, error } = await supabase.functions.invoke('company-report-text', {
        body: {
          companyIds,
          comparisonMode: true
        }
      });

      if (error) {
        console.error('Error generating comparison report:', error);
        return {
          success: false,
          error: error.message || 'Failed to generate comparison report'
        };
      }

      // Parse the response data if it's a string
      let reportData = data;
      if (typeof data === 'string') {
        try {
          reportData = JSON.parse(data);
        } catch (parseError) {
          console.error('Error parsing response data:', parseError);
          return {
            success: false,
            error: 'Failed to parse response data'
          };
        }
      }

      return {
        success: true,
        report: reportData.report
      };
    } catch (error) {
      console.error('Error generating comparison report:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get all companies available for reporting
   */
  static async getAvailableCompanies(): Promise<{ id: string; name: string; industry: string; email: string }[]> {
    try {
      console.log('🔍 Fetching companies...');
      
      // 1) Get completed onboarding records (latest per user) - same as admin panel
      const { data: allOnboardings, error: onboardingError } = await supabase
        .from('user_onboarding')
        .select('user_id, company_name, industry, created_at')
        .not('company_name', 'is', null)
        .not('industry', 'is', null)
        .order('created_at', { ascending: false });

      console.log('📊 Onboarding data:', { allOnboardings, onboardingError });

      if (onboardingError) {
        console.error('Error fetching onboarding data:', onboardingError);
        return [];
      }

      if (!allOnboardings || allOnboardings.length === 0) {
        console.log('⚠️ No onboarding data found');
        return [];
      }

      // Get latest onboarding per user (same logic as admin panel)
      const userIdToOnboarding: Record<string, any> = {};
      for (const row of allOnboardings) {
        if (!userIdToOnboarding[row.user_id]) {
          userIdToOnboarding[row.user_id] = row;
        }
      }
      const completedUserIds = Object.keys(userIdToOnboarding);

      if (completedUserIds.length === 0) {
        return [];
      }

      // 2) Fetch profiles only for completed users
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', completedUserIds);

      if (profilesError) {
        console.error('Error fetching profiles data:', profilesError);
        // Continue without email data
      }

      // Create a map of user ID to email
      const profileMap: Record<string, { email: string }> = {};
      if (profiles) {
        for (const profile of profiles) {
          profileMap[profile.id] = { email: profile.email || 'No email' };
        }
      }

      // Combine the data using the same approach as admin panel
      const result = completedUserIds.map((uid: string) => {
        const ob = userIdToOnboarding[uid];
        const prof = profileMap[uid];
        
        return {
          id: uid,
          name: ob?.company_name || '—',
          industry: ob?.industry || '—',
          email: prof?.email || 'No email'
        };
      });

      console.log('✅ Final companies result:', result);
      return result;
    } catch (error) {
      console.error('Error fetching companies:', error);
      return [];
    }
  }
}
