"""Step 2: employee counts for US-listed companies from their latest annual filing.

SEC does not publish headcount as a structured data field, so this reads the
headcount sentence out of the latest 10-K (US) or 20-F (foreign) text.
Results are cached per company in cache/sec/, so a re-run only fetches new filings.

Usage: python3 2_sec.py            # all exchange-listed filers
       python3 2_sec.py AAPL PFE    # just these tickers (for testing)
"""
import gzip
import html
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from common import CACHE, get

SEC_CACHE = CACHE / "sec"
SEC_CACHE.mkdir(exist_ok=True)
TEXT_CACHE = CACHE / "sec_text"  # gzipped filing text, so parser fixes don't need re-downloads
TEXT_CACHE.mkdir(exist_ok=True)
PARSER_VERSION = 2  # bump when extract_headcount changes; cached answers are then re-parsed
ANNUAL_FORMS = ("10-K", "20-F", "10-K405", "10-KT")
REQ_INTERVAL = 0.13  # SEC allows 10 requests/second; stay under it
_last = [0.0]
_lock = threading.Lock()


def sec_get(url, **kw):
    with _lock:
        wait = REQ_INTERVAL - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
    return get(url, **kw)


WORKER_WORDS = r"(?:full[- ]time\s+|part[- ]time\s+|permanent\s+|total\s+|active\s+|global\s+|)" \
               r"(?:employees|colleagues|team\s+members|associates|teammates|people|" \
               r"workers|staff|personnel|crew\s+members|partners)"
NUM = r"(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*(?:thousand|million)|\d{4,7})"
# "approximately 83,000 employees", "166,000 full-time equivalent employees"
P1 = re.compile(NUM + r"\s+(?:[\w-]+\s+){0,3}?" + WORKER_WORDS, re.I)
# "employees ... was approximately 83,000", "workforce of approximately 83,000"
P2 = re.compile(r"(?:employ(?:ed|s)?|workforce|headcount|employees)\b[^.]{0,80}?"
                r"(?:approximately|about|over|more than|around|roughly|nearly|some)?\s*" + NUM, re.I)
HEADING = re.compile(r"human\s+capital|item\s*6\.?\s*d\b|\n\s*employees\s*\n|our\s+(?:people|workforce|employees)\s*\n", re.I)
AS_OF = re.compile(r"\b(?:as of|at|as at)\s+(?:the end of|(?:january|february|march|april|may|june|july|"
                   r"august|september|october|november|december)\s+\d{1,2},?\s+20\d\d|\d{1,2}\s+\w+\s+20\d\d|"
                   r"(?:fiscal\s+)?(?:year[- ]end|20\d\d))", re.I)
NOT_OURS = re.compile(r"dealers?|suppliers?|customers?|retirees?|pension|participants|franchisees?|"
                      r"represented by|covered by|collective bargaining|unions?|plan\b|members of|trained|"
                      r"training|students|patients|volunteers|contractors|joint venture|temporary|average number|"
                      r"loans?|seasonal|hired|new hires|fine of|penalt", re.I)


# Equity and money contexts: "granted 323,184 RSUs to employees", "employees purchased 230,716 shares"
EQUITY = re.compile(r"\b(?:shares?|rsus?|psus?|options?|awards?|units|warrants|stock|grants?|"
                    r"granted|purchased|issued|sold|vested|exercis\w*|plan)\b|\$", re.I)


def to_int(s):
    s = s.lower().replace(",", "").strip()
    mult = 1_000 if "thousand" in s else 1_000_000 if "million" in s else 1
    try:
        return int(float(re.sub(r"[^\d.]", "", s)) * mult)
    except ValueError:
        return None


def text_of(raw):
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw)
    t = re.sub(r"(?i)</?(?:p|div|tr|br|h\d|li|td)\b[^>]*>", "\n", t)
    t = re.sub(r"(?s)<[^>]+>", " ", t)
    t = html.unescape(t).replace("\xa0", " ")
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t)


def extract_headcount(text):
    """Return (count, snippet) for the most plausible own-headcount sentence."""
    heads = [m.end() for m in HEADING.finditer(text)]
    best = None
    for pat in (P1, P2):
        for m in pat.finditer(text):
            n = to_int(m.group(1))
            # "65,900 and 69,700 employees" (this year and last year): take the first number
            prev = re.search(NUM + r"\s+and\s+$", text[max(0, m.start() - 40):m.start()], re.I)
            if pat is P1 and prev:
                n = to_int(prev.group(1))
            if not n or n < 50 or n > 3_000_000:
                continue
            pre = text[max(0, m.start() - 3):m.start()]
            if "$" in pre or (1990 <= n <= 2035 and "," not in m.group(1)):
                continue
            # the matched phrase itself, or the words right after the number, about equity or money
            if EQUITY.search(m.group(0)) or EQUITY.search(text[m.end(1):m.end(1) + 25]):
                continue
            before = text[max(0, m.start() - 160):m.start()]
            near = text[max(0, m.start() - 100):m.end() + 40]
            score = 0
            if any(0 <= m.start() - h < 2500 for h in heads):
                score += 3
            if AS_OF.search(before):
                score += 2
            if re.search(r"\b(?:employ(?:ed|s)?|had|have|has)\b[^.]{0,30}$", before, re.I):
                score += 2
            if re.search(r"employ", near, re.I):
                score += 1
            # "temporary employees" counts against; "(excluding temporary ...)" afterwards does not
            if NOT_OURS.search(text[max(0, m.start() - 100):m.end()]):
                score -= 4
            if len(re.findall(r"\d[\d,.]*", text[max(0, m.start() - 100):m.end() + 100])) > 6:  # table rows, not a sentence
                score -= 4
            cand = (score, -m.start(), n, " ".join(text[max(0, m.start() - 140):m.end() + 60].split()))
            if best is None or cand[:2] > best[:2]:
                best = cand
    if best is None or best[0] < 2:  # need a heading, an "as of" date or "we employ/had"
        return None, None
    return best[2], best[3]


