import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardMetrics, CitationCount } from "@/types/dashboard";
import { Badge } from "@/components/ui/badge";

interface KeyTakeawaysProps {
  metrics: DashboardMetrics;
  topCompetitors: { company: string; count: number }[];
  topCitations: CitationCount[];
  themesBySentiment: {
    positive: string[];
    neutral: string[];
    negative: string[];
  };
}

interface BaseInsight {
  text: string;
  type: string;
  action: string;
}

interface InsightWithSources extends BaseInsight {
  sources: CitationCount[];
}

interface InsightWithCompetitor extends BaseInsight {
  competitor: string;
}

interface InsightWithThemes extends BaseInsight {
  themes: { theme: string; sentiment: 'positive' | 'neutral' | 'negative' }[];
}

type Insight = BaseInsight | InsightWithSources | InsightWithCompetitor | InsightWithThemes;

export const KeyTakeaways = ({ metrics, topCompetitors, topCitations, themesBySentiment = { positive: [], neutral: [], negative: [] } }: KeyTakeawaysProps) => {
  // Helper to get favicon for a domain
  const getFavicon = (domain: string): string => {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  };

  // Helper to format domain to a human-friendly name
  const getSourceDisplayName = (domain: string) => {
    // Remove www. and domain extension
    let name = domain.replace(/^www\./, "");
    name = name.replace(/\.(com|org|net|io|co|edu|gov|info|biz|us|uk|ca|au|in|de|fr|jp|ru|ch|it|nl|se|no|es|mil|tv|me|ai|ly|app|site|online|tech|dev|xyz|pro|club|store|blog|io|co|us|ca|uk|au|in|de|fr|jp|ru|ch|it|nl|se|no|es|mil|tv|me|ai|ly|app|site|online|tech|dev|xyz|pro|club|store|blog)(\.[a-z]{2})?$/, "");
    // Capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  // Calculate key insights
  const getBrandPerceptionInsight = (): InsightWithSources => {
    if (topCitations.length === 0) {
      return {
        text: "No sources found influencing your brand perception",
        type: "negative",
        action: "Add more sources to improve brand visibility",
        sources: []
      };
    }
    
    const topSource = topCitations[0];
    const secondSource = topCitations[1];
    
    const sources = [topSource];
    if (secondSource) {
      sources.push(secondSource);
    }
    
    return {
      text: `${getSourceDisplayName(topSource.domain)} is your primary brand perception source`,
      type: "positive",
      action: secondSource ? 
        `Consider optimizing content from ${getSourceDisplayName(secondSource.domain)} as your secondary source` :
        "Focus on diversifying your brand perception sources",
      sources
    };
  };

  const getCompetitiveInsight = (): InsightWithCompetitor => {
    if (topCompetitors.length === 0) {
      return {
        text: "No significant competitor mentions detected",
        type: "neutral",
        action: "Monitor competitor mentions to understand market positioning",
        competitor: ""
      };
    }
    
    const topCompetitor = topCompetitors[0];
    const secondCompetitor = topCompetitors[1];
    
    return {
      text: `${topCompetitor.company} is most frequently compared to your brand`,
      type: "warning",
      action: secondCompetitor ? 
        `Also monitor mentions of ${secondCompetitor.company} as a secondary competitor` :
        "Focus on differentiating from this primary competitor",
      competitor: topCompetitor.company
    };
  };

  const getPositiveThemesInsight = (): InsightWithThemes => {
    const total = metrics.totalResponses || 1;
    const positivePct = (metrics.positiveCount / total) * 100;

    // Gather up to 5 themes, prioritizing positive, then neutral, then negative
    const themes: { theme: string; sentiment: 'positive' | 'neutral' | 'negative' }[] = [];
    const addThemes = (arr: string[], sentiment: 'positive' | 'neutral' | 'negative') => {
      arr.forEach((theme) => {
        if (themes.length < 5) themes.push({ theme, sentiment });
      });
    };
    addThemes(themesBySentiment.positive, 'positive');
    addThemes(themesBySentiment.neutral, 'neutral');
    addThemes(themesBySentiment.negative, 'negative');

    let text = 'Key themes in responses:';
    if (themes.length === 0) text = 'No key themes detected in responses';

    return {
      text,
      type: positivePct >= 60 ? 'positive' : positivePct >= 40 ? 'neutral' : 'negative',
      action:
        themes.length > 0
          ? 'Focus on amplifying positive themes and addressing negative ones.'
          : 'Encourage more feedback to surface key themes.',
      themes,
    };
  };

  const getVisibilityInsight = (): BaseInsight => {
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

  const insights: Insight[] = [
    getBrandPerceptionInsight(),
    getCompetitiveInsight(),
    getVisibilityInsight()
  ];

  return (
    <Card className="shadow-sm border border-gray-200 h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold">Key Takeaways</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          {insights.map((insight, index) => {
            const isEmpty = insight.text.startsWith('No ');
            const hasSources = 'sources' in insight && insight.sources && insight.sources.length > 0;
            const hasCompetitor = 'competitor' in insight && insight.competitor && insight.competitor.length > 0;
            const hasThemes = 'themes' in insight && insight.themes && insight.themes.length > 0;
            
            return (
              <div
                key={index}
                className={`flex flex-col gap-3 p-4 rounded-lg bg-gray-50/80 hover:bg-gray-100/80 transition-colors duration-200 ${isEmpty ? 'py-3' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    {hasSources ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900 leading-relaxed">
                            {insight.text.split(getSourceDisplayName(insight.sources[0].domain))[0]}
                          </span>
                          <Badge 
                            variant="outline" 
                            className="flex items-center gap-1.5 bg-white/80 border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <img 
                              src={getFavicon(insight.sources[0].domain)} 
                              alt="" 
                              className="w-3 h-3 flex-shrink-0" 
                            />
                            <span className="text-xs font-medium">
                              {insight.sources[0].domain}
                            </span>
                          </Badge>
                          <span className="text-sm font-medium text-gray-900 leading-relaxed">
                            {insight.text.split(getSourceDisplayName(insight.sources[0].domain))[1]}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed ml-0">{insight.action}</p>
                      </div>
                    ) : hasCompetitor ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900 leading-relaxed">
                            {insight.text.split(insight.competitor)[0]}
                          </span>
                          <Badge 
                            variant="outline" 
                            className="flex items-center gap-1.5 bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors"
                          >
                            <span className="text-xs font-medium">
                              {insight.competitor}
                            </span>
                          </Badge>
                          <span className="text-sm font-medium text-gray-900 leading-relaxed">
                            {insight.text.split(insight.competitor)[1]}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed ml-0">{insight.action}</p>
                      </div>
                    ) : hasThemes ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900 leading-relaxed">
                            {insight.text}
                          </span>
                          {insight.themes.map((t, i) => (
                            <Badge
                              key={i}
                              className={`text-xs font-medium px-2 py-1 rounded-full border-0 ${
                                t.sentiment === 'positive'
                                  ? 'bg-green-100 text-green-800'
                                  : t.sentiment === 'neutral'
                                  ? 'bg-gray-100 text-gray-700'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {t.theme}
                            </Badge>
                          ))}
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed ml-0">{insight.action}</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <p className={isEmpty ? "text-base font-semibold text-gray-500 m-0 leading-tight" : "text-sm font-medium text-gray-900 leading-relaxed"}>
                          {insight.text}
                        </p>
                        <p className={isEmpty ? "text-xs text-gray-400" : "text-xs text-gray-600 leading-relaxed"}>{insight.action}</p>
                      </div>
                    )}
                  </div>
                  <Badge 
                    variant="secondary"
                    className={`shrink-0 ${
                      insight.type === 'positive' ? 'bg-green-100 text-green-800 border-green-200' :
                      insight.type === 'negative' ? 'bg-red-100 text-red-800 border-red-200' :
                      insight.type === 'warning' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                      'bg-blue-100 text-blue-800 border-blue-200'
                    }`}
                  >
                    {insight.type.charAt(0).toUpperCase() + insight.type.slice(1)}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}; 