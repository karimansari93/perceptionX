
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VisibilityMetrics } from "@/types/dashboard";
import { Eye, TrendingUp, Users, Trophy } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface VisibilityTabProps {
  visibilityMetrics: VisibilityMetrics;
  companyName: string;
}

export const VisibilityTab = ({ visibilityMetrics, companyName }: VisibilityTabProps) => {
  const competitorData = Object.entries(visibilityMetrics.competitorCounts).map(([company, count]) => ({
    company,
    mentions: count
  })).sort((a, b) => b.mentions - a.mentions);

  const getMentionRateColor = (rate: number) => {
    if (rate >= 70) return 'text-green-600';
    if (rate >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getRankingColor = (ranking: number | null) => {
    if (!ranking) return 'text-gray-600';
    if (ranking <= 3) return 'text-green-600';
    if (ranking <= 5) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      {/* Mention Rate */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Mention Rate</CardTitle>
          <Eye className="h-4 w-4 text-blue-600" />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${getMentionRateColor(visibilityMetrics.mentionRate)}`}>
            {visibilityMetrics.mentionRate.toFixed(1)}%
          </div>
          <p className="text-xs text-muted-foreground">
            of visibility prompts mention {companyName}
          </p>
        </CardContent>
      </Card>

      {/* Average Ranking */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Average Ranking</CardTitle>
          <Trophy className="h-4 w-4 text-yellow-600" />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${getRankingColor(visibilityMetrics.averageRanking)}`}>
            {visibilityMetrics.averageRanking ? `#${visibilityMetrics.averageRanking.toFixed(1)}` : 'N/A'}
          </div>
          <p className="text-xs text-muted-foreground">
            position when mentioned
          </p>
        </CardContent>
      </Card>

      {/* Total Prompts */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Visibility Prompts</CardTitle>
          <TrendingUp className="h-4 w-4 text-purple-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {visibilityMetrics.totalVisibilityPrompts}
          </div>
          <p className="text-xs text-muted-foreground">
            tracked for visibility
          </p>
        </CardContent>
      </Card>

      {/* Competitor Count */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Competitors Tracked</CardTitle>
          <Users className="h-4 w-4 text-orange-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {Object.keys(visibilityMetrics.competitorCounts).length}
          </div>
          <p className="text-xs text-muted-foreground">
            companies mentioned
          </p>
        </CardContent>
      </Card>

      {/* Competitor Mentions Chart */}
      <Card className="md:col-span-2 lg:col-span-4">
        <CardHeader>
          <CardTitle>Competitor Mentions</CardTitle>
          <CardDescription>
            How often competitors are mentioned in AI responses compared to {companyName}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {competitorData.length > 0 ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={competitorData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="company" 
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    angle={-45}
                    textAnchor="end"
                    height={100}
                  />
                  <YAxis 
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip />
                  <Bar 
                    dataKey="mentions" 
                    fill="#8884d8"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p>No competitor mentions tracked yet.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Visibility Insights */}
      <Card className="md:col-span-2 lg:col-span-4">
        <CardHeader>
          <CardTitle>Visibility Insights</CardTitle>
          <CardDescription>
            Key takeaways from your visibility monitoring
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {visibilityMetrics.mentionRate > 0 ? (
              <div className="flex items-center space-x-2">
                <Badge variant={visibilityMetrics.mentionRate >= 50 ? "default" : "secondary"}>
                  {visibilityMetrics.mentionRate >= 50 ? "Strong" : "Moderate"} Visibility
                </Badge>
                <span className="text-sm text-gray-600">
                  {companyName} is mentioned in {visibilityMetrics.mentionRate.toFixed(1)}% of relevant industry discussions
                </span>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <Badge variant="outline">Low Visibility</Badge>
                <span className="text-sm text-gray-600">
                  {companyName} needs more presence in industry discussions
                </span>
              </div>
            )}

            {visibilityMetrics.averageRanking && (
              <div className="flex items-center space-x-2">
                <Badge variant={visibilityMetrics.averageRanking <= 3 ? "default" : "secondary"}>
                  Ranking #{visibilityMetrics.averageRanking.toFixed(1)}
                </Badge>
                <span className="text-sm text-gray-600">
                  Average position when mentioned in AI responses
                </span>
              </div>
            )}

            {Object.keys(visibilityMetrics.competitorCounts).length > 0 && (
              <div className="flex items-center space-x-2">
                <Badge variant="outline">Competitive Landscape</Badge>
                <span className="text-sm text-gray-600">
                  Tracking against {Object.keys(visibilityMetrics.competitorCounts).length} competitors in the market
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
