"""Step 2b: annual revenue for every SEC filer (safety net).

SEC publishes revenue as structured data, unlike headcount. Step 3 uses it to list
large US-HQ companies whose headcount sentence could not be read, so none drop off.
Writes cache/sec_revenue.json: {cik: {"revenue": usd, "year": "CY2025"}}.
"""
import json

from common import CACHE, get

CONCEPTS = [("us-gaap", "Revenues"), ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
            ("us-gaap", "SalesRevenueNet"), ("us-gaap", "RevenuesNetOfInterestExpense"),
            ("ifrs-full", "Revenue")]
YEARS = ["CY2024", "CY2025"]


def main():
    out = {}
    for year in YEARS:  # later year overwrites earlier
        for tax, concept in CONCEPTS:
            r = get(f"https://data.sec.gov/api/xbrl/frames/{tax}/{concept}/USD/{year}.json")
            if r.status_code != 200:
                continue
            for d in r.json().get("data", []):
                cur = out.get(d["cik"])
                if cur is None or cur["year"] < year or (cur["year"] == year and d["val"] > cur["revenue"]):
                    out[d["cik"]] = {"revenue": d["val"], "year": year}
    (CACHE / "sec_revenue.json").write_text(json.dumps(out))
    print(f"Revenue found for {len(out)} SEC filers")


if __name__ == "__main__":
    main()
