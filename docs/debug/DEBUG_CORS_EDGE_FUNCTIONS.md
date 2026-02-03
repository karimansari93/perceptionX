# CORS / Edge Function "Failed to send a request" Fix

## What the error means

When the browser shows:

- **"Access to fetch at '.../functions/v1/search-insights' from origin 'http://localhost:8080' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header"**
- **"FunctionsFetchError: Failed to send a request to the Edge Function"**

the response that came back did **not** include CORS headers. That usually means one of:

1. **The response was not from your function** – e.g. 502/504/timeout from the Supabase gateway. Gateway error pages often don’t include CORS headers.
2. **The function isn’t deployed** – OPTIONS or POST hits the project but the function doesn’t exist or is an old version without proper CORS.
3. **The function crashed before sending any response** – e.g. cold start failure, uncaught exception before your handler runs.

Your function code **does** set CORS (shared `cors.ts`, OPTIONS handled, headers on all responses). So the fix is to ensure the **deployed** functions are current and that **every** response path (including errors) goes through your code.

## What was changed in this repo

- **`search-insights`**: OPTIONS response now uses explicit `status: 200` so preflight is clearly successful.
- **`_shared/cors.ts`**: Already correct (`Access-Control-Allow-Origin: *`, required headers).
- **`collect-company-responses`**: Already returns CORS on OPTIONS and all responses.

## What you should do

### 1. Redeploy the Edge Functions

Deploy the two functions that are failing so the hosted project uses the latest code (including CORS):

```bash
# From project root
npx supabase functions deploy search-insights
npx supabase functions deploy collect-company-responses
```

If you use a specific project ref:

```bash
npx supabase functions deploy search-insights --project-ref ofyjvfmcgtntwamkubui
npx supabase functions deploy collect-company-responses --project-ref ofyjvfmcgtntwamkubui
```

### 2. Confirm OPTIONS works

In DevTools → Network, trigger the flow again. Check the **OPTIONS** request to `.../functions/v1/search-insights` (or `collect-company-responses`):

- Status should be **200**.
- Response headers should include **`Access-Control-Allow-Origin: *`** (or your origin).

If OPTIONS returns 404/502/504 or has no CORS headers, the gateway or an old deployment is responding; redeploy and retry.

### 3. Check Supabase Dashboard

- **Edge Functions** – Confirm `search-insights` and `collect-company-responses` exist and were updated.
- **Logs** – After reproducing the error, check function logs. If you see no log for the request, the request never reached your function (routing/auth/timeout). If you see logs and then an error, fix that error (e.g. missing env, timeout, bad input).

### 4. Local development

If you run Edge Functions locally (`supabase functions serve`), call them at the local URL (e.g. `http://localhost:54321/functions/v1/...`). Ensure the app’s `VITE_SUPABASE_URL` (or equivalent) points to that URL when developing locally so CORS and auth match.

## Summary

- CORS is handled in code; the problem is usually **deployment** or **gateway/error responses** without CORS.
- **Redeploy** `search-insights` and `collect-company-responses`, then verify OPTIONS and POST in Network tab and in Supabase logs.
