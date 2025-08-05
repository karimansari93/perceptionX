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

  if (!domain) {
    return (
      <div className={`bg-gray-100 rounded flex items-center justify-center ${getSizeClasses(size)} ${className}`}>
        <span className={`font-medium text-gray-500 ${getTextSizeClasses(size)}`}>?</span>
      </div>
    );
  }

  const getFaviconUrl = (domain: string): string => {
    const cleanDomain = domain.trim().toLowerCase().replace(/^www\./, '');
    return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${cleanDomain}&size=32`;
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
    setHasError(true);
    setIsLoading(false);
    // Prevent the error from appearing in console
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

  return (
    <img
      src={getFaviconUrl(domain)}
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