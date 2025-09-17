# Company Report Feature

This document describes the new company report functionality added to the admin panel, which allows administrators to generate AI-powered reports about companies and compare them against each other.

## Overview

The company report feature provides comprehensive analysis of company data including:
- Sentiment analysis across all AI models
- Visibility and competitive positioning metrics
- Thematic analysis using AI-powered theme extraction
- Competitor mention analysis
- AI model performance comparison
- Actionable insights and recommendations

## Features

### Single Company Reports
- Generate detailed reports for individual companies
- Analyze all available data including prompt responses, themes, and metrics
- Get AI-generated insights and recommendations
- View performance across different AI models

### Company Comparison Reports
- Compare multiple companies side-by-side
- Identify best performing companies in different metrics
- Generate competitive analysis insights
- Highlight areas for improvement

## Architecture

### Backend Components

#### Edge Function: `company-report`
- **Location**: `supabase/functions/company-report/`
- **Purpose**: Generates AI-powered company reports
- **Features**:
  - Single company analysis
  - Multi-company comparison
  - AI insights generation using OpenAI
  - Comprehensive data aggregation

#### Database Permissions
- **Migration**: `20250108000002_add_admin_company_report_permissions.sql`
- **Purpose**: Grants admin access to all company data
- **Security**: Uses admin email whitelist for access control

### Frontend Components

#### Company Report Service
- **Location**: `src/services/companyReportService.ts`
- **Purpose**: Handles API calls to the edge function
- **Methods**:
  - `generateCompanyReport()` - Single company analysis
  - `generateComparisonReport()` - Multi-company comparison
  - `getAvailableCompanies()` - Fetch all companies
  - `getCompanyData()` - Get specific company details

#### Company Report Types
- **Location**: `src/types/companyReport.ts`
- **Purpose**: TypeScript interfaces for type safety
- **Key Interfaces**:
  - `CompanyReportData` - Single company report structure
  - `ComparisonData` - Multi-company comparison structure
  - `ThemeData` - AI theme analysis data
  - `CompetitorMention` - Competitor analysis data

#### Admin Panel Integration
- **Location**: `src/pages/Admin.tsx`
- **Changes**: Added tab navigation for reports
- **Features**: Seamless integration with existing admin functionality

#### Company Report Tab Component
- **Location**: `src/components/admin/CompanyReportTab.tsx`
- **Purpose**: UI for generating and viewing reports
- **Features**:
  - Company selection interface
  - Report type selection (single/comparison)
  - Comprehensive report display
  - Interactive data visualization

## Usage

### Accessing Company Reports

1. Navigate to the Admin Panel
2. Click on the "Company Reports" tab
3. Select report type:
   - **Single Company**: Analyze one company in detail
   - **Compare Companies**: Compare multiple companies

### Generating a Single Company Report

1. Select "Single Company" report type
2. Choose a company from the list
3. Click "Generate Report"
4. View comprehensive analysis including:
   - Company overview metrics
   - Key insights and recommendations
   - Top themes and sentiment analysis
   - Competitor mentions
   - AI model performance

### Generating a Comparison Report

1. Select "Compare Companies" report type
2. Choose 2 or more companies from the list
3. Click "Generate Report"
4. View comparative analysis including:
   - Best performing companies
   - Competitive insights
   - Individual company breakdowns
   - Areas for improvement

## Data Sources

The reports analyze data from multiple sources:

### Core Data
- **User Onboarding**: Company name, industry, basic info
- **Prompt Responses**: AI model responses, sentiment scores
- **AI Themes**: AI-analyzed themes and attributes
- **Search Insights**: Search analysis data (if available)

### Metrics Calculated
- **Average Sentiment**: Overall sentiment across all responses
- **Visibility Score**: Company mention positioning in responses
- **Competitive Position**: Ranking compared to competitors
- **Theme Frequency**: How often specific themes appear
- **Model Performance**: Individual AI model effectiveness

## AI Integration

### OpenAI Integration
- Uses GPT-4o-mini for generating insights and recommendations
- Analyzes company data to provide actionable advice
- Generates competitive analysis and comparison insights

### Theme Analysis
- Leverages existing AI thematic analysis system
- Maps themes to TalentX attributes
- Provides confidence scores and sentiment analysis

## Security

### Admin Access Control
- Only users with admin emails can access company reports
- Admin emails are whitelisted in the database function
- All data access is controlled through RLS policies

### Data Privacy
- Reports only show aggregated and anonymized data
- No sensitive user information is exposed
- All data access is logged and auditable

## Deployment

### Edge Function Deployment
```bash
# Deploy the company report edge function
supabase functions deploy company-report

# Apply database migrations
supabase db push
```

### Environment Variables
Ensure the following environment variables are set:
- `OPENAI_API_KEY` - For AI insights generation
- `SUPABASE_URL` - Database connection
- `SUPABASE_SERVICE_ROLE_KEY` - Service role access

## Future Enhancements

### Planned Features
- Export reports to PDF/Excel
- Scheduled report generation
- Email report delivery
- Custom report templates
- Historical trend analysis
- Advanced filtering options

### Potential Improvements
- Real-time report updates
- Interactive data visualizations
- Custom metric definitions
- Integration with external data sources
- Automated alerting for significant changes

## Troubleshooting

### Common Issues

1. **No companies available**: Ensure users have completed onboarding
2. **Report generation fails**: Check OpenAI API key and rate limits
3. **Permission denied**: Verify admin email is in whitelist
4. **Empty reports**: Ensure companies have generated responses

### Debug Steps

1. Check browser console for errors
2. Verify edge function logs in Supabase dashboard
3. Confirm database permissions are applied
4. Test with a company that has known data

## Support

For issues or questions about the company report feature:
1. Check the admin panel logs
2. Review edge function execution logs
3. Verify database permissions
4. Contact the development team
