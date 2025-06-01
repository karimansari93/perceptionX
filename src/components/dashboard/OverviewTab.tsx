import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "./MetricCard";
import { DashboardMetrics, SentimentTrendData, CitationCount } from "@/types/dashboard";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, FileText, MessageSquare, BarChart3, Target } from 'lucide-react';

interface OverviewTabProps {
  metrics: DashboardMetrics;
  sentimentTrend: SentimentTrendData[];
  topCitations: CitationCount[];
  popularThemes: { name: string; count: number; sentiment: 'positive' | 'neutral' | 'negative' }[];
}

export const OverviewTab = ({ metrics, sentimentTrend, topCitations, popularThemes }: OverviewTabProps) => {
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
            <CardTitle className="text-lg font-semibold">Sentiment Trend</CardTitle>
            <CardDescription className="text-sm text-gray-600">
              Daily sentiment scores over time
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sentimentTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis 
                    dataKey="date" 
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#6b7280' }}
                  />
                  <YAxis 
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    domain={[-1, 1]}
                    tick={{ fill: '#6b7280' }}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="sentiment" 
                    stroke="#3b82f6" 
                    strokeWidth={3}
                    dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, stroke: '#3b82f6', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

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
                      const barWidth = Math.max(20, (citation.count / maxCount) * 100); // min 20% width for visibility
                      return (
                        <div
                          key={index}
                          className={`relative flex items-center justify-between px-2 py-1 rounded-xl transition-colors cursor-default overflow-hidden`}
                          style={{ minHeight: '44px' }}
                        >
                          {/* Bar background */}
                          <div
                            className="absolute left-0 top-0 h-full z-0 rounded-xl"
                            style={{
                              width: `calc(${barWidth}% - 48px)`, // leave space for the number
                              maxWidth: `calc(100% - 48px)`,
                              minWidth: 0,
                              background: isTop ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.10)',
                              transition: 'width 0.3s',
                              right: '48px',
                            }}
                          />
                          {/* Row content */}
                          <div className="flex items-center space-x-3 z-10">
                            <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${isTop ? 'bg-white border-2 border-blue-300' : 'bg-white border border-blue-100'}`}> 
                              <img
                                src={getFavicon(citation.domain)}
                                alt={`${citation.domain} favicon`}
                                className="w-5 h-5 flex-shrink-0 rounded"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                                  if (fallback) fallback.style.display = 'flex';
                                }}
                              />
                              <div
                                className="w-5 h-5 bg-blue-100 rounded flex items-center justify-center flex-shrink-0"
                                style={{ display: 'none' }}
                              >
                                <span className="text-xs font-medium text-blue-600">
                                  {citation.domain?.charAt(0)?.toUpperCase() || 'U'}
                                </span>
                              </div>
                            </div>
                            <span className={`text-base font-medium truncate ${isTop ? 'text-blue-900' : 'text-gray-900'}`}>{citation.domain}</span>
                          </div>
                          <span className={`text-base font-semibold ml-2 z-10`}>
                            {citation.count}
                          </span>
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

        <Card className="shadow-sm border border-gray-200">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">Popular Workplace Themes</CardTitle>
            <CardDescription className="text-sm text-gray-600">
              Most frequently mentioned workplace themes in AI responses
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
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
