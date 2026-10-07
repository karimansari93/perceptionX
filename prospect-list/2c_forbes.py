"""Step 2c: Forbes "America's Largest Private Companies" (catches big private US firms SEC can't see).

Uses the data feed behind forbes.com/lists/largest-private-companies. Takes the newest
year that is published. Writes cache/forbes.json. For internal prospecting only.
"""
import json
from datetime import date, datetime, timezone

from common import CACHE, get

URL = "https://www.forbes.com/forbesapi/org/largest-private-companies/{year}/position/true.json?limit=1000"


def main():
    for year in range(date.today().year, date.today().year - 4, -1):
        r = get(URL.format(year=year), headers={"User-Agent": "Mozilla/5.0 (PerceptionX research)"})
        rows = (r.json().get("organizationList") or {}).get("organizationsLists") or [] if r.ok else []
        if rows:
            break
    else:
        raise SystemExit("No Forbes list found for the last 4 years")

    out = []
    for o in rows:
        fy = o.get("fiscalDateEnding")
        out.append({
            "name": o.get("organizationName") or o.get("name"),
            "employees": o.get("employees"),
            "as_of": datetime.fromtimestamp(fy / 1000, timezone.utc).date().isoformat() if fy else "",
            "city": o.get("city") or "", "state": o.get("state") or "",
            "country": o.get("country") or "", "industry": o.get("industry") or "",
            "rank": o.get("rank"), "list_year": year,
        })
    (CACHE / "forbes.json").write_text(json.dumps(out, indent=1))
    print(f"Forbes {year}: {len(out)} private companies, "
          f"{sum(1 for o in out if (o['employees'] or 0) >= 5000)} with 5,000+ employees")


if __name__ == "__main__":
    main()
