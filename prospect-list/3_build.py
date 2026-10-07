"""Step 3: merge Wikidata + SEC + PerceptionX lists into output/10k-companies-master.xlsx.

Focus: US-headquartered companies. Non-US companies with a US presence (US-listed or a
US subsidiary) get their own tab; the rest go to "No US presence found".

Inputs (all optional except the caches from steps 1 and 2):
  cache/wikidata.json, cache/sec.json
  inputs/companies_supabase.csv  -> marks "AI-mentioned"
  inputs/clients_exclude.csv     -> flags "CURRENT CLIENT"
  inputs/andy_linkedin.csv       -> Andy's LinkedIn connections export
  inputs/andy_hubspot.csv        -> HubSpot contacts export
"""
import csv
import gzip
import importlib
import json
import re
from collections import Counter, defaultdict
from datetime import date

import requests
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

sec_reader = importlib.import_module("2_sec")  # reuse the step 2 headcount reader
from common import CACHE, INPUTS, ROOT, USER_AGENT, MAIN_THRESHOLD, MIN_EMPLOYEES, OUTPUT, norm_domain, norm_name

STALE_BEFORE = "2024-01-01"
OUTFILE = OUTPUT / "10k-companies-master-v2.xlsx"

COLUMNS = ["Company", "Domain", "Parent", "Country", "HQ city", "Industry", "Employees",
           "Employees as of", "Source", "US-listed (Y/N)", "AI-mentioned (Y/N)", "Flags",
           # Andy's network
           "Status", "Andy LinkedIn contacts", "Andy HubSpot contacts", "Andy connected (Y/N)",
           "Buyer contact (Y/N)", "Andy's contacts (up to 5, buyers first)",
           # extra reference columns, kept to the right of the requested ones
           "Ticker", "Wikidata ID", "SEC CIK"]

# Websites shared by many unrelated organisations: never merge on these.
SHARED_HOSTS = {
    "facebook.com", "twitter.com", "x.com", "linkedin.com", "instagram.com", "youtube.com",
    "wikipedia.org", "google.com", "blogspot.com", "wordpress.com", "europa.eu", "un.org",
    "github.io", "medium.com", "weebly.com", "wix.com", "sites.google.com", "archive.org",
}
GOV_LIKE = re.compile(r"(^|\.)(gov|gouv|gob|go|govt|mil|gc|admin|bund|ac|edu)\.|\.(gov|mil|edu|int)$")

NON_COMPANY = re.compile(
    r"universit|college|school|education|academ|government|ministr|department of|agency|"
    r"authority|police|gendarmerie|army|armed forces|navy|air force|military|marine corps|"
    r"coast guard|municipal|council|county|city|state of|federal|parliament|court|"
    r"nonprofit|non-profit|not-for-profit|charit|foundation|non-governmental|ngo\b|red cross|"
    r"church|relig|diocese|trade union|labor union|political party|research institute|"
    r"hospital|health service|health board|public body|executive branch|intelligence|"
    r"correction|prison|fire department|postal|ironworks|factory|plant\b|mine\b|"
    r"international organization|intergovernmental|sports club|association|civil service|"
    r"public service|profession|stadium|venue|convention cent|airport|aerodrome|road network", re.I)
# Names that mark a public body whatever Wikidata's type says ("Stavanger University Hospital").
NON_COMPANY_NAME = re.compile(
    r"\b(universit|hospital|ministry|police|army|navy|air force|armed forces|civil service|"
    r"fonction publique|council|municipality|county of|city of|state of|government|"
    r"department of|school|college|health (?:service|board|trust|authority)|red cross|postal service)", re.I)
REVIEW_REVENUE = 300_000_000      # US-HQ filer above this with no headcount found -> "Check headcount" tab
REVIEW_REVENUE_HIGH = 5_000_000_000  # ...or with a parsed headcount under the floor (likely misread)
FREE_MAIL = {"gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
             "icloud.com", "me.com", "aol.com", "msn.com", "protonmail.com", "proton.me", "gmx.com",
             "hotmail.co.uk", "yahoo.co.uk", "btinternet.com", "perceptionx.ai"}
MIN_REVENUE_PER_EMPLOYEE = 15_000  # below this an SEC headcount is a misread (units, sq ft, ...)
SANITY_RATIO = 3          # SEC vs Wikidata more than 3x apart (either way) -> flag
SANITY_MAX = 1_000_000    # any headcount above this -> flag
UNVERIFIED_MIN = 50_000   # Wikidata-only, undated, at least this big -> "Check headcount" tab
# Roles from job titles. BUYER is checked first, so "Employer Brand Manager" is a buyer.
BUYER_RE = re.compile(r"\b(hr|human resources?|talent|recruit\w*|employer brand\w*|people|early careers?|"
                      r"comms|communications?|chro|culture|employee (?:experience|engagement|value)|hrbp|"
                      r"careers?|workforce|internal comms|compensation|benefits|total rewards?|reward|"
                      r"(?:global|international) mobility)\b", re.I)
