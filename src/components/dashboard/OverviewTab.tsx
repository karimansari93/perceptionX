import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "./MetricCard";
import { DashboardMetrics, CitationCount } from "@/types/dashboard";
import { TrendingUp, FileText, MessageSquare, BarChart3, Target } from 'lucide-react';

interface OverviewTabProps {
  metrics: DashboardMetrics;
  topCitations: CitationCount[];
  topCompetitors: { company: string; count: number }[];
}

export const OverviewTab = ({ metrics, topCitations, topCompetitors }: OverviewTabProps) => {
  const getFavicon = (domain: string): string => {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  };

  return (
    <div className="space-y-8">
      {/* Metrics Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Average Sentiment"
          value={
            metrics.sentimentLabel === 'Neutral'
              ? 'Normal'
              : `${Math.round(Math.abs(metrics.averageSentiment * 100))}% ${metrics.sentimentLabel}`
          }
          subtitle={metrics.sentimentLabel === 'Neutral' ? 'Normal' : metrics.sentimentLabel}
          icon={TrendingUp}
          iconColor="text-gray-400"
          trend={metrics.sentimentTrendComparison}
        />
        <MetricCard
          title="Total Citations"
          value={metrics.totalCitations.toString()}
          subtitle={`${metrics.uniqueDomains} unique domains`}
          icon={FileText}
          iconColor="text-gray-400"
        />
        <MetricCard
          title="Total Responses"
          value={metrics.totalResponses.toString()}
          subtitle="AI responses analyzed"
          icon={MessageSquare}
          iconColor="text-gray-400"
        />
        <MetricCard
          title="Average Visibility"
          value={`${Math.round(metrics.averageVisibility)}%`}
          subtitle="Company mention prominence"
          icon={Target}
          iconColor="text-gray-400"
        />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-8 lg:grid-cols-2">
        <Card className="shadow-sm border border-gray-200">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">Information Sources</CardTitle>
            <CardDescription className="text-sm text-gray-600">
              The sources most frequently influencing AI responses about your workplace and culture
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Find the max count for scaling bars */}
            {(() => {
              const maxCount = topCitations.length > 0 ? topCitations[0].count : 1;
              return (
                <div className="space-y-2 max-h-[300px] overflow-y-auto relative">
                  {topCitations.length > 0 ? (
                    topCitations.map((citation, idx) => (
                      <div key={idx} className="flex items-center py-1 hover:bg-gray-50/50 transition-colors">
                        <div className="flex items-center space-x-3 min-w-[200px]">
                          <img src={getFavicon(citation.domain)} alt="" className="w-4 h-4" />
                          <span className="text-sm font-medium text-gray-900">{citation.domain}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-4 inline-flex items-center">
                            <div 
                              className="h-full bg-pink-100 rounded-full transition-all duration-300" 
                              style={{ width: `${(citation.count / maxCount) * 120}px`, minWidth: '12px' }} 
                            />
                            <span className="text-sm font-semibold text-pink-900 ml-2" style={{whiteSpace: 'nowrap'}}>{citation.count}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p className="text-sm">No citations found yet.</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <Card className="shadow-sm border border-gray-200">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">Top Competitors</CardTitle>
            <CardDescription className="text-sm text-gray-600">
              Companies most frequently mentioned alongside your brand
            </CardDescription>
          </CardHeader>
          <CardContent className="relative">
            {/* Match Information Sources bar style for Top Competitors */}
            {(() => {
              const maxCount = topCompetitors.length > 0 ? topCompetitors[0].count : 1;
              return (
                <div className="space-y-2 max-h-[300px] overflow-y-auto relative">
                  {topCompetitors.length > 0 ? (
                    topCompetitors.map((competitor, idx) => (
                      <div key={idx} className="flex items-center py-1 hover:bg-purple-50/50 transition-colors">
                        <div className="flex items-center space-x-3 min-w-[200px]">
                          <span className="text-sm font-medium text-purple-900">{competitor.company}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-4 inline-flex items-center">
                            <div
                              className="h-full bg-purple-200 rounded-full transition-all duration-300"
                              style={{ width: `${(competitor.count / maxCount) * 120}px`, minWidth: '12px' }}
                            />
                            <span className="text-sm font-semibold text-purple-900 ml-2" style={{ whiteSpace: 'nowrap' }}>{competitor.count}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      <Target className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p className="text-sm">No competitor mentions found yet.</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
