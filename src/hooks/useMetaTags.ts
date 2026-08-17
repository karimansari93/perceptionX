import { useEffect } from "react";

interface MetaTagsOptions {
  title: string;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
  /**
   * Overrides the site-wide "index, follow" from index.html. Pass
   * "noindex, nofollow" on any page whose URL is a shared secret — an indexed
   * activate page would put the client's name (and the token) in public search
   * results. Sets `googlebot` alongside `robots`: index.html carries both, and
   * the more specific tag wins for Google, so overriding one alone is a no-op.
   *
   * Search crawlers honour this; the social unfurlers (Slack, Teams, LinkedIn)
   * ignore it, so link previews still work.
   */
  robots?: string;
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
  robots,
}: MetaTagsOptions) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const previousDescription = setMetaContent('meta[name="description"]', description);
    const previousOgTitle = setMetaContent('meta[property="og:title"]', ogTitle ?? title);
    const previousOgDescription = setMetaContent(
      'meta[property="og:description"]',
      ogDescription ?? description,
    );
    const previousRobots = robots ? setMetaContent('meta[name="robots"]', robots) : null;
    const previousGooglebot = robots ? setMetaContent('meta[name="googlebot"]', robots) : null;

    return () => {
      document.title = previousTitle;
      if (previousDescription !== null) setMetaContent('meta[name="description"]', previousDescription);
      if (previousOgTitle !== null) setMetaContent('meta[property="og:title"]', previousOgTitle);
      if (previousOgDescription !== null)
        setMetaContent('meta[property="og:description"]', previousOgDescription);
      if (previousRobots !== null) setMetaContent('meta[name="robots"]', previousRobots);
      if (previousGooglebot !== null) setMetaContent('meta[name="googlebot"]', previousGooglebot);
    };
  }, [title, description, ogTitle, ogDescription, robots]);
}
