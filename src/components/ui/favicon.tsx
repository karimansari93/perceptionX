import React, { useEffect, useState } from 'react';
import { getFavicon } from '@/utils/citationUtils';

interface FaviconProps {
  domain: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  alt?: string;
}

const boxClass = (size: string): string => {
  switch (size) {
    case 'sm': return 'w-3 h-3';
    case 'lg': return 'w-6 h-6';
    default: return 'w-4 h-4';
  }
};

const textClass = (size: string): string => {
  switch (size) {
    case 'sm': return 'text-[8px]';
    case 'lg': return 'text-sm';
    default: return 'text-xs';
  }
};

// Where a domain's mark can come from, in order. Logo.dev first (brand
// marks, monogram fallback, needs VITE_LOGO_DEV_TOKEN); Google's favicon
// service second (the site's own favicon, no key, answers a globe for
// unknown domains rather than 404); the coloured initial last.
const candidates = (domain: string, px: number): string[] => {
  const clean = domain.trim().toLowerCase().replace(/^www\./, '');
  return [
    getFavicon(clean, px),
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=${px}`,
  ];
};

// What resolved for a domain (at a size): the candidate index that loaded,
// or -1 when none did. A component that mounts later — the same pill
// re-created on every streamed chunk — starts from the answer instead of
// re-running the chain, so nothing blinks.
const resolved = new Map<string, number>();

// Inline elements throughout (span, not div) so a favicon can sit inside
// running text and links without invalid nesting.
export const Favicon: React.FC<FaviconProps> = ({
  domain,
  size = 'md',
  className = '',
  alt = `${domain} favicon`,
}) => {
  const px = size === 'lg' ? 64 : 32;
  const cacheKey = `${domain.trim().toLowerCase().replace(/^www\./, '')}@${px}`;
  const known = resolved.get(cacheKey);
  const [attempt, setAttempt] = useState(known === undefined ? 0 : known === -1 ? Number.MAX_SAFE_INTEGER : known);
  const [loaded, setLoaded] = useState(known !== undefined && known >= 0);
  useEffect(() => {
    const k = resolved.get(cacheKey);
    setAttempt(k === undefined ? 0 : k === -1 ? Number.MAX_SAFE_INTEGER : k);
    setLoaded(k !== undefined && k >= 0);
  }, [cacheKey]);

  if (!domain) {
    return (
      <span className={`inline-flex items-center justify-center rounded bg-gray-100 ${boxClass(size)} ${className}`}>
        <span className={`font-medium text-gray-500 ${textClass(size)}`}>?</span>
      </span>
    );
  }

  const sources = candidates(domain, px);
  if (attempt >= sources.length) {
    resolved.set(cacheKey, -1);
    return (
      <span className={`inline-flex items-center justify-center rounded bg-blue-100 ${boxClass(size)} ${className}`} title={domain}>
        <span className={`font-medium text-blue-600 ${textClass(size)}`}>{domain.charAt(0).toUpperCase()}</span>
      </span>
    );
  }

  return (
    <span className={`relative inline-flex ${boxClass(size)} ${className}`}>
      {!loaded && (
        <span className={`absolute inset-0 inline-flex items-center justify-center rounded bg-gray-100 ${boxClass(size)}`}>
          <span className={`font-medium text-gray-400 ${textClass(size)}`}>•</span>
        </span>
      )}
      <img
        key={sources[attempt]}
        src={sources[attempt]}
        alt={alt}
        className={`${boxClass(size)} flex-shrink-0 object-contain transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onError={() => { setLoaded(false); setAttempt(a => a + 1); }}
        onLoad={() => { resolved.set(cacheKey, attempt); setLoaded(true); }}
      />
    </span>
  );
};