INFLUENCER_RE = re.compile(r"\b(marketing|brand\w*|cmo)\b", re.I)
STATUS_ORDER = ["CURRENT CLIENT", "ACTIVE", "LINKEDIN ONLY", "CONNECTED NOT BUYER", "UNTOUCHED"]
PLAUSIBLE_MAX = 2_500_000  # Walmart, the largest private employer, is about 2.1-2.3m
# Wikidata batch with junk headcounts (stadiums and road networks with 1m+ "employees"):
# Ukrainian entities dated 1 January 2024/2025. Ignore those statements.
BAD_BATCHES = [("Ukraine", "2024-01-01"), ("Ukraine", "2025-01-01")]
STRONG_COMPANY = re.compile(
    r"public company|\bcompany\b|corporation|enterprise|\bbusiness\b|\bbank\b|manufacturer|"
    r"\bchain\b|airline|conglomerate|holding|retailer|\bfirm\b|state-owned|insurance|"
    r"operator|carrier|producer|brand", re.I)

US_STATES = set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT "
                "NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split())


def classify(name, types, is_business_type):
    """'company', 'non-company' or 'unclear' from the name and Wikidata 'instance of' labels."""
    joined = " | ".join(types)
    if NON_COMPANY_NAME.search(name or "") and "public company" not in joined:
        return "non-company"
    strong = bool(STRONG_COMPANY.search(joined))
    if NON_COMPANY.search(joined) and not strong:
        return "non-company"
    if strong or is_business_type:
        return "company"
    return "unclear"


def latest(counts):
    """Most recent dated headcount; falls back to an undated one."""
    dated = [c for c in counts if c["date"]]
    if dated:
        return max(dated, key=lambda c: (c["date"], c["value"]))
    return max(counts, key=lambda c: c["value"]) if counts else None


def domain_key(url):
    """(domain shown in sheet, key used for merging or None)."""
    d = norm_domain(url)
    if not d:
        return "", None
    host = re.sub(r"^[a-z]+://", "", str(url).lower()).split("/")[0].removeprefix("www.")
    if d in SHARED_HOSTS or host in SHARED_HOSTS:
        return "", None
    if GOV_LIKE.search(host):
        return host, None  # government/education sites: show, but don't merge on them
    return d, d


def read_csv_loose(path):
    """Read a CSV with unknown headers; returns (rows, name_col, domain_col)."""
    if not path.exists():
        return None, None, None
    with path.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        return [], None, None
    cols = list(rows[0].keys())
    low = {c: c.lower().strip() for c in cols}
    name_col = next((c for c in cols if low[c] in ("company", "company_name", "name", "organization",
                                                    "organisation", "brand", "employer")), None) \
        or next((c for c in cols if "name" in low[c] or "company" in low[c]), cols[0])
    dom_col = next((c for c in cols if any(k in low[c] for k in ("domain", "website", "url", "site"))), None)
    return rows, name_col, dom_col


