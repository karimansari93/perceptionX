# Why responses in the DB don’t show or get counted in the Prompts tab

If a row exists in `prompt_responses` but doesn’t appear or get counted in the dashboard Prompts tab, it’s for one of these reasons.

---

## 1. **`company_id` on the response doesn’t match the company you’re viewing**

The app only loads responses where:

```ts
.eq('company_id', currentCompany.id)
```

So:

- If **`company_id` is NULL** on the row → it is never returned.
- If **`company_id`** points to **another company** → it won’t show when you have “Company A” selected.

**Check:**

```sql
-- Responses for a company that have wrong/missing company_id
SELECT id, company_id, confirmed_prompt_id, tested_at
FROM prompt_responses
WHERE company_id IS NULL
   OR company_id != '<the_company_id_you_are_viewing>';
```

**Fix:** Backfill `company_id` from `confirmed_prompts` (e.g. migration `20250110000000_add_missing_company_id_to_prompt_responses.sql` pattern) so every row has the correct company.

---

## 2. **RLS: the company isn’t in “your” organization**

Row Level Security on `prompt_responses` only allows SELECT when:

- The row’s **`company_id`** is in the set of companies linked to **your** user via **organization_companies** and **organization_members**.

So even if `company_id` is set, you won’t see the row if:

- The company is **not** in `organization_companies` for any org you belong to, or  
- You are **not** in `organization_members` for the org that owns that company.

**Check:**

```sql
-- Companies your user can see (replace YOUR_USER_ID)
SELECT oc.company_id, c.name
FROM organization_companies oc
JOIN organization_members om ON om.organization_id = oc.organization_id
JOIN companies c ON c.id = oc.company_id
WHERE om.user_id = 'YOUR_USER_ID';

-- Then compare: do your prompt_responses.company_id values appear in that list?
```

**Fix:** Ensure the company is attached to an org and your user is a member of that org (correct rows in `organization_companies` and `organization_members`).

---

## 3. **Supabase/PostgREST 1000-row cap (most likely if you have a lot of data)**

PostgREST (used by Supabase) has a **default maximum of 1000 rows per request**.  
The dashboard loads `prompt_responses` in **one** request with **no** pagination. So:

- If a company has **more than 1000** `prompt_responses`, **only the first 1000** (by `tested_at` desc) are returned.
- Any extra rows **exist in the DB** but **never reach the frontend**, so they are **never shown or counted** in the Prompts tab.

**Check:**

```sql
-- Count responses per company; if > 1000, the rest are not loaded
SELECT company_id, COUNT(*) AS response_count
FROM prompt_responses
GROUP BY company_id
HAVING COUNT(*) > 1000;
```

**Fix:** Either:

- Paginate in the app (e.g. multiple requests with `range`/`offset` and merge results), or  
- Increase PostgREST’s `db-max-rows` (e.g. `PGRST_DB_MAX_ROWS`) and optionally request a higher limit in the client (e.g. `.range(0, 9999)` or similar), bearing in mind performance.

---

## 4. **Orphaned responses (deleted prompt)**

If **`confirmed_prompt_id`** points to a row that **no longer exists** in `confirmed_prompts`:

- The app still **loads** the response (join to `confirmed_prompts` is a left join).
- `confirmed_prompts` is **null**, so the UI groups by **empty prompt text**.
- So the response **is** counted, but under a **blank/empty** prompt row, not under the “real” prompt name.

So “deleted prompt” usually means **misplaced** in the UI, not **missing** from the count. If you don’t see a row at all, the cause is one of 1–3 above.

---

## Summary

| Cause | Response in DB? | In API result? | In Prompts tab? |
|-------|------------------|----------------|------------------|
| Wrong / null `company_id` | Yes | No | No |
| RLS (company not in your org) | Yes | No | No |
| More than 1000 rows (PostgREST cap) | Yes | Only first 1000 | Only first 1000 counted |
| Orphaned (prompt deleted) | Yes | Yes | Yes, under empty prompt |

So: **if they exist in the DB but not in the Prompts tab, it’s either `company_id`, RLS, or the 1000-row limit.** Use the checks above to see which one applies.
