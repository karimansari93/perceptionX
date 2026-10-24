"""Step 1: pull every Wikidata entity that has ever reported MIN_EMPLOYEES+ employees.

Writes cache/wikidata.json: one record per entity with all headcount statements,
country, HQ city, industry, website, tickers, SEC CIK, parent, and organisation type.
"""
import json
import time

from common import CACHE, MIN_EMPLOYEES, get

SPARQL = "https://query.wikidata.org/sparql"
BATCH = 150


def sparql(query):
    r = get(SPARQL, params={"query": query, "format": "json"},
            headers={"Accept": "application/sparql-results+json"}, timeout=300)
    r.raise_for_status()
    return r.json()["results"]["bindings"]


def qid(uri):
    return uri.rsplit("/", 1)[-1]


def v(b, k):
    return b[k]["value"] if k in b else None


def main():
    ids = sorted({qid(v(b, "item")) for b in sparql(f"""
        SELECT DISTINCT ?item WHERE {{
          ?item p:P1128/ps:P1128 ?emp . FILTER(?emp >= {MIN_EMPLOYEES})
        }}""")})
    print(f"Wikidata: {len(ids)} entities have reported {MIN_EMPLOYEES:,}+ employees")

    recs = {i: {"qid": i, "label": None, "employees": [], "country": set(), "hq": set(),
                "industry": set(), "website": set(), "tickers": set(), "cik": set(),
                "parent": set(), "owned_by": set(), "types": set(), "type_ids": set(), "dissolved": set(),
                "us_subsidiaries": set(), "hq_in_us": False}
            for i in ids}

    # Properties fetched one at a time per batch to keep queries small and fast.
    simple = {
        "country": "wdt:P17", "hq": "wdt:P159", "industry": "wdt:P452",
        "parent": "wdt:P749", "owned_by": "wdt:P127", "types": "wdt:P31",
    }
    for n in range(0, len(ids), BATCH):
        chunk = ids[n:n + BATCH]
        values = " ".join(f"wd:{i}" for i in chunk)

        for b in sparql(f"""
            SELECT ?item ?itemLabel ?emp ?date WHERE {{
              VALUES ?item {{ {values} }}
              OPTIONAL {{ ?item p:P1128 ?st . ?st ps:P1128 ?emp .
                         OPTIONAL {{ ?st pq:P585 ?date }} }}
              SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,mul,fr,de,es,it,pt,nl,sv,pl,uk,ru,tr,ja,zh,ko,ar". }}
            }}"""):
            r = recs[qid(v(b, "item"))]
            r["label"] = v(b, "itemLabel")
            # "unknown value" statements come back as blank-node URIs; skip them.
            if v(b, "emp") and not v(b, "emp").startswith("http"):
                r["employees"].append({"value": float(v(b, "emp")), "date": (v(b, "date") or "")[:10]})

        for key, prop in simple.items():
            for b in sparql(f"""
                SELECT ?item ?x ?xLabel WHERE {{
                  VALUES ?item {{ {values} }} ?item {prop} ?x .
                  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,mul". }}
                }}"""):
                r = recs[qid(v(b, "item"))]
                r[key].add(v(b, "xLabel"))
                if key == "types":
                    r["type_ids"].add(qid(v(b, "x")))

        for b in sparql(f"""
            SELECT ?item ?web ?cik ?ticker ?dissolved WHERE {{
              VALUES ?item {{ {values} }}
              {{ ?item wdt:P856 ?web }} UNION {{ ?item wdt:P5531 ?cik }} UNION
              {{ ?item wdt:P576 ?dissolved }} UNION
              {{ ?item p:P414/pq:P249 ?ticker }} UNION {{ ?item wdt:P249 ?ticker }}
            }}"""):
            r = recs[qid(v(b, "item"))]
            for k, field in (("web", "website"), ("cik", "cik"), ("ticker", "tickers"), ("dissolved", "dissolved")):
                if v(b, k):
                    r[field].add(v(b, k))
        # US presence: HQ located in the US, or a subsidiary based in the US
        for b in sparql(f"""
            SELECT ?item WHERE {{
              VALUES ?item {{ {values} }} ?item wdt:P159/wdt:P17 wd:Q30 .
            }}"""):
            recs[qid(v(b, "item"))]["hq_in_us"] = True
        for b in sparql(f"""
            SELECT DISTINCT ?item ?subLabel WHERE {{
              VALUES ?item {{ {values} }}
              {{ ?sub wdt:P749 ?item }} UNION {{ ?item wdt:P355 ?sub }}
              ?sub wdt:P17 wd:Q30 .
              SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,mul". }}
            }}"""):
            recs[qid(v(b, "item"))]["us_subsidiaries"].add(v(b, "subLabel"))
        print(f"  fetched {min(n + BATCH, len(ids))}/{len(ids)}")
        time.sleep(1)

    # Which organisation types count as a business? Ask Wikidata once per distinct type.
    all_types = sorted({t for r in recs.values() for t in r["type_ids"]})
    business_types = set()
    for n in range(0, len(all_types), 100):
        values = " ".join(f"wd:{t}" for t in all_types[n:n + 100])
        for b in sparql(f"""
            SELECT DISTINCT ?t WHERE {{
              VALUES ?t {{ {values} }}
              VALUES ?root {{ wd:Q4830453 wd:Q6881511 wd:Q783794 wd:Q891723 wd:Q270791 }}
              ?t wdt:P279* ?root .
            }}"""):
            business_types.add(qid(v(b, "t")))

    out = []
    for r in recs.values():
        r["is_business_type"] = bool(r["type_ids"] & business_types)
        out.append({k: sorted(x) if isinstance(x, set) else x for k, x in r.items()})
    (CACHE / "wikidata.json").write_text(json.dumps(out, indent=1))
    print(f"Saved {len(out)} records to cache/wikidata.json "
          f"({sum(r['is_business_type'] for r in out)} typed as businesses)")


if __name__ == "__main__":
    main()
