import { useEffect } from "react";

interface MetaTagsOptions {
  title: string;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
}

function setMetaContent(selector: string, content: string): string | null {
  const el = document.querySelector<HTMLMetaElement>(selector);
  if (!el) return null;
  const previous = el.getAttribute("content");
  el.setAttribute("content", content);
  return previous;
}

export function useMetaTags({ title, description, ogTitle, ogDescription }: MetaTagsOptions) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const previousDescription = setMetaContent('meta[name="description"]', description);
    const previousOgTitle = setMetaContent('meta[property="og:title"]', ogTitle ?? title);
    const previousOgDescription = setMetaContent(
      'meta[property="og:description"]',
      ogDescription ?? description,
    );

    return () => {
      document.title = previousTitle;
      if (previousDescription !== null) setMetaContent('meta[name="description"]', previousDescription);
      if (previousOgTitle !== null) setMetaContent('meta[property="og:title"]', previousOgTitle);
      if (previousOgDescription !== null)
        setMetaContent('meta[property="og:description"]', previousOgDescription);
    };
  }, [title, description, ogTitle, ogDescription]);
}
