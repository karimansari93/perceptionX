// Claude API key handover between Anthropic organizations.
//
// CLAUDE_API_KEY is the current key. CLAUDE_API_KEY_NEXT, when set, is the
// key for the organization we are moving to. Every call tries the current
// key first, so its prepaid credit is used up, and only when Anthropic says
// that credit balance is exhausted does the same request go out again on the
// next key. Once the old organization is empty, move the new key into
// CLAUDE_API_KEY and delete CLAUDE_API_KEY_NEXT.
//
// The "current key is exhausted" flag lives for the lifetime of the edge
// isolate, so a warm function stops paying a failed round trip on every call.
// A cold start re-learns it on its first call.

let primaryExhausted = false;

/** Keys to try, in order. Empty when no Claude key is configured. */
export function claudeApiKeys(): string[] {
  // @ts-ignore Deno global is available in the edge runtime.
  const primary = Deno.env.get("CLAUDE_API_KEY") || "";
  // @ts-ignore Deno global is available in the edge runtime.
  const next = Deno.env.get("CLAUDE_API_KEY_NEXT") || "";
  const keys = primaryExhausted && next ? [next] : [primary, next];
  return keys.filter((k, i) => k && keys.indexOf(k) === i);
}

/**
 * True when an Anthropic error body means "this organization has no credit
 * left". Accepts the raw response body ({ type: "error", error: {...} }) or
 * the inner error object. Anthropic reports this as a 400
 * invalid_request_error ("Your credit balance is too low to access the
 * Anthropic API...") or as a billing_error.
 */
export function isCreditExhausted(body: unknown): boolean {
  const b = body as any;
  const err = b?.error && typeof b.error === "object" ? b.error : b;
  if (err?.type === "billing_error") return true;
  return typeof err?.message === "string" && /credit balance/i.test(err.message);
}

/**
 * Runs `call` with each configured key in turn, moving to the next key only
 * when the current one fails for lack of credit. For SDK callers: build the
 * client from the key inside `call`. Any other error is thrown unchanged.
 */
export async function withClaudeKey<T>(call: (apiKey: string) => Promise<T>): Promise<T> {
  const keys = claudeApiKeys();
  if (keys.length === 0) throw new Error("Claude API key not configured");
  for (let i = 0; ; i++) {
    try {
      return await call(keys[i]);
    } catch (err: any) {
      // SDK APIError carries the parsed body on .error and the text in .message.
      const exhausted = isCreditExhausted(err?.error) || isCreditExhausted({ message: err?.message });
      if (!exhausted || i === keys.length - 1) throw err;
      markExhausted(i);
    }
  }
}

/**
 * fetch() against the Anthropic API with the same key handover. Sets the
 * x-api-key header per attempt and returns the last response, so callers
 * keep their existing status and error handling.
 */
export async function claudeFetch(url: string, init: RequestInit): Promise<Response> {
  const keys = claudeApiKeys();
  if (keys.length === 0) throw new Error("Claude API key not configured");
  for (let i = 0; ; i++) {
    const headers = new Headers(init.headers);
    headers.set("x-api-key", keys[i]);
    const res = await fetch(url, { ...init, headers });
    if (res.ok || i === keys.length - 1) return res;
    const body = await res.clone().json().catch(() => null);
    if (!isCreditExhausted(body)) return res;
    markExhausted(i);
  }
}

function markExhausted(index: number) {
  if (index === 0 && !primaryExhausted) {
    primaryExhausted = true;
    console.warn("[claude-keys] CLAUDE_API_KEY is out of credit; switching to CLAUDE_API_KEY_NEXT");
  }
}

/** Test hook: forget the exhausted flag. */
export function _resetClaudeKeysForTest() {
  primaryExhausted = false;
}
