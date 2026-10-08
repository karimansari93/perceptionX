"""Step 5: ask Google AI Overviews (via ScrapingDog) who runs talent attraction / employer brand at each company.

One question per company, all four roles in the same question. Answers are AI-stated and
must be verified (LinkedIn) before outreach: the output marks every name "AI-stated, verify".

By default each question goes through our own Supabase edge function
`test-prompt-google-ai-overviews`, which calls ScrapingDog with the key stored in Supabase
(read-only: it returns the answer and saves nothing). It needs the project's public anon key in
SUPABASE_ANON_KEY or cache/.supabase_anon (never committed). With --direct it calls ScrapingDog
itself and needs SCRAPINGDOG_API_KEY.

Usage:
  python3 5_ai_people.py --limit 25            # pilot on the first 25 companies
  python3 5_ai_people.py                       # all companies in targets/us_hq_10k.csv
  python3 5_ai_people.py --surface ai_mode     # Google AI Mode instead (1 request each)
  python3 5_ai_people.py --dry-run             # show the questions, call nothing
Answers are cached in cache/ai_people/, so re-runs only ask what is new.
Writes output/ai-people.xlsx.
"""
import argparse
import csv
import json
import os
import re
import sys
import time

import requests
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from common import CACHE, INPUTS, OUTPUT, ROOT, norm_name

ROLES = ["Head of Talent Attraction", "Head of Recruitment Marketing", "Head of Talent Brand",
         "Head of Employer Brand"]
# Kept short on purpose: Google's search step rejected a longer four-part question (tested on Walmart).
QUESTION = "Who leads talent attraction, recruitment marketing, talent brand and employer brand at {company}?"
PEOPLE_CACHE = CACHE / "ai_people"
PEOPLE_CACHE.mkdir(exist_ok=True)
API = "https://api.scrapingdog.com/google"
EDGE = "https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-google-ai-overviews"
ROLE_WORDS = re.compile(r"talent|employer brand|recruit|attraction|people|hr\b|human resources|careers?|"
                        r"acquisition|brand|communications?", re.I)
# A name is 2-4 capitalised words (any alphabet, so "Morgan-Schönwetter" survives), allowing an initial.
_W = r"[^\W\d_][^\W\d_'’\-]*(?:-[^\W\d_][^\W\d_'’]*)?"
NAME = re.compile(rf"(?<![\w-])({_W}(?:\s+[^\W\d_]\.)?(?:\s+{_W}){{1,2}}|{_W}\s+[^\W\d_]\.)")
# Words that mean the match is a company, place, job or source rather than a person.
NOT_PERSON = set("""
group corporation corp inc co company companies limited ltd plc llc holdings international global united
states america american india china europe uk us north south east west new york city digital industrial
internet technology technologies services solutions systems brands brand talent employer recruitment
recruiting recruiter acquisition attraction marketing manager management business partner board member
officer chief vice president director head senior lead leader principal executive human resources people
hr culture communications careers career team teams department role roles details leadership regional
transition global specific linkedin magazine forum world economic conference expo glassdoor indeed google
because while however according based recent current previously formerly also such including more contact
if the a an at in for of and with value proposition campaign hello possible enterprise operations retail
corporate network health healthcare bank financial store stores foods food energy motors motor airlines
would she he they we you ceo review please know within other operating units each major subsidiary
insurance hills area metropolitan usa fruit
""".split())
TITLE_AFTER = re.compile(r"\b(?:as|is|was|serves as|served as|is the|was the|as the)\s+(?:the\s+|an?\s+)?"
                         r"((?:[A-Z][\w&/,'’\-]*\s?){1,12}?)(?=\s+(?:at|for|of|in|within|across|on)\b|[.,;(]|$)")
TITLE_PAREN = re.compile(r"^\s*\(([^)]{4,120})\)")
PAST = re.compile(r"\b(previously|formerly|former|led|headed|was|transitioned|moved|left|until|ex-)\b", re.I)


def question_for(company):
    return QUESTION.format(company=company)


