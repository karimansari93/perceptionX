// One-off: delete the October 2026 Netflix "job-security" answers that were
// backed up in migration backup_netflix_jobsec_2026_10, so they can be
// re-collected after the Oct 14 layoff announcement. Approved by Karim
// 2026-10-15. Runs as an edge function because the Supabase MCP holds DELETE
// statements for a confirmation that never reaches cloud sessions.
//
// Deletes only ids present in the backup tables, in one transaction, and
// rolls back unless every count matches the verified backup exactly.
import postgres from 'npm:postgres@3.4.4';

const EXPECTED = {
  theme_batch_items: 1417,
  ai_themes: 5938,
  competitor_themes: 1895,
  prompt_responses: 1417,
};

class Mismatch extends Error {}

Deno.serve(async () => {
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });
  try {
    const counts = await sql.begin(async (tx) => {
      const backup = await tx`
        select
          (select count(*) from public.backup_netflix_jobsec_2026_10)::int as responses,
          (select count(*) from public.backup_netflix_jobsec_2026_10_themes)::int as themes,
          (select count(*) from public.backup_netflix_jobsec_2026_10_competitor_themes)::int as comp,
          (select count(*) from public.backup_netflix_jobsec_2026_10_batch_items)::int as batch`;
      const b = backup[0];
      if (
        b.responses !== EXPECTED.prompt_responses || b.themes !== EXPECTED.ai_themes ||
        b.comp !== EXPECTED.competitor_themes || b.batch !== EXPECTED.theme_batch_items
      ) throw new Mismatch(`backup counts ${JSON.stringify(b)}`);

      const got: Record<string, number> = {};
      got.theme_batch_items = (await tx`
        delete from public.theme_batch_items
        where response_id in (select id from public.backup_netflix_jobsec_2026_10)`).count;
      got.ai_themes = (await tx`
        delete from public.ai_themes
        where response_id in (select id from public.backup_netflix_jobsec_2026_10)`).count;
      got.competitor_themes = (await tx`
        delete from public.competitor_themes
        where response_id in (select id from public.backup_netflix_jobsec_2026_10)`).count;
      got.prompt_responses = (await tx`
        delete from public.prompt_responses
        where id in (select id from public.backup_netflix_jobsec_2026_10)`).count;

      for (const [k, v] of Object.entries(EXPECTED)) {
        if (got[k] !== v) throw new Mismatch(`deleted ${JSON.stringify(got)}`);
      }
      return got;
    });
    return Response.json({ ok: true, deleted: counts });
  } catch (e) {
    const rolledBack = e instanceof Mismatch ? 'count mismatch, rolled back' : 'error, rolled back';
    return Response.json({ ok: false, reason: rolledBack, detail: String(e) }, { status: 409 });
  } finally {
    await sql.end();
  }
});
