import React, { useState } from 'react';

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
  const [currentSourceIndex, setCurrentSourceIndex] = useState(0);

  if (!domain) {
    return (
      <div className={`bg-gray-100 rounded flex items-center justify-center ${getSizeClasses(size)} ${className}`}>
        <span className={`font-medium text-gray-500 ${getTextSizeClasses(size)}`}>?</span>
      </div>
    );
  }

  const getFaviconUrls = (domain: string): string[] => {
    const cleanDomain = domain.trim().toLowerCase().replace(/^www\./, '');
    return [
      // Primary: Google's favicon service
      `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${cleanDomain}&size=32`,
      // Fallback 1: DuckDuckGo favicon service
      `https://icons.duckduckgo.com/ip3/${cleanDomain}.ico`,
      // Fallback 2: Direct favicon.ico
      `https://${cleanDomain}/favicon.ico`,
      // Fallback 3: Alternative Google service
      `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=32`,
    ];
  };

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

  const handleError = (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const urls = getFaviconUrls(domain);
    const nextIndex = currentSourceIndex + 1;
    
    if (nextIndex < urls.length) {
      // Try next fallback source
      setCurrentSourceIndex(nextIndex);
      setIsLoading(true);
      // Prevent the error from appearing in console
      event.currentTarget.style.display = 'none';
    } else {
      // All sources failed, show fallback
      setHasError(true);
      setIsLoading(false);
      event.currentTarget.style.display = 'none';
    }
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

  const urls = getFaviconUrls(domain);
  const currentUrl = urls[currentSourceIndex];

  return (
    <img
      src={currentUrl}
      alt={alt}
      className={`${getImageSizeClasses(size)} flex-shrink-0 object-contain ${className}`}
      onError={handleError}
      onLoad={handleLoad}
      style={{ 
        display: isLoading ? 'none' : 'block'
      }}
    />
  );
}; 