def text_of(blocks):
    out = []
    for b in blocks or []:
        if isinstance(b, dict):
            if b.get("snippet") or b.get("text"):
                out.append(b.get("snippet") or b.get("text"))
            for key in ("list", "text_blocks", "items"):
                if isinstance(b.get(key), list):
                    out.append(text_of(b[key]))
        elif isinstance(b, str):
            out.append(b)
    return "\n".join(x for x in out if x)


def sources_of(data):
    seen, out = set(), []
    for key in ("references", "sources", "links"):
        for s in (data.get(key) or []):
            link = s.get("link") or s.get("url") if isinstance(s, dict) else None
            if link and link not in seen:
                seen.add(link)
                out.append(f"{s.get('title') or s.get('source') or ''} {link}".strip())
    return out


def ask_edge(company, anon):
    """Ask through our AI Overviews edge function; cached on disk like ask()."""
    path = PEOPLE_CACHE / f"edge_{re.sub(r'[^a-z0-9]+', '_', company.lower())[:80]}.json"
    if path.exists():
        return json.loads(path.read_text())
    q = question_for(company)
    for attempt in range(3):
        try:
            r = requests.post(EDGE, json={"prompt": q, "location_context": "United States"}, timeout=180,
                              headers={"Authorization": f"Bearer {anon}", "apikey": anon})
            if r.status_code in (401, 403):
                sys.exit(f"The edge function refused the request ({r.status_code}). Check SUPABASE_ANON_KEY.")
            if r.status_code >= 500 or r.status_code == 429:
                time.sleep(10 * (attempt + 1))
                continue
            data = r.json()
            answer = data.get("response") or ""
            failed = (not answer or answer == "No response generated"
                      or re.match(r"(Google (AI|search)|AI Overview|Failed to fetch|No AI Overview|No response)",
                                  answer))
            rec = {"company": company, "question": q, "surface": "ai_overview (edge function)",
                   "answer": "" if failed else answer,
                   "sources": [f"{c.get('title') or ''} {c.get('url') or ''}".strip()
                               for c in (data.get("citations") or []) if isinstance(c, dict)],
                   "status": "answered" if not failed else
                             ("no AI answer" if "No response generated" in answer
                              else f"failed ({answer[:80] or 'empty'})")}
            if not failed or "No response generated" in answer:
                path.write_text(json.dumps(rec, indent=1))  # errors are not cached, so they retry next run
            return rec
        except (requests.RequestException, ValueError):
            time.sleep(5 * (attempt + 1))
    return {"company": company, "question": q, "surface": "ai_overview (edge function)", "answer": "",
            "sources": [], "status": "failed (will retry next run)"}


def ask(company, key, surface):
    """One company -> {'answer', 'sources', 'status'}; cached on disk."""
    path = PEOPLE_CACHE / f"{surface}_{re.sub(r'[^a-z0-9]+', '_', company.lower())[:80]}.json"
    if path.exists():
        return json.loads(path.read_text())
    q = question_for(company)
    for attempt in range(4):
        try:
            if surface == "ai_mode":
                r = requests.get(f"{API}/ai_mode", params={"api_key": key, "query": q, "country": "us"},
                                 timeout=120)
                data = r.json() if r.content else {}
                blocks = data.get("text_blocks")
            else:
                r = requests.get(API, params={"api_key": key, "query": q, "advance_search": "true",
                                              "country": "us"}, timeout=120)
                data = r.json() if r.content else {}
                ao = data.get("ai_overview") or {}
                if ao.get("scrapingdog_link") and not ao.get("text_blocks"):
                    r = requests.get(f"{API}/ai_overview", params={"api_key": key, "url": ao["scrapingdog_link"]},
                                     timeout=120)
                    data = r.json() if r.content else {}
                    ao = data.get("ai_overview") or data
                blocks, data = ao.get("text_blocks"), ao
            if r.status_code in (401, 403):
                sys.exit("ScrapingDog refused the key (401/403). Check SCRAPINGDOG_API_KEY and the plan's credits.")
            if r.status_code == 429 or (r.status_code >= 500):
                time.sleep(10 * (attempt + 1))
                continue
            rec = {"company": company, "question": q, "surface": surface,
                   "answer": text_of(blocks), "sources": sources_of(data),
                   "status": "answered" if blocks else "no AI answer"}
            path.write_text(json.dumps(rec, indent=1))
            return rec
        except (requests.RequestException, ValueError):
            time.sleep(5 * (attempt + 1))
    return {"company": company, "question": q, "surface": surface, "answer": "", "sources": [],
            "status": "failed (will retry next run)"}


