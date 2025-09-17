import { supabase } from '@/integrations/supabase/client';
import { 
  CompanyReportData, 
  ComparisonData, 
  CompanyReportRequest, 
  CompanyReportResponse 
} from '@/types/companyReport';

export class CompanyReportService {
  /**
   * Generate a company report for a single company
   */
  static async generateCompanyReport(companyId: string): Promise<CompanyReportResponse> {
    try {
      const { data, error } = await supabase.functions.invoke('company-report', {
        body: {
          companyIds: [companyId],
          comparisonMode: false
        }
      });

      if (error) {
        console.error('Error generating company report:', error);
        return {
          success: false,
          error: error.message || 'Failed to generate company report'
        };
      }

      return {
        success: true,
        data: data as CompanyReportData
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
   * Generate a comparison report for multiple companies
   */
  static async generateComparisonReport(companyIds: string[]): Promise<CompanyReportResponse> {
    try {
      if (companyIds.length < 2) {
        return {
          success: false,
          error: 'At least 2 companies required for comparison'
        };
      }

      const { data, error } = await supabase.functions.invoke('company-report', {
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

      return {
        success: true,
        data: data as ComparisonData
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
      // 1) Get completed onboarding records (latest per user) - same as admin panel
      const { data: allOnboardings, error: onboardingError } = await supabase
        .from('user_onboarding')
        .select('user_id, company_name, industry, created_at')
        .not('company_name', 'is', null)
        .not('industry', 'is', null)
        .order('created_at', { ascending: false });

      if (onboardingError) {
        console.error('Error fetching onboarding data:', onboardingError);
        return [];
      }

      if (!allOnboardings || allOnboardings.length === 0) {
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
      return completedUserIds.map((uid: string) => {
        const ob = userIdToOnboarding[uid];
        const prof = profileMap[uid];
        
        return {
          id: uid,
          name: ob?.company_name || '—',
          industry: ob?.industry || '—',
          email: prof?.email || 'No email'
        };
      });
    } catch (error) {
      console.error('Error fetching companies:', error);
      return [];
    }
  }

  /**
   * Get company data for a specific company
   */
  static async getCompanyData(companyId: string): Promise<{
    id: string;
    name: string;
    industry: string;
    email: string;
    totalResponses: number;
    lastUpdated: string | null;
  } | null> {
    try {
      // Get company basic info
      const { data: companyData, error: companyError } = await supabase
        .from('user_onboarding')
        .select('user_id, company_name, industry')
        .eq('user_id', companyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (companyError || !companyData) {
        console.error('Error fetching company data:', companyError);
        return null;
      }

      // Get profile data separately
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('email, created_at')
        .eq('id', companyId)
        .single();

      // Get response count and last updated
      const { data: responses, error: responsesError } = await supabase
        .from('prompt_responses')
        .select('created_at')
        .eq('confirmed_prompts.user_id', companyId)
        .order('created_at', { ascending: false })
        .limit(1);

      const lastUpdated = responses && responses.length > 0 ? responses[0].created_at : null;

      return {
        id: companyData.user_id,
        name: companyData.company_name,
        industry: companyData.industry,
        email: profileData?.email || 'No email',
        totalResponses: responses?.length || 0,
        lastUpdated
      };
    } catch (error) {
      console.error('Error fetching company data:', error);
      return null;
    }
  }
}
