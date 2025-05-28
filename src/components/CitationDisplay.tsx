
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EnhancedCitation } from "@/utils/citationUtils";

interface CitationDisplayProps {
  citation: EnhancedCitation;
  showType?: boolean;
  size?: 'sm' | 'md';
}

export const CitationDisplay = ({ citation, showType = false, size = 'md' }: CitationDisplayProps) => {
  const isSmall = size === 'sm';
  
  const content = (
    <div className={`flex items-center space-x-2 ${isSmall ? 'text-xs' : 'text-sm'}`}>
      <img 
        src={citation.favicon} 
        alt={`${citation.domain} favicon`}
        className={`${isSmall ? 'w-3 h-3' : 'w-4 h-4'} flex-shrink-0`}
        onError={(e) => {
          // Fallback to a colored dot if favicon fails to load
          e.currentTarget.style.display = 'none';
          const fallback = e.currentTarget.nextElementSibling as HTMLElement;
          if (fallback) fallback.style.display = 'flex';
        }}
      />
      <div 
        className={`${isSmall ? 'w-3 h-3' : 'w-4 h-4'} bg-blue-100 rounded flex items-center justify-center flex-shrink-0`}
        style={{ display: 'none' }}
      >
        <span className={`${isSmall ? 'text-[8px]' : 'text-xs'} font-medium text-blue-600`}>
          {citation.domain?.charAt(0)?.toUpperCase() || 'U'}
        </span>
      </div>
      
      <span className={`font-medium ${isSmall ? 'max-w-[120px]' : 'max-w-[200px]'} truncate`}>
        {citation.title || citation.domain}
      </span>
      
      {citation.url && (
        <ExternalLink className={`${isSmall ? 'w-2 h-2' : 'w-3 h-3'} flex-shrink-0`} />
      )}
    </div>
  );
  
  if (citation.url) {
    return (
      <div className="flex items-center space-x-2">
        <a 
          href={citation.url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 flex items-center"
        >
          {content}
        </a>
        {showType && (
          <Badge variant="outline" className="text-xs">
            Website
          </Badge>
        )}
      </div>
    );
  }
  
  return (
    <div className="flex items-center space-x-2">
      <div className="text-gray-700">
        {content}
      </div>
      {showType && (
        <Badge variant="outline" className="text-xs">
          Inferred
        </Badge>
      )}
    </div>
  );
};
