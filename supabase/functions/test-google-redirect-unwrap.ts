/**
 * Test Google redirect unwrapping for citation URLs.
 * Run from repo root: deno run --allow-read supabase/functions/test-google-redirect-unwrap.ts
 * (or: node --experimental-strip-types supabase/functions/test-google-redirect-unwrap.ts)
 *
 * Covers the wrappers Google's SERP payloads actually returned in production:
 * image/result redirects (google.com/url?...&url=), translate.google.com,
 * imgres, opaque targets that must be dropped, and search-UI surfaces.
 */
import {
  isUsableCitationUrl,
  normalizeCitationsForStorage,
  unwrapRedirectUrl,
} from "./_shared/citation-extraction.ts";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`FAIL ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// --- unwrapRedirectUrl -------------------------------------------------------
check(
  "image redirect, plain target",
  unwrapRedirectUrl(
    "https://www.google.com/url?sa=i&source=web&rct=j&url=https://www.csl.com/&ved=2ahUKEwjV86&opi=89978449&psig=AOvVaw1&ust=1785431723220000",
  ),
  "https://www.csl.com/",
);

check(
  "image redirect, percent-encoded target + text fragment",
  unwrapRedirectUrl(
    "https://www.google.com/url?sa=i&url=https%3A%2F%2Fwww.glassdoor.com%2FReviews%2FCSL.htm%23%3A~%3Atext%3Dfoo&ved=2ahU",
  ),
  "https://www.glassdoor.com/Reviews/CSL.htm",
);

check(
  "classic result redirect uses q= when url= is absent",
  unwrapRedirectUrl("https://www.google.com/url?q=https://www.indeed.com/cmp/Csl&sa=U"),
  "https://www.indeed.com/cmp/Csl",
);

check(
  "country domain wrapper",
  unwrapRedirectUrl("https://www.google.co.uk/url?sa=i&url=https://www.bbc.com/news&ved=x"),
  "https://www.bbc.com/news",
);

check(
  "imgres prefers the page over the image",
  unwrapRedirectUrl(
    "https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.x.com%2Flogo.png&imgrefurl=https%3A%2F%2Fwww.builtin.com%2Fcompany%2Fcsl&tbnid=abc",
  ),
  "https://www.builtin.com/company/csl",
);

check(
  "translate wrapper (pre-existing behaviour)",
  unwrapRedirectUrl("https://translate.google.com/translate?u=https%3A%2F%2Fwww.glassdoor.com%2Fx.htm&hl=es&sl=en"),
  "https://www.glassdoor.com/x.htm",
);

check(
  "nested wrapper: image redirect around a translate link",
  unwrapRedirectUrl(
    "https://www.google.com/url?sa=i&url=https%3A%2F%2Ftranslate.google.com%2Ftranslate%3Fu%3Dhttps%253A%252F%252Fwww.comparably.com%252Fcompanies%252Fcsl%26hl%3Des&ved=x",
  ),
  "https://www.comparably.com/companies/csl",
);

check(
  "opaque token target is left alone (nothing to unwrap to)",
  unwrapRedirectUrl("https://www.google.com/url?sa=i&url=CAESgQEB7keqTduIMpUM&ved=x"),
  "https://www.google.com/url?sa=i&url=CAESgQEB7keqTduIMpUM&ved=x",
);

check(
  "legitimate google-owned page is untouched",
  unwrapRedirectUrl("https://careers.google.com/benefits/"),
  "https://careers.google.com/benefits/",
);

check(
  "lookalike host is not treated as google",
  unwrapRedirectUrl("https://notgoogle.com/url?url=https://evil.example"),
  "https://notgoogle.com/url?url=https://evil.example",
);

check("non-URL input survives", unwrapRedirectUrl("not a url"), "not a url");

// --- isUsableCitationUrl -----------------------------------------------------
check("unwrapped source is usable", isUsableCitationUrl("https://www.csl.com/"), true);
check("google-owned page is usable", isUsableCitationUrl("https://careers.google.com/benefits/"), true);
check(
  "unresolvable redirect is not usable",
  isUsableCitationUrl("https://www.google.com/url?sa=i&url=CAESgQEB&ved=x"),
  false,
);
check("searchviewer is not usable", isUsableCitationUrl("https://www.google.com/searchviewer/10?svid=x"), false);
check(
  "bare translate link (no u= target) is not usable",
  isUsableCitationUrl("https://translate.google.com/translate"),
  false,
);
check("results page is not usable", isUsableCitationUrl("https://www.google.com/search?q=csl"), false);
check("non-http is not usable", isUsableCitationUrl("about:invalid#zGuavaz"), false);

// --- normalizeCitationsForStorage -------------------------------------------
check(
  "wrapper citation is rewritten to the real source",
  normalizeCitationsForStorage([
    {
      url: "https://www.google.com/url?sa=i&url=https://www.csl.com/&ved=x",
      domain: "google.com",
      title: "Source from google.com",
    },
  ]),
  [{ url: "https://www.csl.com/", domain: "csl.com", title: "Source from csl.com" }],
);

check(
  "unresolvable wrappers are dropped, clean citations kept as-is",
  normalizeCitationsForStorage([
    { url: "https://www.google.com/url?sa=i&url=CAESgQEB&ved=x", domain: "google.com", title: "Source from google.com" },
    { url: "https://www.google.com/searchviewer/10?svid=x", domain: "google.com", title: "Netflix Animation Studios" },
    { url: "https://www.indeed.com/cmp/Csl", domain: "indeed.com", title: "Indeed" },
    { url: "" },
  ]),
  [{ url: "https://www.indeed.com/cmp/Csl", domain: "indeed.com", title: "Indeed" }],
);

check(
  "a real title survives unwrapping",
  normalizeCitationsForStorage([
    { url: "https://www.google.com/url?sa=i&url=https://www.seek.com.au/x&ved=x", domain: "google.com", title: "Seek" },
  ]),
  [{ url: "https://www.seek.com.au/x", domain: "seek.com.au", title: "Seek" }],
);

check("empty input", normalizeCitationsForStorage(undefined), []);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
if (failures > 0 && typeof process !== "undefined") process.exitCode = 1;
