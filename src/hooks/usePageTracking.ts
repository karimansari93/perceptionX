import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Hotjar from '@hotjar/browser';

declare global {
  interface Window {
    gtag: (...args: any[]) => void;
  }
}

export const usePageTracking = () => {
  const location = useLocation();

  useEffect(() => {
    // Track page view for Google Analytics
    if (window.gtag) {
      window.gtag('config', 'G-FGRDCN2WF3', {
        page_path: location.pathname + location.search,
      });
      
      // Fire Google Ads conversion event for page view
      window.gtag('event', 'ads_conversion_PAGE_VIEW_1', {
        // Add any specific event parameters here if needed
        page_title: document.title,
        page_location: window.location.href,
        page_path: location.pathname,
      });
    }

    // Track page change for Hotjar (only in production)
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      try {
        Hotjar.stateChange(location.pathname + location.search);
      } catch (error) {
        // Silently fail if Hotjar isn't initialized yet
      }
    }
  }, [location]);
};
