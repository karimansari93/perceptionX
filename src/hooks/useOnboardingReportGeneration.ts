import { useState } from 'react';
import jsPDF from 'jspdf';
import { PromptResponse, DashboardMetrics, SentimentTrendData, CitationCount, PromptData } from '@/types/dashboard';
import { useToast } from '@/hooks/use-toast';
import { ReportTemplates } from '@/services/reportTemplates';
import { AIReportGenerator } from '@/services/aiReportGenerator';

interface OnboardingReportData {
  companyName: string;
  metrics: DashboardMetrics;
  responses: PromptResponse[];
  sentimentTrend: SentimentTrendData[];
  topCitations: CitationCount[];
  promptsData: PromptData[];
  topCompetitors?: any[];
  llmMentionRankings?: any[];
  aiThemes?: any[];
  searchInsights?: any[];
}

export const useOnboardingReportGeneration = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  const generateOnboardingReport = async (data: OnboardingReportData) => {
    setIsGenerating(true);
    
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - 2 * margin;
      let yPosition = margin;

      // Helper function to add page break if needed
      const checkPageBreak = (contentHeight: number) => {
        if (yPosition + contentHeight > pageHeight - margin) {
          pdf.addPage();
          yPosition = margin;
        }
      };

      // Helper function to add text with proper wrapping
      const addWrappedText = (text: string, fontSize: number = 12, color: [number, number, number] = [75, 85, 99]) => {
        pdf.setFontSize(fontSize);
        pdf.setTextColor(color[0], color[1], color[2]);
        const lines = pdf.splitTextToSize(text, contentWidth);
        lines.forEach((line: string) => {
          checkPageBreak(8);
          pdf.text(line, margin, yPosition);
          yPosition += 6;
        });
        yPosition += 4;
      };

      // Helper function to add section header
      const addSectionHeader = (title: string, fontSize: number = 18) => {
        checkPageBreak(20);
        pdf.setFontSize(fontSize);
        pdf.setTextColor(31, 41, 55);
        pdf.setFont(undefined, 'bold');
        pdf.text(title, margin, yPosition);
        pdf.setFont(undefined, 'normal');
        yPosition += 15;
      };

      // Helper function to add a simple bar chart
      const addBarChart = (data: Array<{name: string, value: number}>, title: string, maxWidth: number = 150) => {
        checkPageBreak(80);
        
        // Chart title
        pdf.setFontSize(14);
        pdf.setTextColor(31, 41, 55);
        pdf.setFont(undefined, 'bold');
        pdf.text(title, margin, yPosition);
        yPosition += 10;
        
        const chartHeight = 60;
        const chartWidth = maxWidth;
        const barWidth = chartWidth / data.length;
        const maxValue = Math.max(...data.map(d => d.value));
        
        // Draw chart background
        pdf.setDrawColor(240, 240, 240);
        pdf.setFillColor(248, 250, 252);
        pdf.rect(margin, yPosition, chartWidth, chartHeight, 'FD');
        
        // Draw bars
        data.forEach((item, index) => {
          const barHeight = (item.value / maxValue) * (chartHeight - 20);
          const x = margin + (index * barWidth) + 5;
          const y = yPosition + chartHeight - barHeight - 10;
          
          // Bar color based on index
          const colors = [
            [59, 130, 246],   // Blue
            [16, 185, 129],   // Green
            [245, 158, 11],   // Yellow
            [239, 68, 68],    // Red
            [139, 92, 246]    // Purple
          ];
          const color = colors[index % colors.length];
          
          pdf.setFillColor(color[0], color[1], color[2]);
          pdf.rect(x, y, barWidth - 10, barHeight, 'F');
          
          // Add value label on top of bar
          pdf.setFontSize(8);
          pdf.setTextColor(75, 85, 99);
          pdf.text(item.value.toString(), x + (barWidth - 10) / 2 - 5, y - 2);
          
          // Add name label below chart
          pdf.setFontSize(7);
          pdf.setTextColor(107, 114, 128);
          const nameWidth = pdf.getTextWidth(item.name);
          pdf.text(item.name, x + (barWidth - 10) / 2 - nameWidth / 2, yPosition + chartHeight + 5);
        });
        
        yPosition += chartHeight + 25;
      };

      // Helper function to add a simple horizontal bar chart for sources
      const addHorizontalBarChart = (data: Array<{name: string, value: number}>, title: string, maxWidth: number = 150) => {
        checkPageBreak(100);
        
        // Chart title
        pdf.setFontSize(14);
        pdf.setTextColor(31, 41, 55);
        pdf.setFont(undefined, 'bold');
        pdf.text(title, margin, yPosition);
        yPosition += 10;
        
        const chartHeight = data.length * 15 + 20;
        const chartWidth = maxWidth;
        const maxValue = Math.max(...data.map(d => d.value));
        
        // Draw chart background
        pdf.setDrawColor(240, 240, 240);
        pdf.setFillColor(248, 250, 252);
        pdf.rect(margin, yPosition, chartWidth, chartHeight, 'FD');
        
        // Draw horizontal bars
        data.forEach((item, index) => {
          const barHeight = 12;
          const barWidth = (item.value / maxValue) * (chartWidth - 40);
          const x = margin + 5;
          const y = yPosition + 10 + (index * 15);
          
          // Bar color based on index
          const colors = [
            [59, 130, 246],   // Blue
            [16, 185, 129],   // Green
            [245, 158, 11],   // Yellow
            [239, 68, 68],    // Red
            [139, 92, 246]    // Purple
          ];
          const color = colors[index % colors.length];
          
          pdf.setFillColor(color[0], color[1], color[2]);
          pdf.rect(x, y, barWidth, barHeight, 'F');
          
          // Add name label
          pdf.setFontSize(8);
          pdf.setTextColor(75, 85, 99);
          pdf.text(item.name, x + 5, y + 8);
          
          // Add value label at the end of bar
          pdf.setTextColor(107, 114, 128);
          pdf.text(item.value.toString(), x + barWidth + 5, y + 8);
        });
        
        yPosition += chartHeight + 15;
      };

      // Helper function to get favicon URL
      const getFaviconUrl = (domain: string): string => {
        const cleanDomain = domain.trim().toLowerCase().replace(/^www\./, '');
        return `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=32`;
      };

      // Helper function to add favicon to chart
      const addFaviconToChart = async (domain: string, x: number, y: number, size: number = 8) => {
        try {
          const faviconUrl = getFaviconUrl(domain);
          const img = new Image();
          img.crossOrigin = 'anonymous';
          
          await new Promise((resolve) => {
            img.onload = () => {
              try {
                pdf.addImage(img, 'PNG', x, y, size, size);
              } catch (error) {
                console.log('Error adding favicon:', error);
              }
              resolve(true);
            };
            img.onerror = () => {
              console.log('Favicon not available for:', domain);
              resolve(true);
            };
            img.src = faviconUrl;
          });
        } catch (error) {
          console.log('Error loading favicon for:', domain);
        }
      };

      // Add background logo with 10% opacity
      try {
        const logoPath = window.location.origin + '/logos/perceptionx-small.png';
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        await new Promise((resolve) => {
          img.onload = () => {
            try {
              // Set 10% opacity
              pdf.setGState(pdf.GState({opacity: 0.1}));
              
              // Calculate dimensions to fit the page
              const logoWidth = pageWidth;
              const logoHeight = (img.height * logoWidth) / img.width;
              
              // Add background image starting from left side
              pdf.addImage(img, 'PNG', 0, 0, logoWidth, logoHeight, '', 'FAST');
              
              // Reset opacity
              pdf.setGState(pdf.GState({opacity: 1}));
            } catch (error) {
              console.log('Error adding background logo:', error);
            }
            resolve(true);
          };
          img.onerror = () => {
            console.log('Background logo not available, continuing without it');
            resolve(true);
          };
          img.src = logoPath;
        });
      } catch (error) {
        console.log('Background logo not available, continuing without it');
      }

      // Title
      pdf.setFontSize(28);
      pdf.setTextColor(31, 41, 55);
      pdf.setFont(undefined, 'bold');
      pdf.text(`${data.companyName} PerceptionX Report`, margin, yPosition);
      yPosition += 35;

      // Generate AI-powered report content
      const aiReport = await AIReportGenerator.generateIntelligentReport(data as any);

      // Methodology
      addSectionHeader('Methodology');
      addWrappedText(aiReport.methodology, 11, [55, 65, 81]);
      yPosition += 15;

      // Executive Summary
      addSectionHeader('Executive Summary');
      addWrappedText(aiReport.executiveSummary, 11, [55, 65, 81]);
      yPosition += 15;

      // Competitor Analysis
      addSectionHeader('Competitor Analysis');
      addWrappedText(aiReport.competitorAnalysis, 11, [55, 65, 81]);
      yPosition += 15;

      // Add competitor list with percentages
      if (data.topCompetitors && data.topCompetitors.length > 0) {
        checkPageBreak(60);
        
        // Section title
        pdf.setFontSize(14);
        pdf.setTextColor(31, 41, 55);
        pdf.setFont(undefined, 'bold');
        pdf.text('Top 5 Competitors by Visibility', margin, yPosition);
        yPosition += 15;
        
        // Calculate total mentions for percentage calculation
        const totalMentions = data.topCompetitors.reduce((sum: number, comp: any) => sum + (comp.count || 0), 0);
        
        // Add competitor list with percentages
        data.topCompetitors.slice(0, 5).forEach((competitor: any, index: number) => {
          const percentage = totalMentions > 0 ? ((competitor.count / totalMentions) * 100).toFixed(1) : '0.0';
          
          checkPageBreak(12);
          
          // Competitor ranking and name
          pdf.setFontSize(12);
          pdf.setTextColor(31, 41, 55);
          pdf.setFont(undefined, 'bold');
          pdf.text(`${index + 1}. ${competitor.name}`, margin, yPosition);
          
          // Percentage
          pdf.setFontSize(12);
          pdf.setTextColor(59, 130, 246);
          pdf.setFont(undefined, 'bold');
          pdf.text(`(${percentage}%)`, margin + 120, yPosition);
          
          // Mention count
          pdf.setFontSize(10);
          pdf.setTextColor(107, 114, 128);
          pdf.setFont(undefined, 'normal');
          pdf.text(`${competitor.count} mentions`, margin + 160, yPosition);
          
          yPosition += 12;
        });
        
        yPosition += 10;
      }

      // Key Themes
      addSectionHeader('Key Themes');
      addWrappedText(aiReport.keyThemes, 11, [55, 65, 81]);
      yPosition += 15;

      // Sources
      addSectionHeader('Sources');
      addWrappedText(aiReport.sources, 11, [55, 65, 81]);
      yPosition += 15;

      // Add sources list with percentages
      if (data.topCitations && data.topCitations.length > 0) {
        checkPageBreak(60);
        
        // Section title
        pdf.setFontSize(14);
        pdf.setTextColor(31, 41, 55);
        pdf.setFont(undefined, 'bold');
        pdf.text('Top 5 Sources by Citations', margin, yPosition);
        yPosition += 15;
        
        // Calculate total citations for percentage calculation
        const totalCitations = data.topCitations.reduce((sum: number, source: any) => sum + (source.count || 0), 0);
        
        // Add sources list with percentages
        data.topCitations.slice(0, 5).forEach((source: any, index: number) => {
          const percentage = totalCitations > 0 ? ((source.count / totalCitations) * 100).toFixed(1) : '0.0';
          
          checkPageBreak(12);
          
          // Source ranking and domain
          pdf.setFontSize(12);
          pdf.setTextColor(31, 41, 55);
          pdf.setFont(undefined, 'bold');
          pdf.text(`${index + 1}. ${source.domain}`, margin, yPosition);
          
          // Percentage
          pdf.setFontSize(12);
          pdf.setTextColor(59, 130, 246);
          pdf.setFont(undefined, 'bold');
          pdf.text(`(${percentage}%)`, margin + 120, yPosition);
          
          // Citation count
          pdf.setFontSize(10);
          pdf.setTextColor(107, 114, 128);
          pdf.setFont(undefined, 'normal');
          pdf.text(`${source.count} citations`, margin + 160, yPosition);
          
          yPosition += 12;
        });
        
        yPosition += 10;
      }

      // Strategic Recommendations
      addSectionHeader('Strategic Recommendations');
      addWrappedText(aiReport.strategicRecommendations, 11, [55, 65, 81]);
      yPosition += 15;

      // Upgrade to Pro section
      addSectionHeader('Upgrade to PerceptionX Pro');
      addWrappedText(aiReport.upgradeSection, 11, [55, 65, 81]);

      // Add background logo to all pages and add footer
      const totalPages = pdf.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        
        // Add background logo with 10% opacity
        try {
          const logoPath = window.location.origin + '/logos/perceptionx-small.png';
          const img = new Image();
          img.crossOrigin = 'anonymous';
          
          // Set 10% opacity
          pdf.setGState(pdf.GState({opacity: 0.1}));
          
          // Calculate dimensions to fit the page
          const logoWidth = pageWidth;
          const logoHeight = (img.height * logoWidth) / img.width;
          
          // Add background image starting from left side
          pdf.addImage(img, 'PNG', 0, 0, logoWidth, logoHeight, '', 'FAST');
          
          // Reset opacity
          pdf.setGState(pdf.GState({opacity: 1}));
        } catch (error) {
          console.log('Background logo not available for page', i);
        }
        
        // Add footer
        pdf.setFontSize(9);
        pdf.setTextColor(107, 114, 128);
        pdf.text(`Page ${i} of ${totalPages}`, pageWidth - margin - 20, pageHeight - 10);
        pdf.text(`PerceptionX Report - ${data.companyName}`, margin, pageHeight - 10);
      }

      // Generate filename
      const filename = `${data.companyName.replace(/\s+/g, '_')}_PerceptionX_Mini_Report.pdf`;

      // Download the PDF
      pdf.save(filename);

      toast({
        title: "Onboarding Report Generated",
        description: `Your comprehensive AI perception analysis report has been downloaded successfully.`,
      });

    } catch (error) {
      console.error('Error generating onboarding report:', error);
      toast({
        title: "Report Generation Failed",
        description: "There was an error generating your report. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return {
    generateOnboardingReport,
    isGenerating
  };
};
