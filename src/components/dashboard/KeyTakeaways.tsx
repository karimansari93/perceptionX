import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardMetrics, CitationCount } from "@/types/dashboard";
import { Badge } from "@/components/ui/badge";

interface KeyTakeawaysProps {
  metrics: DashboardMetrics;
  topCompetitors: { company: string; count: number }[];
  topCitations: CitationCount[];
}

export const KeyTakeaways = ({ metrics, topCompetitors, topCitations }: KeyTakeawaysProps) => {
  // Calculate key insights
  const getBrandPerceptionInsight = () => {
    if (topCitations.length === 0) {
      return {
        text: "No sources found influencing your brand perception",
        type: "negative",
        action: "Add more sources to improve brand visibility"
      };
    }
    
    const topSource = topCitations[0];
    const secondSource = topCitations[1];
    
    return {
      text: `${topSource.domain} is your primary brand perception source`,
      type: "positive",
      action: secondSource ? 
        `Consider optimizing content from ${secondSource.domain} as your secondary source` :
        "Focus on diversifying your brand perception sources"
    };
  };

  const getCompetitiveInsight = () => {
    if (topCompetitors.length === 0) {
      return {
        text: "No significant competitor mentions detected",
        type: "neutral",
        action: "Monitor competitor mentions to understand market positioning"
      };
    }
    
    const topCompetitor = topCompetitors[0];
    const secondCompetitor = topCompetitors[1];
    
    return {
      text: `${topCompetitor.company} is most frequently compared to your brand`,
      type: "warning",
      action: secondCompetitor ? 
        `Also monitor mentions of ${secondCompetitor.company} as a secondary competitor` :
        "Focus on differentiating from this primary competitor"
    };
  };

  const getPositiveThemesInsight = () => {
    const total = metrics.totalResponses || 1;
    const positivePct = (metrics.positiveCount / total) * 100;
    
    if (positivePct >= 60) {
      return {
        text: `${Math.round(positivePct)}% of responses highlight positive brand attributes`,
        type: "positive",
        action: "Leverage these positive themes in your marketing and employer branding"
      };
    } else if (positivePct >= 40) {
      return {
        text: `${Math.round(positivePct)}% of responses show positive brand perception`,
        type: "neutral",
        action: "Identify and amplify your strongest positive themes"
      };
    }
    return {
      text: `${Math.round(positivePct)}% of responses indicate positive brand perception`,
      type: "negative",
      action: "Focus on developing and promoting key positive differentiators"
    };
  };

  const getVisibilityInsight = () => {
    // Get visibility score from metrics
    const visibilityScore = metrics.averageVisibility;
    
    if (visibilityScore === 0) {
      return {
        text: "No visibility in industry conversations",
        type: "negative",
        action: "Create content focused on key industry topics to improve visibility"
      };
    } else if (visibilityScore < 40) {
      return {
        text: `Low visibility (${Math.round(visibilityScore)}%) in industry conversations`,
        type: "negative",
        action: "Prioritize content creation and optimization for key industry topics"
      };
    } else if (visibilityScore < 70) {
      return {
        text: `Moderate visibility (${Math.round(visibilityScore)}%) in industry conversations`,
        type: "neutral",
        action: "Focus on improving content visibility for key industry topics"
      };
    }
    return {
      text: `Strong visibility (${Math.round(visibilityScore)}%) in industry conversations`,
      type: "positive",
      action: "Maintain high visibility and continue optimizing content for key topics"
    };
  };

  const insights = [
    getBrandPerceptionInsight(),
    getCompetitiveInsight(),
    getPositiveThemesInsight(),
    getVisibilityInsight()
  ];

  return (
    <Card className="shadow-sm border border-gray-200 h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold">Key Takeaways</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          {insights.map((insight, index) => (
            <div key={index} className="flex flex-col gap-2 p-3 rounded-lg bg-gray-50">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{insight.text}</p>
                </div>
                <Badge 
                  variant="secondary"
                  className={`shrink-0 ${
                    insight.type === 'positive' ? 'bg-green-100 text-green-800' :
                    insight.type === 'negative' ? 'bg-red-100 text-red-800' :
                    insight.type === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-blue-100 text-blue-800'
                  }`}
                >
                  {insight.type.charAt(0).toUpperCase() + insight.type.slice(1)}
                </Badge>
              </div>
              <p className="text-xs text-gray-600">{insight.action}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}; 