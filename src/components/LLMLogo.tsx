import { getLLMLogo } from '@/config/llmLogos';
import { Bot } from 'lucide-react';

interface LLMLogoProps {
  modelName: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showFallback?: boolean;
}

const LLMLogo = ({ 
  modelName, 
  size = 'md', 
  className = '', 
  showFallback = true 
}: LLMLogoProps) => {
  const faviconUrl = getLLMLogo(modelName);
  
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-12 h-12',
  };
  
  if (faviconUrl) {
    return (
      <div className="relative">
        <img 
          src={faviconUrl} 
          alt={`${modelName} favicon`}
          className={`${sizeClasses[size]} object-contain ${className}`}
          onError={(e) => {
            // Hide the image on error
            e.currentTarget.style.display = 'none';
            // Show the fallback
            const fallback = e.currentTarget.nextElementSibling as HTMLElement;
            if (fallback) fallback.style.display = 'flex';
          }}
        />
        {/* Fallback that shows when favicon fails to load */}
        <div 
          className={`${sizeClasses[size]} bg-blue-100 rounded flex items-center justify-center flex-shrink-0 ${className}`}
          style={{ display: 'none' }}
        >
          <span className={`text-xs font-medium text-blue-600`}>
            {modelName?.charAt(0)?.toUpperCase() || 'A'}
          </span>
        </div>
      </div>
    );
  }
  
  // Fallback to icon if no favicon found and showFallback is true
  if (showFallback) {
    return (
      <Bot className={`${sizeClasses[size]} text-gray-500 ${className}`} />
    );
  }
  
  return null;
};

export default LLMLogo;