def website_of(text, name):
    """Most-mentioned www. domain that resembles the company name; '' if none does."""
    from collections import Counter
    from common import norm_domain, norm_name
    words = [w for w in norm_name(name).split() if len(w) >= 3]
    if not words:
        return ""
    hits = Counter(norm_domain(m.group(0)) for m in re.finditer(r"\bwww\.[a-z0-9.-]+\.[a-z]{2,}", text, re.I))
    for dom, _ in hits.most_common():
        label = dom.split(".")[0]
        if any(w[:5] in label or label in w for w in words):
            return dom
    return ""


def process(cik, meta):
    path = SEC_CACHE / f"{cik}.json"
    subs = sec_get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json").json()
    recent = subs["filings"]["recent"]
    idx = next((i for i, f in enumerate(recent["form"]) if f in ANNUAL_FORMS), None)
    rec = {"cik": cik, "name": subs.get("name"), "tickers": meta["tickers"],
           "exchanges": meta["exchanges"], "sic": subs.get("sicDescription"),
           "state": (subs.get("addresses") or {}).get("business", {}).get("stateOrCountryDescription"),
           "city": (subs.get("addresses") or {}).get("business", {}).get("city"),
           "website": subs.get("website") or "", "form": None, "accession": None,
           "period": None, "employees": None, "snippet": None}
    if idx is None:
        path.write_text(json.dumps(rec))
        return rec
    acc = recent["accessionNumber"][idx]
    if path.exists():
        old = json.loads(path.read_text())
        if old.get("accession") == acc and old.get("parser") == PARSER_VERSION:
            return old
    rec.update(form=recent["form"][idx], accession=acc, parser=PARSER_VERSION,
               period=recent["reportDate"][idx] or recent["filingDate"][idx])
    tpath = TEXT_CACHE / f"{cik}_{acc}.txt.gz"
    if tpath.exists():
        text = gzip.decompress(tpath.read_bytes()).decode()
    else:
        doc = recent["primaryDocument"][idx]
        url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{doc}"
        text = text_of(sec_get(url, timeout=180).text)
        tpath.write_bytes(gzip.compress(text.encode()))
    rec["employees"], rec["snippet"] = extract_headcount(text)
    if not rec["website"]:
        rec["website"] = website_of(text, rec["name"])
    path.write_text(json.dumps(rec))
    return rec


def main():
    sys.stdout.reconfigure(line_buffering=True)
    listing = sec_get("https://www.sec.gov/files/company_tickers_exchange.json").json()
    filers = {}
    for cik, name, ticker, exch in listing["data"]:
        if not exch or exch.upper() == "OTC":
            continue  # exchange-listed only
        f = filers.setdefault(cik, {"tickers": [], "exchanges": set()})
        f["tickers"].append(ticker)
        f["exchanges"].add(exch)
    for f in filers.values():
        f["exchanges"] = sorted(f["exchanges"])
    wanted = {t.upper() for t in sys.argv[1:]}
    if wanted:
        filers = {c: f for c, f in filers.items() if wanted & {t.upper() for t in f["tickers"]}}
    print(f"SEC: {len(filers)} exchange-listed filers to check")

    results, errors = [], []
    with ThreadPoolExecutor(max_workers=16) as pool:
        futs = {pool.submit(process, cik, meta): cik for cik, meta in filers.items()}
        for i, fut in enumerate(futs, 1):
            try:
                results.append(fut.result())
            except Exception as e:  # keep going; report at the end
                errors.append((futs[fut], repr(e)[:120]))
            if i % 250 == 0:
                print(f"  {i}/{len(filers)}")
    if not wanted:
        (CACHE / "sec.json").write_text(json.dumps(results, indent=1))
    found = [r for r in results if r["employees"]]
    print(f"Headcount found for {len(found)}/{len(results)} filers; {len(errors)} errors")
    if wanted:
        for r in results:
            print(f"  {r['tickers'][0]:6} {r['form']} {r['period']} {r['employees']!s:>9}  {r['website']}  | {(r['snippet'] or '')[:150]}")


if __name__ == "__main__":
    main()
