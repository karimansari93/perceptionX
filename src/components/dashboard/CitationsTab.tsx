
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PromptResponse } from "@/types/dashboard";
import { CitationDisplay } from "@/components/CitationDisplay";
import { enhanceCitations, EnhancedCitation } from "@/utils/citationUtils";

interface CitationsTabProps {
  responses: PromptResponse[];
  parseCitations: (citations: any) => any[];
}

export const CitationsTab = ({ responses, parseCitations }: CitationsTabProps) => {
  // Create enhanced citations from all responses and count them
  const allEnhancedCitations = responses.flatMap(r => 
    enhanceCitations(parseCitations(r.citations))
  );

  // Count citations by domain
  const citationCounts = allEnhancedCitations.reduce((acc: any, citation: EnhancedCitation) => {
    const domain = citation.domain;
    if (domain) {
      acc[domain] = (acc[domain] || 0) + 1;
    }
    return acc;
  }, {});

  // Convert to array and sort by count (descending)
  const allCitations = Object.entries(citationCounts)
    .map(([domain, count]) => ({ domain, count: count as number }))
    .sort((a, b) => b.count - a.count);

  const getCitationByDomain = (domain: string): EnhancedCitation | undefined => {
    return allEnhancedCitations.find(c => c.domain === domain);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>All Citations</CardTitle>
        <CardDescription>
          Sources referenced in AI responses ({allCitations.length} unique sources)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-4 font-medium text-gray-700">Source</th>
                <th className="text-left p-4 font-medium text-gray-700">Citations</th>
                <th className="text-left p-4 font-medium text-gray-700">Type</th>
                <th className="text-left p-4 font-medium text-gray-700">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {allCitations.map((citation, index) => {
                const enhancedCitation = getCitationByDomain(citation.domain);
                
                return (
                  <tr key={index} className="border-t hover:bg-gray-50">
                    <td className="p-4">
                      {enhancedCitation ? (
                        <CitationDisplay citation={enhancedCitation} />
                      ) : (
                        <div className="flex items-center space-x-2">
                          <div className="w-4 h-4 bg-gray-100 rounded flex items-center justify-center">
                            <span className="text-xs font-medium text-gray-600">
                              {citation.domain?.charAt(0)?.toUpperCase() || 'U'}
                            </span>
                          </div>
                          <span className="text-sm font-medium">{citation.domain}</span>
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-sm">{citation.count}</td>
                    <td className="p-4">
                      <Badge variant="outline">
                        {enhancedCitation?.type === 'website' ? 'Website' : 'Inferred'}
                      </Badge>
                    </td>
                    <td className="p-4 text-sm text-gray-600">
                      {new Date().toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          
          {allCitations.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <p>No citations found in responses yet.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
