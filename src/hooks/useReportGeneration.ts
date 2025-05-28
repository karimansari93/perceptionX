import { useState } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { PromptResponse, DashboardMetrics, SentimentTrendData, CitationCount, PromptData } from '@/types/dashboard';
import { useToast } from '@/hooks/use-toast';
import { ReportTemplates } from '@/services/reportTemplates';

interface ReportData {
  companyName: string;
  metrics: DashboardMetrics;
  responses: PromptResponse[];
  sentimentTrend: SentimentTrendData[];
  topCitations: CitationCount[];
  promptsData: PromptData[];
  answerGaps?: {
    contentScore: number;
    actionableTasks: any[];
    websiteMetadata: any;
  };
}

interface ReportOptions {
  type: 'complete' | 'answer-gaps';
  dateRange?: {
    start: Date;
    end: Date;
  };
  includeCharts: boolean;
}

export const useReportGeneration = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  const generateReport = async (data: ReportData, options: ReportOptions) => {
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

      // Header
      pdf.setFontSize(28);
      pdf.setTextColor(31, 41, 55);
      const reportTitle = options.type === 'complete' ? 'AI Visibility Intelligence Report' : 'Website Content Gap Analysis';
      pdf.text(reportTitle, margin, yPosition);
      yPosition += 20;

      pdf.setFontSize(16);
      pdf.setTextColor(107, 114, 128);
      pdf.text(`${data.companyName} - Strategic AI Positioning Analysis`, margin, yPosition);
      yPosition += 15;
      
      pdf.setFontSize(12);
      pdf.text(`Generated: ${new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })}`, margin, yPosition);
      yPosition += 25;

      if (options.type === 'complete') {
        // Executive Summary
        checkPageBreak(50);
        pdf.setFontSize(20);
        pdf.setTextColor(31, 41, 55);
        pdf.text('Executive Summary', margin, yPosition);
        yPosition += 15;

        const executiveSummary = ReportTemplates.generateExecutiveSummary(data);
        addWrappedText(executiveSummary, 11, [55, 65, 81]);
        yPosition += 15;

        // Key Metrics Dashboard
        checkPageBreak(40);
        pdf.setFontSize(18);
        pdf.setTextColor(31, 41, 55);
        pdf.text('Key Performance Indicators', margin, yPosition);
        yPosition += 15;

        // Metrics grid
        const metricsGrid = [
          [`Total Responses Analyzed`, `${data.metrics.totalResponses}`],
          [`Company Mention Rate`, `${(data.responses.filter(r => r.company_mentioned).length / data.responses.length * 100).toFixed(1)}%`],
          [`Average Sentiment Score`, `${data.metrics.averageSentiment.toFixed(2)} (${data.metrics.sentimentLabel})`],
          [`Citation Sources`, `${data.metrics.uniqueDomains} domains`],
          [`Total Citations`, `${data.metrics.totalCitations}`],
          [`Active Monitoring Prompts`, `${data.promptsData.length}`]
        ];

        metricsGrid.forEach(([label, value]) => {
          checkPageBreak(8);
          pdf.setFontSize(11);
          pdf.setTextColor(107, 114, 128);
          pdf.text(`${label}:`, margin + 5, yPosition);
          pdf.setTextColor(31, 41, 55);
          pdf.setFont(undefined, 'bold');
          pdf.text(value, margin + 80, yPosition);
          pdf.setFont(undefined, 'normal');
          yPosition += 8;
        });
        yPosition += 15;

        // Detailed Findings
        checkPageBreak(30);
        pdf.setFontSize(18);
        pdf.setTextColor(31, 41, 55);
        pdf.text('Detailed Findings', margin, yPosition);
        yPosition += 15;

        const detailedFindings = ReportTemplates.generateDetailedFindings(data);
        addWrappedText(detailedFindings, 11, [55, 65, 81]);
        yPosition += 15;

        // Actionable Recommendations
        checkPageBreak(30);
        pdf.setFontSize(18);
        pdf.setTextColor(31, 41, 55);
        pdf.text('Strategic Recommendations', margin, yPosition);
        yPosition += 15;

        const recommendations = ReportTemplates.generateActionableRecommendations(data);
        addWrappedText(recommendations, 11, [55, 65, 81]);
      }

      if (options.type === 'answer-gaps' && data.answerGaps) {
        // Content Analysis Summary
        checkPageBreak(40);
        pdf.setFontSize(20);
        pdf.setTextColor(31, 41, 55);
        pdf.text('Website Content Analysis Summary', margin, yPosition);
        yPosition += 15;

        const contentScore = data.answerGaps.contentScore;
        pdf.setFontSize(14);
        pdf.setTextColor(contentScore >= 70 ? 34 : contentScore >= 50 ? 202 : 220, 
                        contentScore >= 70 ? 197 : contentScore >= 50 ? 138 : 38, 
                        contentScore >= 70 ? 94 : contentScore >= 50 ? 44 : 38);
        pdf.text(`Content Optimization Score: ${contentScore}%`, margin, yPosition);
        yPosition += 15;

        if (data.answerGaps.websiteMetadata?.title) {
          pdf.setFontSize(12);
          pdf.setTextColor(107, 114, 128);
          pdf.text(`Analysis of: ${data.answerGaps.websiteMetadata.title}`, margin, yPosition);
          yPosition += 20;
        }

        // Gap Analysis Summary
        const gapSummary = `Analysis identified ${data.answerGaps.actionableTasks.length} actionable optimization opportunities across your website content. ${data.answerGaps.actionableTasks.filter(t => t.priority === 'HIGH').length} critical gaps require immediate attention to improve AI model recognition and citation probability.

The assessment reveals systematic content structure deficiencies that limit your website's visibility in AI-generated responses. Key improvement areas include definitional clarity, competitive positioning content, and technical markup optimization.`;
        
        addWrappedText(gapSummary, 11, [55, 65, 81]);
        yPosition += 15;

        // Priority Tasks Breakdown
        checkPageBreak(40);
        pdf.setFontSize(18);
        pdf.setTextColor(31, 41, 55);
        pdf.text('Priority Action Items', margin, yPosition);
        yPosition += 15;

        const tasksByPriority = {
          'HIGH': data.answerGaps.actionableTasks.filter(t => t.priority === 'HIGH'),
          'MEDIUM': data.answerGaps.actionableTasks.filter(t => t.priority === 'MEDIUM'),
          'LOW': data.answerGaps.actionableTasks.filter(t => t.priority === 'LOW')
        };

        Object.entries(tasksByPriority).forEach(([priority, tasks]) => {
          if (tasks.length === 0) return;
          
          checkPageBreak(20);
          pdf.setFontSize(14);
          pdf.setTextColor(priority === 'HIGH' ? 220 : priority === 'MEDIUM' ? 202 : 107, 
                          priority === 'HIGH' ? 38 : priority === 'MEDIUM' ? 138 : 114, 
                          priority === 'HIGH' ? 38 : priority === 'MEDIUM' ? 44 : 128);
          pdf.text(`${priority} Priority (${tasks.length} items)`, margin, yPosition);
          yPosition += 12;

          tasks.slice(0, 5).forEach((task, index) => {
            checkPageBreak(20);
            pdf.setFontSize(11);
            pdf.setTextColor(31, 41, 55);
            pdf.setFont(undefined, 'bold');
            pdf.text(`${index + 1}. ${task.fixType}`, margin + 5, yPosition);
            pdf.setFont(undefined, 'normal');
            yPosition += 6;
            
            pdf.setFontSize(10);
            pdf.setTextColor(75, 85, 99);
            const evidenceLines = pdf.splitTextToSize(`Evidence: ${task.evidence}`, contentWidth - 10);
            evidenceLines.slice(0, 2).forEach((line: string) => {
              pdf.text(line, margin + 10, yPosition);
              yPosition += 5;
            });
            
            const actionLines = pdf.splitTextToSize(`Action: ${task.suggestedAction}`, contentWidth - 10);
            actionLines.slice(0, 2).forEach((line: string) => {
              pdf.text(line, margin + 10, yPosition);
              yPosition += 5;
            });
            yPosition += 8;
          });
          yPosition += 10;
        });

        // Implementation Timeline
        checkPageBreak(30);
        pdf.setFontSize(18);
        pdf.setTextColor(31, 41, 55);
        pdf.text('Recommended Implementation Timeline', margin, yPosition);
        yPosition += 15;

        const recommendations = ReportTemplates.generateActionableRecommendations(data);
        addWrappedText(recommendations, 11, [55, 65, 81]);
      }

      // Footer section
      checkPageBreak(30);
      pdf.setFontSize(16);
      pdf.setTextColor(31, 41, 55);
      pdf.text('Methodology & Data Sources', margin, yPosition);
      yPosition += 15;

      const citations = ReportTemplates.generateCitations(data);
      addWrappedText(citations, 10, [107, 114, 128]);

      // Footer on each page
      const totalPages = pdf.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(9);
        pdf.setTextColor(107, 114, 128);
        pdf.text(`Page ${i} of ${totalPages}`, pageWidth - margin - 20, pageHeight - 10);
        pdf.text(`AI Visibility Intelligence Report - ${data.companyName}`, margin, pageHeight - 10);
      }

      // Generate filename
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `${data.companyName.replace(/\s+/g, '_')}_${options.type}_intelligence_report_${timestamp}.pdf`;

      // Download the PDF
      pdf.save(filename);

      toast({
        title: "Intelligence Report Generated",
        description: `Your comprehensive ${options.type === 'complete' ? 'AI visibility' : 'content gap'} analysis report has been downloaded successfully.`,
      });

    } catch (error) {
      console.error('Error generating report:', error);
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
    generateReport,
    isGenerating
  };
};
