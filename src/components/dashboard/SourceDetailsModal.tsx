import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResponseItem } from "./ResponseItem";
import { CitationCount } from "@/types/dashboard";
import { ExternalLink } from "lucide-react";

interface SourceDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  source: CitationCount;
  responses: any[];
}

export const SourceDetailsModal = ({ isOpen, onClose, source, responses }: SourceDetailsModalProps) => {
  const getFavicon = (domain: string): string => {
    return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=32`;
  };

  const parseAndEnhanceCitations = (citations: any) => {
    if (!citations) return [];
    try {
      const parsed = typeof citations === 'string' ? JSON.parse(citations) : citations;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const truncateText = (text: string, maxLength: number = 150) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  const getSentimentColor = (sentimentScore: number | null) => {
    if (!sentimentScore) return 'text-gray-600';
    if (sentimentScore > 0.1) return 'text-green-600';
    if (sentimentScore < -0.1) return 'text-red-600';
    return 'text-gray-600';
  };

  const getSentimentBgColor = (sentimentScore: number | null) => {
    if (!sentimentScore) return 'bg-gray-100';
    if (sentimentScore > 0.1) return 'bg-green-100';
    if (sentimentScore < -0.1) return 'bg-red-100';
    return 'bg-gray-100';
  };

  // Get all unique URLs for this domain
  const getUniqueUrls = () => {
    const urls = new Set<string>();
    responses.forEach(response => {
      try {
        const citations = parseAndEnhanceCitations(response.citations);
        citations.forEach(citation => {
          if (citation.domain === source.domain && citation.url) {
            urls.add(citation.url);
          }
        });
      } catch {
        // Skip invalid citations
      }
    });
    return Array.from(urls);
  };

  const uniqueUrls = getUniqueUrls();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src={getFavicon(source.domain)} alt="" className="w-5 h-5 object-contain" />
            <span>{source.domain}</span>
            <Badge variant="secondary">{source.count} citations</Badge>
          </DialogTitle>
          <DialogDescription className="text-gray-600">
            Detailed analysis of this data source and its impact on your perception
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[calc(90vh-8rem)]">
          <div className="space-y-6 pr-4">
            {/* Source Overview */}
            <Card>
              <CardHeader>
                <CardTitle>Source Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Domain</p>
                    <p className="font-medium">{source.domain}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Total Citations</p>
                    <p className="font-medium">{source.count}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* URLs List */}
            <Card>
              <CardHeader>
                <CardTitle>Source URLs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {uniqueUrls.map((url, index) => (
                    <a
                      key={index}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 transition-colors group"
                    >
                      <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-blue-500" />
                      <span className="text-sm text-blue-600 group-hover:text-blue-700 truncate">
                        {url}
                      </span>
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}; 