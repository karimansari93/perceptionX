import React, { useState } from 'react';
import { getFavicon } from '@/utils/citationUtils';

interface FaviconProps {
  domain: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  alt?: string;
}

export const Favicon: React.FC<FaviconProps> = ({ 
  domain, 
  size = 'md', 
  className = '',
  alt = `${domain} favicon`
}) => {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Helpers declared BEFORE the early-return so the !domain branch can use
  // them without hitting TDZ errors. Function expressions (const =) don't hoist.
  const getSizeClasses = (size: string): string => {
    switch (size) {
      case 'sm': return 'w-3 h-3';
      case 'lg': return 'w-6 h-6';
      default: return 'w-4 h-4';
    }
  };

  const getImageSizeClasses = (size: string): string => {
    switch (size) {
      case 'sm': return 'w-3 h-3';
      case 'lg': return 'w-6 h-6';
      default: return 'w-4 h-4';
    }
  };

  const getTextSizeClasses = (size: string): string => {
    switch (size) {
      case 'sm': return 'text-[8px]';
      case 'lg': return 'text-sm';
      default: return 'text-xs';
    }
  };

  if (!domain) {
    return (
      <div className={`bg-gray-100 rounded flex items-center justify-center ${getSizeClasses(size)} ${className}`}>
        <span className={`font-medium text-gray-500 ${getTextSizeClasses(size)}`}>?</span>
      </div>
    );
  }

  const handleError = (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
    // Logo.dev's monogram fallback almost always returns an image, so an error
    // here means a hard failure (network/token issue). Fall back to the
    // colored-initial chip below.
    setHasError(true);
    setIsLoading(false);
    event.currentTarget.style.display = 'none';
  };

  const handleLoad = () => {
    setIsLoading(false);
  };

  if (hasError) {
    // Fallback to colored dot with domain initial
    return (
      <div className={`bg-blue-100 rounded flex items-center justify-center ${getSizeClasses(size)} ${className}`}>
        <span className={`font-medium text-blue-600 ${getTextSizeClasses(size)}`}>
          {domain.charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }

  const currentUrl = getFavicon(domain, size === 'lg' ? 64 : 32);

  return (
    <div className={`relative ${getSizeClasses(size)} ${className}`}>
      {isLoading && (
        <div className={`absolute inset-0 bg-gray-100 rounded flex items-center justify-center ${getSizeClasses(size)}`}>
          <span className={`font-medium text-gray-400 ${getTextSizeClasses(size)}`}>•</span>
        </div>
      )}
      <img
        src={currentUrl}
        alt={alt}
        className={`${getImageSizeClasses(size)} flex-shrink-0 object-contain ${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity`}
        onError={handleError}
        onLoad={handleLoad}
      />
    </div>
  );
}; 