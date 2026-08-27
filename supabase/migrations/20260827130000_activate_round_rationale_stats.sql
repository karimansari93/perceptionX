-- Rationale copy drops the decimals: "Indeed appears in 21.5% of AI answers"
-- reads like a lab report; "over 20%" is the same claim in a human register,
-- and every rounding stays on the honest side (never above the measured
-- value's ceiling): exact wholes keep the number, <10 rounds to "around N%",
-- >=10 floors to the nearest 5 as "over N%", or "nearly N+5%" when within
-- 1.5 points of it. Applies to every org's routes; the seed migrations keep
-- their measured decimals as the record, and future seeds should use this
-- phrasing directly.
--
-- parseStatPct on the page reads the first number in the sentence, so the
-- count-up stat block simply shows the rounded figure.
with t as (
  select id, rationale_stat, (regexp_match(rationale_stat, '(\d+(?:\.\d+)?)%'))[1] as num
  from public.activate_routes where rationale_stat is not null
), p as (
  select id, rationale_stat, num,
    case
      when num::numeric % 1 = 0 then (num::numeric)::int || '%'
      when num::numeric < 10 then 'around ' || round(num::numeric)::int || '%'
      when num::numeric - floor(num::numeric/5)*5 >= 3.5 then 'nearly ' || (floor(num::numeric/5)*5 + 5)::int || '%'
      else 'over ' || (floor(num::numeric/5)*5)::int || '%'
    end as phrase
  from t where num is not null
)
update public.activate_routes r
set rationale_stat = replace(p.rationale_stat, p.num || '%', p.phrase)
from p where p.id = r.id;