VERB_AFTER = re.compile(r"\s*(?:,|\(|–|—|-\s|:|\b(?:serves|served|leads|led|is|was|heads|headed|manages|managed|"
                        r"oversees|oversaw|operates|runs|ran|directs|directed|built|spearheaded|holds|held|"
                        r"currently|previously|has|had|works|worked|drives|drove)\b)")
CUE_BEFORE = re.compile(r"(?:such as|like|including|by|named|is|was|are|:|-|•)\s*$", re.I)
TITLE_START = re.compile(r"\b(?:as|is|was)\s+(?:the\s+|an?\s+|its\s+)?(?=[A-Z])")
TITLE_GLUE = {"of", "and", "&", "for", "-", "–", "/"}


def title_from(text):
    """'... serves as the Head of Talent Acquisition at X' -> 'Head of Talent Acquisition'."""
    m = TITLE_PAREN.match(text)
    if m:
        return m.group(1).strip()
    m = TITLE_START.search(text[:120])
    if not m:
        return ""
    words = []
    for tok in re.findall(r"[\w&/'’\-–]+|,", text[m.end():m.end() + 160]):
        if tok[0].isupper() or tok in TITLE_GLUE or (tok == "," and words):
            words.append(tok)
        else:
            break
    while words and (words[-1] in TITLE_GLUE or words[-1] == ","):
        words.pop()
    return " ".join(words).replace(" ,", ",")


def extract_people(answer, company=""):
    """(name, title, 'current'/'possibly former', sentence) for each person the answer names."""
    company_words = {w for w in re.findall(r"[^\W\d_]+", company.lower())}
    # drop Google's source tags glued to sentences: "...Manager.LinkedIn·Mollie Bush +1"
    answer = re.sub(r"(?:LinkedIn|Glassdoor|Indeed|Medium|YouTube|Instagram|Facebook|Forbes|[A-Z][\w&.'’ ]{1,40}?)"
                    r"·[^\n.]*|\s*\+\d+\b", ". ", answer)
    people, seen = [], set()
    # split into sentences, but not after a middle initial ("Jane M. Doe")
    for line in re.split(r"(?<=[a-z0-9)][.;])\s+|\n|(?<=[a-z])(?=LinkedIn·)", answer):
        if re.search(r"not (publicly )?(known|available|disclosed|listed)", line, re.I):
            continue
        for m in NAME.finditer(line):
            tokens = m.group(1).split()
            lead = 0
            while tokens and not tokens[0][0].isupper():  # "while Mollie Bush" -> "Mollie Bush"
                lead += 1
                tokens.pop(0)
            while tokens and not tokens[-1][0].isupper():  # "Bjorn Luijters leads" -> "Bjorn Luijters"
                tokens.pop()
            if len(tokens) < 2 or not all(t[0].isupper() for t in tokens):
                continue
            name = " ".join(tokens)
            words = [w.strip(".").lower() for w in tokens]
            if any(w in NOT_PERSON or w in company_words for w in words) or name.isupper() or name.lower() in seen:
                continue
            start = m.start() + m.group(1).find(tokens[0])
            end = start + m.group(1)[m.group(1).find(tokens[0]):].find(tokens[-1]) + len(tokens[-1])
            before, after = line[:start], line[end:]
            if not (VERB_AFTER.match(after) or CUE_BEFORE.search(before)):
                continue  # not in a person position: likely a place, product or business
            title = title_from(after)
            if not title and not ROLE_WORDS.search(line):
                continue
            seen.add(name.lower())
            when = "possibly former" if PAST.search(line[max(0, start - 40):end + 80]) else "current"
            people.append((name, title, when, re.sub(r"\s+", " ", line).strip()[:300]))
    return people


