import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useOnboardingReportGeneration } from '@/hooks/useOnboardingReportGeneration';
import { AdminReportService } from '@/services/adminReportService';

export const useAdminReportGeneration = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingForUser, setGeneratingForUser] = useState<string | null>(null);
  const { toast } = useToast();
  const { generateOnboardingReport } = useOnboardingReportGeneration();

  const generateUserReport = async (userId: string, userEmail: string) => {
    setIsGenerating(true);
    setGeneratingForUser(userId);
    
    try {
      // Fetch user's report data
      const reportData = await AdminReportService.getUserReportData(userId);
      
      if (!reportData) {
        toast({
          title: "Report Generation Failed",
          description: `No data found for user ${userEmail}. User may not have completed onboarding or have any responses.`,
          variant: "destructive",
        });
        return;
      }

      if (!reportData.responses || reportData.responses.length === 0) {
        toast({
          title: "No Data Available",
          description: `User ${userEmail} has no AI responses to generate a report from.`,
          variant: "destructive",
        });
        return;
      }

      // Generate the report using the existing onboarding report generator
      await generateOnboardingReport(reportData);

      toast({
        title: "Admin Report Generated",
        description: `Successfully generated report for ${userEmail} (${reportData.companyName}).`,
      });

    } catch (error) {
      console.error('Error generating admin report:', error);
      toast({
        title: "Report Generation Failed",
        description: `Failed to generate report for ${userEmail}. Please try again.`,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
      setGeneratingForUser(null);
    }
  };

  return {
    generateUserReport,
    isGenerating,
    generatingForUser
  };
};
