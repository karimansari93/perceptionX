import { useEffect } from "react";

interface MetaTagsOptions {
  title: string;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
  /**
   * Swaps the tab icon while the page is mounted. For client-facing pages that
   * carry the client's identity rather than ours (Activate), where a
   * PerceptionX mark in the tab is the wrong badge on someone else's page.
   */
  favicon?: string | null;
}

function setMetaContent(selector: string, content: string): string | null {
  const el = document.querySelector<HTMLMetaElement>(selector);
  if (!el) return null;
  const previous = el.getAttribute("content");
  el.setAttribute("content", content);
  return previous;
}

export function useMetaTags({
  title,
  description,
  ogTitle,
  ogDescription,
  favicon,
}: MetaTagsOptions) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const iconEl = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const previousIcon =
      favicon && iconEl
        ? { href: iconEl.getAttribute("href"), type: iconEl.getAttribute("type") }
        : null;
    if (favicon && iconEl) {
      iconEl.setAttribute("href", favicon);
      // The stock icon is declared image/x-icon; a client logo is a PNG or an
      // SVG, and a type attribute that lies about it gets the icon dropped.
      iconEl.removeAttribute("type");
    }

    const previousDescription = setMetaContent('meta[name="description"]', description);
    const previousOgTitle = setMetaContent('meta[property="og:title"]', ogTitle ?? title);
    const previousOgDescription = setMetaContent(
      'meta[property="og:description"]',
      ogDescription ?? description,
    );

    return () => {
      document.title = previousTitle;
      if (previousIcon && iconEl) {
        if (previousIcon.href !== null) iconEl.setAttribute("href", previousIcon.href);
        if (previousIcon.type !== null) iconEl.setAttribute("type", previousIcon.type);
      }
      if (previousDescription !== null) setMetaContent('meta[name="description"]', previousDescription);
      if (previousOgTitle !== null) setMetaContent('meta[property="og:title"]', previousOgTitle);
      if (previousOgDescription !== null)
        setMetaContent('meta[property="og:description"]', previousOgDescription);
    };
  }, [title, description, ogTitle, ogDescription, favicon]);
}
