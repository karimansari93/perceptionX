import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "./MetricCard";
import { DashboardMetrics, CitationCount } from "@/types/dashboard";
import { TrendingUp, FileText, MessageSquare, BarChart3, Target } from 'lucide-react';

interface OverviewTabProps {
  metrics: DashboardMetrics;
  topCitations: CitationCount[];
  popularThemes: { name: string; count: number; sentiment: 'positive' | 'neutral' | 'negative' }[];
  topCompetitors: { company: string; count: number }[];
}

export const OverviewTab = ({ metrics, topCitations, popularThemes, topCompetitors }: OverviewTabProps) => {
  const getFavicon = (domain: string): string => {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  };

  return (
    <div className="space-y-8">
      {/* Metrics Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Average Sentiment"
          value={`${Math.round(metrics.averageSentiment * 100)}%`}
          subtitle={metrics.sentimentLabel}
          icon={TrendingUp}
          iconColor={metrics.averageSentiment > 0 ? "text-green-500" : metrics.averageSentiment < 0 ? "text-red-500" : "text-gray-500"}
          trend={metrics.sentimentTrendComparison}
        />
        <MetricCard
          title="Total Citations"
          value={metrics.totalCitations.toString()}
          subtitle={`${metrics.uniqueDomains} unique domains`}
          icon={FileText}
          iconColor="text-blue-500"
        />
        <MetricCard
          title="Total Responses"
          value={metrics.totalResponses.toString()}
          subtitle="AI responses analyzed"
          icon={MessageSquare}
          iconColor="text-purple-500"
        />
        <MetricCard
          title="Average Visibility"
          value={`${Math.round(metrics.averageVisibility)}%`}
          subtitle="Company mention prominence"
          icon={Target}
          iconColor="text-blue-500"
        />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-8 lg:grid-cols-3">
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
                    topCitations.map((citation, index) => {
                      const isTop = index === 0;
                      const barWidth = Math.max(20, (citation.count / maxCount) * 100);
                      return (
                        <div key={citation.domain} className="flex items-center space-x-3">
                          <img
                            src={getFavicon(citation.domain)}
                            alt=""
                            className="w-4 h-4"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://www.google.com/s2/favicons?domain=example.com&sz=16';
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">
                              {citation.domain}
                            </div>
                            <div className="w-full rounded-full h-2">
                              <div
                                className={`h-2 rounded-full bg-[#db5f89]/30`}
                                style={{ width: `${barWidth}%` }}
                              />
                            </div>
                          </div>
                          <div className="text-sm font-medium text-gray-900">
                            {citation.count}
                          </div>
                        </div>
                      );
                    })
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

        {/* Competitor Mentions Card */}
        <Card className="shadow-sm border border-gray-200">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">Competitor Mentions</CardTitle>
            <CardDescription className="text-sm text-gray-600">
              The competitors most frequently mentioned in AI responses
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b">
                    <th className="py-1 pr-2 text-left font-medium">#</th>
                    <th className="py-1 pr-2 text-left font-medium">Competitor</th>
                    <th className="py-1 px-2 text-center font-medium">% </th>
                    <th className="py-1 px-2 text-right font-medium">Mentions</th>
                  </tr>
                </thead>
                <tbody>
                  {topCompetitors.length > 0 ? (
                    topCompetitors.map((comp, idx) => (
                      <tr key={comp.company} className="border-b last:border-0">
                        <td className="py-1 pr-2 text-gray-700 font-semibold">{idx + 1}</td>
                        <td className="py-1 pr-2">
                          <span className="font-medium text-gray-900">{comp.company}</span>
                        </td>
                        <td className="py-1 px-2 text-center text-gray-500">– 0%</td>
                        <td className="py-1 px-2 text-right">
                          <span className="inline-block bg-[#db5f89]/20 rounded-full px-3 py-1 font-semibold text-gray-800 text-sm">
                            {comp.count}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="text-center py-6 text-gray-400">No competitor mentions found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border border-gray-200">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">Popular Workplace Themes</CardTitle>
            <CardDescription className="text-sm text-gray-600">
              Most frequently mentioned themes in AI responses
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {popularThemes.length > 0 ? (
                popularThemes.map((theme, idx) => (
                  <div key={theme.name} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 bg-green-50/50 hover:bg-green-100/80 transition-colors">
                    <div className="flex items-center space-x-3">
                      <span className="text-base font-medium text-green-900 capitalize">{theme.name}</span>
                      <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                        theme.sentiment === 'positive' ? 'bg-green-100 text-green-800' :
                        theme.sentiment === 'negative' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {theme.sentiment}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-gray-600 bg-white px-3 py-1 rounded-full border border-gray-200 flex-shrink-0">
                      {theme.count}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <BarChart3 className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-sm">No workplace themes found yet.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