def andy_names():
    path = INPUTS / "andy_linkedin.csv"
    if not path.exists():
        return {}
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith("First Name"))
    return {f"{r['First Name']} {r['Last Name']}".strip().lower(): r.get("Position") or ""
            for r in csv.DictReader(lines[start:])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--surface", choices=["ai_overview", "ai_mode"], default="ai_overview")
    ap.add_argument("--targets", default=str(ROOT / "targets" / "us_hq_10k.csv"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--direct", action="store_true", help="call ScrapingDog directly (needs SCRAPINGDOG_API_KEY)")
    args = ap.parse_args()

    with open(args.targets, newline="") as f:
        companies = [r["company"] for r in csv.DictReader(f)]
    if args.limit:
        companies = companies[:args.limit]
    per = 1 if args.surface == "ai_mode" else 2
    print(f"{len(companies)} companies, {args.surface}: about {len(companies) * per} ScrapingDog requests "
          f"(fewer if some are cached)")
    if args.dry_run:
        for c in companies[:3]:
            print("  e.g.", question_for(c))
        return
    if args.direct:
        key = os.environ.get("SCRAPINGDOG_API_KEY")
        if not key:
            sys.exit("SCRAPINGDOG_API_KEY is not set in this environment.")
        fetch = lambda c: ask(c, key, args.surface)
    else:
        anon_file = CACHE / ".supabase_anon"
        anon = os.environ.get("SUPABASE_ANON_KEY") or (anon_file.read_text().strip() if anon_file.exists() else "")
        if not anon:
            sys.exit("Set SUPABASE_ANON_KEY (the project's public anon key) or save it to cache/.supabase_anon")
        fetch = lambda c: ask_edge(c, anon)

    andy = andy_names()
    from concurrent.futures import ThreadPoolExecutor
    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:  # gentle: shares ScrapingDog with live collection
        for i, rec in enumerate(pool.map(fetch, companies), 1):
            results.append(rec)
            if i % 25 == 0:
                print(f"  {i}/{len(companies)}: {sum(r['status'] == 'answered' for r in results)} answered", flush=True)
    # second pass: retry failures one at a time (failures are usually ScrapingDog rate limits)
    retry = [i for i, r in enumerate(results) if r["status"].startswith("failed")]
    if retry:
        print(f"  retrying {len(retry)} failed questions one at a time", flush=True)
        for i in retry:
            results[i] = fetch(companies[i])

    wb = Workbook()
    ws = wb.active
    ws.title = "People (AI-stated, verify)"
    ws.append(["Company", "Name (AI-stated)", "Title (AI-stated)", "Current or possibly former",
               "Andy LinkedIn connection", "Verified (fill in)", "Sentence it came from", "Sources Google cited"])
    found = 0
    for r in results:
        people = extract_people(r["answer"], r["company"])
        found += bool(people)
        for name, title, when, line in people:
            ws.append([r["company"], name, title, when,
                       andy.get(name.lower(), "") and f"Yes: {andy[name.lower()]}", "", line,
                       "\n".join(r["sources"][:5])])
    ws2 = wb.create_sheet("Full answers")
    ws2.append(["Company", "Status", "Full AI answer", "Sources Google cited", "Question asked"])
    for r in results:
        ws2.append([r["company"], r["status"], r["answer"], "\n".join(r["sources"]), r["question"]])
    for sheet, widths in ((ws, (30, 26, 40, 16, 30, 14, 90, 60)), (ws2, (30, 16, 120, 60, 60))):
        for c in sheet[1]:
            c.font, c.fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="1F2A44")
        for col, w in zip("ABCDEFGH", widths):
            sheet.column_dimensions[col].width = w
        sheet.freeze_panes = "B2"
        sheet.auto_filter.ref = sheet.dimensions
    out = OUTPUT / "ai-people.xlsx"
    wb.save(out)
    answered = sum(r["status"] == "answered" for r in results)
    print(f"Saved {out}: {answered}/{len(results)} answered, names found for {found}")


if __name__ == "__main__":
    main()