def main():
    today = date.today().isoformat()
    wd = json.loads((CACHE / "wikidata.json").read_text())
    sec_path = CACHE / "sec.json"
    if sec_path.exists():
        sec = json.loads(sec_path.read_text())
    else:  # step 2 still running: use the filings read so far
        sec = []
        for f in (CACHE / "sec").glob("*.json"):
            try:
                rec = json.loads(f.read_text())
            except json.JSONDecodeError:  # being written right now
                continue
            if rec.get("parser"):  # skip answers from the first, less accurate reader
                sec.append(rec)
        print(f"WARNING: step 2 has not finished; using the {len(sec)} SEC filers read so far")
    rev_path = CACHE / "sec_revenue.json"
    revenue = {int(k): v for k, v in json.loads(rev_path.read_text()).items()} if rev_path.exists() else {}

    # ---- 1. Wikidata records -> entities --------------------------------------------
    ents = []
    ignored = 0
    for r in wd:
        counts = [c for c in r["employees"]
                  if not any(ctry in r["country"] and c["date"] == d for ctry, d in BAD_BATCHES)]
        ignored += len(r["employees"]) - len(counts)
        best = latest(counts)
        if not best:
            continue
        shown, key = domain_key(r["website"][0] if r["website"] else "")
        ents.append({
            "name": r["label"] or r["qid"], "domain": shown, "key": key,
            "parent": "; ".join(r["parent"]), "country": "; ".join(r["country"]),
            "city": "; ".join(r["hq"]), "industry": "; ".join(r["industry"]),
            "wd_emp": int(best["value"]), "wd_date": best["date"],
            "sec_emp": None, "sec_date": "", "sec_form": "", "sec_snippet": "",
            "tickers": set(r["tickers"]), "qids": {r["qid"]}, "ciks": {int(c) for c in r["cik"] if c.isdigit()},
            "kind": "defunct" if r.get("dissolved") else classify(r["label"], r["types"], r["is_business_type"]),
            "dissolved": (r.get("dissolved") or [""])[0][:10], "types": "; ".join(r["types"]),
            "us_listed": False, "ai": False, "merged": [],
            # HQ location first; country only when it is the single country listed
            "us_hq": (bool(r.get("hq_in_us")) and (not r["country"] or "United States" in r["country"]))
                     or r["country"] == ["United States"],
            "us_subs": r.get("us_subsidiaries", []),
            "extra_flags": ["NO NAME"] if re.fullmatch(r"Q\d+", r["label"] or "Q") else [],
        })
    print(f"Wikidata: ignored {ignored} headcount statements from known bad batches")

    # ---- 2. Merge Wikidata duplicates on domain ---------------------------------------
    by_key = defaultdict(list)
    for e in ents:
        by_key[e["key"] or ("qid:" + next(iter(e["qids"])))].append(e)
    merged = []
    for group in by_key.values():
        # keep the record that is not a child of another in the group, then the biggest
        names = {g["name"] for g in group}
        group.sort(key=lambda g: (g["parent"] in names, g["kind"] != "company", -g["wd_emp"]))
        head = group[0]
        for other in group[1:]:
            head["merged"].append(other["name"])
            head["tickers"] |= other["tickers"]
            head["qids"] |= other["qids"]
            head["ciks"] |= other["ciks"]
            for f in ("country", "city", "industry", "domain"):
                head[f] = head[f] or other[f]
            head["us_subs"] = sorted(set(head["us_subs"]) | set(other["us_subs"]))
            if other["wd_date"] > head["wd_date"] and other["wd_emp"]:
                head["wd_emp"], head["wd_date"] = other["wd_emp"], other["wd_date"]
        merged.append(head)
    ents = merged

    # ---- 2b. Reviewed corrections (corrections.csv), tied to one filing each ---------
    corr = {}
    corr_path = ROOT / "corrections.csv"
    if corr_path.exists():
        with corr_path.open(newline="") as f:
            for row in csv.DictReader(f):
                corr[(int(row["cik"]), row["accession"])] = row
    for s in sec:
        c = corr.get((s["cik"], s.get("accession")))
        if c:
            s["employees"] = int(c["employees"]) if c["employees"] else None
            s["review_note"] = f"{c['action']}: \"{c['evidence']}\""
            s["snippet"] = c["evidence"]

    # ---- 2c. Subsidiary filers -> parent -----------------------------------------------
    # One combined annual report (same accession) covers parent and subsidiaries, e.g. Entergy;
    # or a managed fund repeats its manager's headcount (BlackRock TCP Capital -> BlackRock).
    def rev_of(s):
        return revenue.get(s["cik"], {}).get("revenue") or 0
    groups = defaultdict(list)
    for s in sec:
        if s.get("accession"):
            groups[("acc", s["accession"])].append(s)
        if s["employees"] and s["employees"] >= MIN_EMPLOYEES:
            groups[("same", (norm_name(s["name"]).split() or [""])[0], s["employees"], s["period"])].append(s)
    absorbed = set()
    for members in groups.values():
        members = [m for m in members if m["cik"] not in absorbed]
        if len(members) < 2:
            continue
        head = max(members, key=lambda m: (rev_of(m), -len(m["name"])))
        for m in members:
            if m is not head:
                absorbed.add(m["cik"])
                head.setdefault("merged_filers", []).append(m["name"])
                head["tickers"] = sorted(set(head["tickers"]) | set(m["tickers"]))
    sec = [s for s in sec if s["cik"] not in absorbed]
    print(f"SEC: merged {len(absorbed)} subsidiary filers into their parent")

    # ---- 3. Attach SEC filings ------------------------------------------------------
    by_cik = {c: e for e in ents for c in e["ciks"]}
    by_ticker = {t.upper(): e for e in ents for t in e["tickers"]}
    by_dom = {e["key"]: e for e in ents if e["key"]}
    by_nm = {}
    for e in ents:
        by_nm.setdefault(norm_name(e["name"]), e)
    sec_only = 0
    for s in sec:
        e = (by_cik.get(s["cik"])
             # tickers repeat across exchanges (DTE = Deutsche Telekom in Frankfurt, DTE Energy in NY),
             # so a ticker match also needs the names to start the same way
             or next((by_ticker[t.upper()] for t in s["tickers"] if t.upper() in by_ticker
                      and norm_name(by_ticker[t.upper()]["name"]).split()[:1] == norm_name(s["name"]).split()[:1]),
                     None)
             or by_dom.get(norm_domain(s["website"]))
             or by_nm.get(norm_name(s["name"])))
        st = (s.get("state") or "").upper()
        rev = revenue.get(s["cik"], {}).get("revenue") or 0
        review = st in US_STATES and (
            (not s["employees"] and rev >= REVIEW_REVENUE)
            or (s["employees"] and s["employees"] < MIN_EMPLOYEES and rev >= REVIEW_REVENUE_HIGH))
        loose = None
        if review and not s["employees"]:
            # second, looser read of the saved filing text before sending it to "Check headcount"
            tpath = CACHE / "sec_text" / f"{s['cik']}_{s.get('accession')}.txt.gz"
            if tpath.exists():
                loose = sec_reader.extract_headcount(gzip.decompress(tpath.read_bytes()).decode(), min_score=0)
                if loose[0] and loose[0] < MIN_EMPLOYEES:
                    review = False  # confidently small
        if e is None:
            if not review and (not s["employees"] or s["employees"] < MIN_EMPLOYEES):
                continue
            shown, key = domain_key(s["website"])
            e = {"name": s["name"], "domain": shown, "key": key, "parent": "",
                 "country": "United States" if st in US_STATES else (s.get("state") or ""),
                 "city": (s.get("city") or "").title(), "industry": s.get("sic") or "",
                 "wd_emp": None, "wd_date": "", "tickers": set(), "qids": set(), "ciks": {s["cik"]},
                 "kind": "review" if review else "company", "types": "", "us_listed": False, "ai": False,
                 "merged": [], "extra_flags": [], "us_hq": st in US_STATES, "us_subs": []}
            if review:
                if loose and loose[0]:
                    e["extra_flags"].append(f"POSSIBLE HEADCOUNT {loose[0]:,}: \"{loose[1][:200]}\"")
                e["extra_flags"].append(
                    f"HEADCOUNT NOT FOUND IN {s.get('form') or 'FILING'}; revenue ${rev / 1e9:,.1f}bn"
                    if not s["employees"] else
                    f"READ {s['employees']:,} FROM FILING BUT revenue ${rev / 1e9:,.1f}bn; check")
            if not shown:
                e["extra_flags"].append("NO DOMAIN")
            ents.append(e)
            sec_only += 1
        e["us_listed"] = True
        e["merged"] += s.get("merged_filers", [])
        if s.get("review_note"):
            e["extra_flags"].append(s["review_note"])
        if st in US_STATES and (s.get("form") or "").startswith("10-K"):
            e["us_hq"] = True  # a 10-K from a US address: US HQ (20-F filers are foreign)
        e["tickers"] |= set(s["tickers"])
        e["ciks"].add(s["cik"])
        if s["employees"] and rev and rev / s["employees"] < MIN_REVENUE_PER_EMPLOYEE:
            e["extra_flags"].append(f"SEC HEADCOUNT REJECTED ({s['employees']:,} vs revenue ${rev / 1e6:,.0f}m)")
            s = {**s, "employees": None}
        if s["employees"] and (e.get("sec_emp") is None or (s["period"] or "") > e.get("sec_date", "")):
            e.update(sec_emp=s["employees"], sec_date=s["period"] or "", sec_form=s["form"],
                     sec_snippet=s["snippet"] or "")
        if not e["industry"] and s.get("sic"):
            e["industry"] = s["sic"]
    print(f"SEC: {len(sec)} filers read, {sec_only} US-listed companies added that Wikidata lacks")

    # ---- 3b. Forbes largest private companies ----------------------------------------
    forbes_path = CACHE / "forbes.json"
    forbes = json.loads(forbes_path.read_text()) if forbes_path.exists() else []
    by_nm = {}
    for e in ents:
        for n in [e["name"], *e["merged"]]:
            by_nm.setdefault(norm_name(n), e)
    f_new = 0
    for f in forbes:
        if not f["employees"]:
            continue
        e = by_nm.get(norm_name(f["name"]))
        if e is None:
            if f["employees"] < MIN_EMPLOYEES:
                continue
            e = {"name": f["name"], "domain": "", "key": None, "parent": "", "country": f["country"],
                 "city": f["city"], "industry": f["industry"], "wd_emp": None, "wd_date": "",
                 "tickers": set(), "qids": set(), "ciks": set(), "kind": "company", "types": "",
                 "us_listed": False, "ai": False, "merged": [], "extra_flags": ["NO DOMAIN"],
                 "us_hq": f["country"] == "United States", "us_subs": []}
            ents.append(e)
            by_nm[norm_name(f["name"])] = e
            f_new += 1
        e["forbes"] = (f"Forbes Largest Private Cos {f['list_year']}", f["employees"], f["as_of"])
        if f["country"] == "United States":
            e["us_hq"] = True
        e["city"] = e["city"] or f["city"]
        e["industry"] = e["industry"] or f["industry"]
    print(f"Forbes: {len(forbes)} private companies read, {f_new} added that other sources lack")

    # ---- 4. Pick headcount, note disagreements ---------------------------------------
    for e in ents:
        e.setdefault("sec_emp", None)
        e.setdefault("sec_date", "")
        cands = []
        if e.get("sec_emp"):
            cands.append(("SEC " + e.get("sec_form", "annual report"), e["sec_emp"], e["sec_date"]))
        if e.get("wd_emp"):
            cands.append(("Wikidata", e["wd_emp"], e["wd_date"]))
        if e.get("forbes"):
            cands.append(e["forbes"])
        if not cands:
            e["emp"], e["asof"], e["source"] = None, "", ""
            continue
        cands.sort(key=lambda c: c[2] or "", reverse=True)  # most recent first
        src, e["emp"], e["asof"] = cands[0]
        others = [c[0] for c in cands[1:]]
        e["source"] = src + (f" (also {', '.join(others)})" if others else "")
        if len(cands) >= 2:
            a, b = cands[0][1], cands[1][1]
            if abs(a - b) / max(a, b) > 0.05:
                e["extra_flags"].append(
                    "HEADCOUNTS DIFFER: " + "; ".join(f"{c[0]} {c[1]:,} ({c[2] or 'no date'})" for c in cands))
        sec_c = next((c for c in cands if c[0].startswith("SEC")), None)
        wd_c = next((c for c in cands if c[0] == "Wikidata"), None)
        reviewed = any(f.startswith(("CORRECTED", "CHECKED")) for f in e["extra_flags"])
        if sec_c and wd_c and not reviewed:
            ratio = sec_c[1] / wd_c[1]
            if ratio > SANITY_RATIO or ratio < 1 / SANITY_RATIO:
                e["extra_flags"].append(f"CHECK HEADCOUNT: SEC is {ratio:.1f}x Wikidata")
        if (e["emp"] or 0) > SANITY_MAX and not reviewed:
            e["extra_flags"].append("CHECK HEADCOUNT: over 1,000,000")
        if src == "Wikidata" and not e["asof"] and e["emp"] >= UNVERIFIED_MIN:
            e["unverified"] = True
            e["extra_flags"].append("UNVERIFIED: Wikidata only, no date")

    # ---- 5. PerceptionX lists --------------------------------------------------------
    by_dom = {e["key"]: e for e in ents if e.get("key")}
    by_nm = {}
    for e in ents:
        for n in [e["name"], *e["merged"]]:
            by_nm.setdefault(norm_name(n), e)

    ai_only = []
    rows, ncol, dcol = read_csv_loose(INPUTS / "companies_supabase.csv")
    if rows is None:
        print("NOTE: inputs/companies_supabase.csv not found; AI-mentioned column left as N")
    else:
        for row in rows:
            name, dom = row.get(ncol, "").strip(), row.get(dcol, "") if dcol else ""
            if not name:
                continue
            e = (by_dom.get(norm_domain(dom)) if dom else None) or by_nm.get(norm_name(name))
            if e:
                e["ai"] = True
            else:
                shown, key = domain_key(dom)
                e = {"name": name, "domain": shown, "key": key, "parent": "", "country": "",
                     "city": "", "industry": "", "emp": None, "asof": "", "source": "PerceptionX",
                     "tickers": set(), "qids": set(), "ciks": set(), "kind": "ai-only",
                     "us_listed": False, "ai": True, "merged": [], "extra_flags": ["NO HEADCOUNT"]}
                ents.append(e)
                ai_only.append(e)
                if key:
                    by_dom[key] = e
                by_nm.setdefault(norm_name(name), e)
        print(f"AI-mentioned: {len(rows)} names, {len(rows) - len(ai_only)} matched, {len(ai_only)} added without headcount")

    rows, ncol, dcol = read_csv_loose(INPUTS / "clients_exclude.csv")
    if rows is None:
        print("NOTE: inputs/clients_exclude.csv not found; no CURRENT CLIENT flags set")
    else:
        hit = 0
        for row in rows:
            name, dom = row.get(ncol, "").strip(), row.get(dcol, "") if dcol else ""
            targets = {id(e): e for e in ents
                       if (dom and e.get("key") and e["key"] == norm_domain(dom))
                       or (name and norm_name(name) in {norm_name(n) for n in [e["name"], *e["merged"]]})}
            possible = (row.get("status") or "").strip().lower() == "possible"
            for e in targets.values():
                if possible:
                    e["extra_flags"].insert(0, "POSSIBLE CLIENT - confirm")
                else:
                    e["client"] = True
                    e["extra_flags"].insert(0, "CURRENT CLIENT")
                hit += 1
        print(f"Clients: {len(rows)} names, {hit} rows flagged CURRENT CLIENT")

    # ---- 6. Size filter, roll-up, stale -----------------------------------------------
    ents = [e for e in ents if e["kind"] in ("ai-only", "review") or (e["emp"] or 0) >= MIN_EMPLOYEES]
    listed = {e["name"]: e for e in ents if e["kind"] in ("company", "unclear")}

    def ultimate(e, seen=()):
        p = e["parent"].split("; ")[0] if e["parent"] else ""
        if not p or p not in listed or p in seen or p == e["name"]:
            return None
        up = ultimate(listed[p], (*seen, e["name"]))
        return up or listed[p]

    for e in ents:
        flags = list(e["extra_flags"])
        if e["kind"] not in ("ai-only", "review") and (not e["asof"] or e["asof"] < STALE_BEFORE):
            flags.append("STALE" + ("" if e["asof"] else " (no date)"))
        if e["kind"] == "unclear":
            flags.append("CHECK TYPE")
        undated_big = e["source"] == "Wikidata" and not e["asof"] and (e["emp"] or 0) >= 100_000
        if ((e["emp"] or 0) > PLAUSIBLE_MAX or undated_big) and "CHECK HEADCOUNT" not in flags:
            flags.append("CHECK HEADCOUNT")
        if e["merged"]:
            flags.append("MERGED: " + "; ".join(e["merged"][:5]) + ("…" if len(e["merged"]) > 5 else ""))
        e["flags"] = flags
        top = ultimate(e) if e["kind"] in ("company", "unclear") else None
        if e.get("client") and e["kind"] != "non-company":
            e["tab"] = "clients"
            if top:
                e["parent"] = top["name"]
        elif top:
            e["parent"] = top["name"]
            e["tab"] = "subs"
        elif e["kind"] == "non-company":
            e["tab"] = "nonco"
        elif e["kind"] == "defunct":
            e["tab"] = "defunct"
            e["flags"].insert(0, f"DISSOLVED {e['dissolved']}")
        elif e["kind"] == "ai-only":
            e["tab"] = "ai"
        elif e["kind"] == "review" or e.get("unverified"):
            e["tab"] = "check"
        elif e.get("us_hq"):
            e["tab"] = "main" if e["emp"] >= MAIN_THRESHOLD else "mid"
        elif e["us_listed"] or e.get("us_subs"):
            e["tab"] = "global"
            basis = (["US-listed"] if e["us_listed"] else []) + \
                    ([f"US subsidiary: {', '.join(e['us_subs'][:3])}"] if e.get("us_subs") else [])
            e["flags"].append("US PRESENCE: " + "; ".join(basis))
        else:
            e["tab"] = "nous"

    # ---- 6b. Andy's network: LinkedIn + HubSpot ---------------------------------------
    idx_name, idx_dom = {}, {}
    for e in ents:
        for n in [e["name"], *e["merged"]]:
            idx_name.setdefault(norm_name(n), e)
        if e.get("key"):
            idx_dom.setdefault(e["key"], e)

    def by_company(company):
        """Exact name match, then shorter prefixes ('Amazon Web Services' -> 'Amazon')."""
        words = norm_name(re.sub(r"\(.*?\)", " ", company or "")).split()
        for k in range(len(words), 0, -1):
            key = " ".join(words[:k])
            if key in idx_name and (k > 1 or len(key) >= 4):
                return idx_name[key]
        return None

    def role_of(title):
        if not title:
            return "UNKNOWN"
        if BUYER_RE.search(title):
            return "BUYER"
        return "INFLUENCER" if INFLUENCER_RE.search(title) else "OTHER"

    for e in ents:
        e["li"], e["hs"] = [], []
    li_rows, hs_rows = 0, 0
    titles = {}  # (first, last) -> LinkedIn position, used to give HubSpot contacts a role
    li_path = INPUTS / "andy_linkedin.csv"
    if li_path.exists():
        lines_ = li_path.read_text(encoding="utf-8-sig").splitlines()
        start = next(i for i, l in enumerate(lines_) if l.startswith("First Name"))
        for row in csv.DictReader(lines_[start:]):
            li_rows += 1
            first, last = (row.get("First Name") or "").strip(), (row.get("Last Name") or "").strip()
            titles[(first.lower(), last.lower())] = row.get("Position") or ""
            e = by_company(row.get("Company"))
            if e:
                e["li"].append({"name": f"{first} {last}", "title": row.get("Position") or "",
                                "company": row.get("Company"), "src": "LinkedIn",
                                "email": (row.get("Email Address") or "").lower(),
                                "role": role_of(row.get("Position"))})
    hs_path = INPUTS / "andy_hubspot.csv"
    if hs_path.exists():
        with hs_path.open(newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                hs_rows += 1
                email = (row.get("Email") or "").lower()
                dom = norm_domain(email.split("@")[-1]) if "@" in email else ""
                e = (idx_dom.get(dom) if dom and dom not in FREE_MAIL else None) \
                    or by_company(row.get("Associated Company"))
                if e and dom != "perceptionx.ai":
                    first, last = (row.get("First Name") or "").strip(), (row.get("Last Name") or "").strip()
                    title = titles.get((first.lower(), last.lower()), "")
                    e["hs"].append({"name": f"{first} {last}".strip() or email, "title": title,
                                    "company": row.get("Associated Company") or dom, "src": "HubSpot",
                                    "email": email, "role": role_of(title)})
    # contacts at a subsidiary also count for its parent
    parents = {e["name"]: e for e in ents if e["tab"] != "subs"}
    for e in ents:
        if e["tab"] == "subs" and e["parent"] in parents:
            parents[e["parent"]]["li"] += e["li"]
            parents[e["parent"]]["hs"] += e["hs"]
    print(f"Andy: {li_rows} LinkedIn connections, {hs_rows} HubSpot contacts read")

    # ---- 6c. Status ------------------------------------------------------------------
    for e in ents:
        e["buyer"] = any(c["role"] == "BUYER" for c in e["li"] + e["hs"])
        if e.get("client"):
            e["status"] = "CURRENT CLIENT"
        elif any(c["role"] == "BUYER" for c in e["hs"]):
            e["status"] = "ACTIVE"
        elif any(c["role"] == "BUYER" for c in e["li"]):
            e["status"] = "LINKEDIN ONLY"
        elif e["li"] or e["hs"]:
            e["status"] = "CONNECTED NOT BUYER"
        else:
            e["status"] = "UNTOUCHED"

    # ---- 6d. Fill missing website domains ----------------------------------------------
    def resembles(dom, name):
        label = dom.split(".")[0]
        words = [w for w in norm_name(name).split() if len(w) >= 3]
        return any(w[:4] in label or label in w for w in words) or \
            "".join(w[0] for w in norm_name(name).split()) == label  # initials: "ibm"
    lookup_path = CACHE / "domain_lookup.json"
    lookup = json.loads(lookup_path.read_text()) if lookup_path.exists() else {}

    throttled = [False]

    def wikidata_domain(name):
        if name in lookup:
            return lookup[name]
        if throttled[0]:
            return ""  # Wikidata said "too many requests" earlier this run; try again next run
        dom = ""
        try:
            time.sleep(1)  # Wikidata asks for one request at a time, unhurried
            r = requests.get("https://www.wikidata.org/w/api.php", headers={"User-Agent": USER_AGENT}, timeout=30,
                             params={"action": "wbsearchentities", "search": name, "language": "en",
                                     "type": "item", "limit": 3, "format": "json"})
            if r.status_code == 429:
                throttled[0] = True
                print("  Wikidata rate limit reached; remaining domain lookups wait for the next run")
                return ""
            hits = r.json().get("search", [])
            ids = "|".join(h["id"] for h in hits)
            if ids:
                r = requests.get("https://www.wikidata.org/w/api.php", headers={"User-Agent": USER_AGENT},
                                 timeout=30, params={"action": "wbgetentities", "ids": ids,
                                                     "props": "claims", "format": "json"})
                if r.status_code == 429:
                    throttled[0] = True
                    return ""
                ents_ = r.json()
                for h in hits:
                    for c in ents_.get("entities", {}).get(h["id"], {}).get("claims", {}).get("P856", []):
                        d = norm_domain(c["mainsnak"].get("datavalue", {}).get("value", ""))
                        if d and resembles(d, name):
                            dom = d
                            break
                    if dom:
                        break
        except Exception:
            return ""  # try again next run
        lookup[name] = dom
        lookup_path.write_text(json.dumps(lookup, indent=1))  # save as we go
        return dom

    filled = Counter()
    for e in ents:
        if e["domain"] or e["tab"] not in ("clients", "main", "mid", "global", "check"):
            continue
        doms = Counter(norm_domain(c["email"].split("@")[-1]) for c in e["li"] + e["hs"]
                       if "@" in c["email"])
        doms = [d for d, n in doms.most_common() if d not in FREE_MAIL and (n >= 2 or resembles(d, e["name"]))]
        if doms:
            e["domain"], how = doms[0], "contact emails"
        else:
            e["domain"], how = wikidata_domain(re.sub(r"\s*/[A-Za-z]{2,3}/?\s*$", "", e["name"])), "Wikidata search"
        if e["domain"]:
            filled[how] += 1
            e["flags"] = [f for f in e["flags"] if f != "NO DOMAIN"] + [f"DOMAIN FROM {how.upper()}"]
    lookup_path.write_text(json.dumps(lookup, indent=1))
    print(f"Domains filled: {dict(filled)}; still missing on company tabs: "
          f"{sum(1 for e in ents if not e['domain'] and e['tab'] in ('clients', 'main', 'mid', 'global', 'check'))}")

    # ---- 7. Write workbook ----------------------------------------------------------
    def row_of(e):
        return [e["name"], e["domain"], e["parent"], e["country"], e["city"], e["industry"],
                e["emp"], e["asof"], e["source"], "Y" if e["us_listed"] else "N",
                "Y" if e["ai"] else "N", " | ".join(e["flags"]),
                e["status"], len(e["li"]), len(e["hs"]), "Y" if (e["li"] or e["hs"]) else "N",
                "Y" if e["buyer"] else "N",
                "; ".join(f"{c['name']}, {c['title'] or 'no title'} ({c['company']}) [{c['src']}] {{{c['role']}}}"
                          for c in sorted(e["hs"] + e["li"],
                                          key=lambda c: (c["role"] != "BUYER", c["src"] != "HubSpot"))[:5]),
                ", ".join(sorted(e["tickers"]))[:80], ", ".join(sorted(e["qids"])),
                ", ".join(str(c) for c in sorted(e["ciks"]))]

    tabs = [("clients", "Current clients"), ("main", f"US HQ {MAIN_THRESHOLD // 1000}k+"),
            ("mid", f"US HQ {MIN_EMPLOYEES // 1000}k-{MAIN_THRESHOLD // 1000}k"),
            ("global", "Global HQ, US presence"), ("check", "Check headcount (US HQ)"),
            ("nous", "No US presence found"), ("subs", "Subsidiaries & brands"),
            ("ai", "AI-mentioned, no headcount"), ("nonco", "Not companies"), ("defunct", "Defunct")]
    wb = Workbook()
    summary = wb.active
    summary.title = "Summary"
    head_font, head_fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="1F2A44")
    for key, title in tabs:
        ws = wb.create_sheet(title)
        cols = COLUMNS + (["Wikidata type"] if key == "nonco" else [])
        ws.append(cols)
        sel = sorted((e for e in ents if e["tab"] == key), key=lambda e: -(e["emp"] or 0))
        for e in sel:
            ws.append(row_of(e) + ([e["types"]] if key == "nonco" else []))
        for c in ws[1]:
            c.font, c.fill = head_font, head_fill
        ws.freeze_panes = "B2"
        ws.auto_filter.ref = ws.dimensions
        for i, w in enumerate([34, 22, 26, 18, 18, 30, 12, 13, 26, 10, 12, 50, 20, 10, 10, 10, 10, 80,
                               18, 14, 12, 40][:len(cols)], 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        for (cell,) in ws.iter_rows(min_row=2, min_col=7, max_col=7):
            cell.number_format = "#,##0"

    # SEC evidence: the sentence each SEC headcount was read from, for spot checks
    ws = wb.create_sheet("SEC evidence")
    ws.append(["Company", "Employees (SEC)", "Period", "Form", "Sentence the number was read from"])
    for e in sorted((e for e in ents if e.get("sec_emp") and e["tab"] != "ai"), key=lambda e: e["name"]):
        ws.append([e["name"], e["sec_emp"], e["sec_date"], e.get("sec_form", ""), e.get("sec_snippet", "")])
    for c in ws[1]:
        c.font, c.fill = head_font, head_fill
    for col, w in zip("ABCDE", (34, 14, 12, 8, 140)):
        ws.column_dimensions[col].width = w

    # Summary
    def counts(key):
        return [e for e in ents if e["tab"] == key]

    main, mid = counts("main"), counts("mid")
    is_stale = lambda e: any(f.startswith("STALE") for f in e["flags"])
    conn = lambda grp: sum(bool(e["li"] or e["hs"]) for e in grp)
    status_rows = [["Status (all company tabs)", "US HQ 10k+", "US HQ 5k-10k", "Global, US presence",
                    "Check headcount", "Current clients"]]
    for st in STATUS_ORDER:
        status_rows.append([st] + [sum(e["status"] == st for e in counts(k))
                                   for k in ("main", "mid", "global", "check", "clients")])
    lines = [
        ["10k+ companies master list (US HQ focus)", ""],
        ["Built", today],
        ["", ""],
        ["Current clients (own tab)", len(counts("clients"))],
        ["POSSIBLE CLIENT - confirm (all tabs)", sum("POSSIBLE CLIENT - confirm" in e["flags"] for e in ents)],
        ["CORRECTED headcounts (re-read from the filing)", sum(any(f.startswith("CORRECTED") for f in e["flags"]) for e in ents)],
        [f"US HQ companies with {MAIN_THRESHOLD:,}+ employees", len(main)],
        [f"  of which STALE (headcount before {STALE_BEFORE[:4]} or undated)", sum(map(is_stale, main))],
        ["  Andy connected (LinkedIn or HubSpot)", conn(main)],
        ["  Andy NOT connected", len(main) - conn(main)],
        [f"US HQ companies with {MIN_EMPLOYEES:,}-{MAIN_THRESHOLD - 1:,} employees", len(mid)],
        ["  of which STALE", sum(map(is_stale, mid))],
        ["  Andy connected", conn(mid)],
        ["  Andy NOT connected", len(mid) - conn(mid)],
        ["Global HQ with US presence (5k+)", len(counts("global"))],
        ["  Andy connected", conn(counts("global"))],
        ["US HQ, US-listed, headcount not found (check by hand)", len(counts("check"))],
        ["No US presence found", len(counts("nous"))],
        ["Subsidiaries & brands rolled up to a listed parent", len(counts("subs"))],
        ["AI-mentioned names with no headcount", len(counts("ai"))],
        ["Not companies (government, education, charity etc.)", len(counts("nonco"))],
        ["Defunct (dissolved per Wikidata)", len(counts("defunct"))],
        ["US-listed (US HQ 10k+)", sum(e["us_listed"] for e in main)],
        ["AI-mentioned (US HQ 10k+)", sum(e["ai"] for e in main)],
        ["CURRENT CLIENT (all tabs)", sum("CURRENT CLIENT" in e["flags"] for e in ents)],
        ["CHECK HEADCOUNT (SEC vs Wikidata >3x apart, or over 1m)",
         sum(any(f.startswith("CHECK HEADCOUNT") for f in e["flags"]) for e in ents)],
        ["UNVERIFIED (Wikidata only, undated, 50k+; on Check tab)", sum(bool(e.get("unverified")) for e in ents)],
    ]
    for line in lines:
        summary.append(line)
    summary.append([])
    for i, line in enumerate(status_rows):
        summary.append(line)
        if i == 0:
            for c in summary[summary.max_row]:
                c.font = Font(bold=True)
    summary["A1"].font = Font(bold=True, size=14)

    def block(col, title, counter):
        r0 = 1
        summary.cell(r0, col, title).font = Font(bold=True)
        summary.cell(r0 + 1, col, "").font = Font(bold=True)
        hdr = (f"{MAIN_THRESHOLD // 1000}k+", f"{MIN_EMPLOYEES // 1000}k-{MAIN_THRESHOLD // 1000}k")
        summary.cell(r0 + 1, col + 1, hdr[0]).font = Font(bold=True)
        summary.cell(r0 + 1, col + 2, hdr[1]).font = Font(bold=True)
        for i, (k, (a, b)) in enumerate(counter, r0 + 2):
            summary.cell(i, col, k)
            summary.cell(i, col + 1, a)
            summary.cell(i, col + 2, b)

    def tally(field, split):
        c = defaultdict(lambda: [0, 0])
        for e in main + mid + counts("global"):
                idx = 0 if (e["emp"] or 0) >= MAIN_THRESHOLD else 1
                vals = [v for v in e[field].split("; ") if v] if split else [e[field]]
                for v in vals or ["(unknown)"]:
                    c[v][idx] += 1
        return sorted(c.items(), key=lambda kv: (-kv[1][0], -kv[1][1], kv[0]))

    block(4, "Count by country", tally("country", True))
    block(8, "Count by industry (a company can sit in several)", tally("industry", True))
    for col, w in (("A", 58), ("B", 12), ("D", 30), ("E", 8), ("F", 8), ("H", 40), ("I", 8), ("J", 8)):
        summary.column_dimensions[col].width = w
    for row in summary.iter_rows():
        for c in row:
            c.alignment = Alignment(vertical="top")

    wb.save(OUTFILE)
    print(f"Saved {OUTFILE}")
    for line in lines[3:]:
        print(f"  {line[0]}: {line[1]}")


if __name__ == "__main__":
    main()
