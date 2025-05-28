import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "./MetricCard";
import { DashboardMetrics, SentimentTrendData, CitationCount } from "@/types/dashboard";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, FileText, MessageSquare, BarChart3, Target } from 'lucide-react';

interface OverviewTabProps {
  metrics: DashboardMetrics;
  sentimentTrend: SentimentTrendData[];
  topCitations: CitationCount[];
}

export const OverviewTab = ({ metrics, sentimentTrend, topCitations }: OverviewTabProps) => {
  const getFavicon = (domain: string): string => {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  };

  return (
    <div className="space-y-8">
      {/* Metrics Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Average Sentiment"
          value={metrics.averageSentiment.toFixed(2)}
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
          value={`${metrics.averageVisibility.toFixed(1)}%`}
          subtitle="Company mention prominence"
          icon={Target}
          iconColor="text-blue-500"
        />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-8 lg:grid-cols-2">
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
            <CardTitle className="text-lg font-semibold">Top Cited Domains</CardTitle>
            <CardDescription className="text-sm text-gray-600">
              The domains that are most frequently cited in your responses
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {topCitations.length > 0 ? (
                topCitations.map((citation, index) => (
                  <div key={index} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 bg-gray-50/50 hover:bg-gray-100/80 transition-colors">
                    <div className="flex items-center space-x-3">
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
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {citation.domain}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-gray-600 bg-white px-3 py-1 rounded-full border border-gray-200 flex-shrink-0">
                      {citation.count}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-sm">No citations found yet.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
