"""Step 5: ask Google (via ScrapingDog) who runs talent attraction / employer brand at each company.

One question per company, all four roles in the same question. Answers are AI-stated and
must be verified (LinkedIn) before outreach: the output marks every name "AI-stated, verify".

Needs the SCRAPINGDOG_API_KEY environment variable (never printed or saved).

Usage:
  python3 5_ai_people.py --limit 25            # pilot on the first 25 companies
  python3 5_ai_people.py                       # all companies in targets/us_hq_10k.csv
  python3 5_ai_people.py --surface ai_overview # Google AI Overviews instead of AI Mode (2 requests each)
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
QUESTION = ("Who is the {roles} at {company}? For each role give the person's full name and exact "
            "current job title, or say if it is not publicly known.")
PEOPLE_CACHE = CACHE / "ai_people"
PEOPLE_CACHE.mkdir(exist_ok=True)
API = "https://api.scrapingdog.com/google"
ROLE_WORDS = re.compile(r"talent|employer brand|recruit|attraction|people|hr\b|human resources|careers?|"
                        r"acquisition|brand|communications?", re.I)
# "Jane Doe", "Jane M. Doe", "Jane Doe-Smith", "Jean-Luc O'Neil" (2-4 capitalised words)
NAME = r"([A-Z][a-zA-Z'’\-]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-zA-Z'’\-]+){1,2})"
NOT_A_NAME = re.compile(r"^(Head|Vice|Senior|Global|Chief|Director|Talent|Employer|Recruitment|Human|The|"
                        r"Not|No|Some|While|However|As|According|Based|Recent|Current|LinkedIn|Google|"
                        r"Glassdoor|Indeed)\b")


def question_for(company):
    roles = ", ".join(ROLES[:-1]) + " and " + ROLES[-1]
    return QUESTION.format(roles=roles, company=company)


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


def extract_people(answer):
    """Pull (name, title) pairs from sentences that also mention a talent/brand role."""
    people = []
    # split into sentences, but not after a middle initial ("Jane M. Doe")
    for line in re.split(r"(?<=[a-z0-9)][.;])\s+|\n", answer):
        if not ROLE_WORDS.search(line) or re.search(r"not (publicly )?(known|available|disclosed|listed)", line, re.I):
            continue
        for m in re.finditer(NAME, line):
            name = m.group(1).strip()
            if NOT_A_NAME.match(name) or len(name.split()) < 2:
                continue
            title = re.sub(r"\s+", " ", line).strip()[:200]
            if name not in [p[0] for p in people]:
                people.append((name, title))
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
    ap.add_argument("--surface", choices=["ai_mode", "ai_overview"], default="ai_mode")
    ap.add_argument("--targets", default=str(ROOT / "targets" / "us_hq_10k.csv"))
    ap.add_argument("--dry-run", action="store_true")
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
    key = os.environ.get("SCRAPINGDOG_API_KEY")
    if not key:
        sys.exit("SCRAPINGDOG_API_KEY is not set in this environment.")

    andy = andy_names()
    results = []
    for i, c in enumerate(companies, 1):
        results.append(ask(c, key, args.surface))
        if i % 25 == 0:
            print(f"  {i}/{len(companies)}")
        time.sleep(0.5)

    wb = Workbook()
    ws = wb.active
    ws.title = "People (AI-stated, verify)"
    ws.append(["Company", "Name (AI-stated)", "Sentence it came from", "Andy LinkedIn connection",
               "Verified (fill in)", "Sources Google cited"])
    found = 0
    for r in results:
        people = extract_people(r["answer"])
        found += bool(people)
        for name, line in people:
            ws.append([r["company"], name, line, andy.get(name.lower(), "") and f"Yes: {andy[name.lower()]}",
                       "", "\n".join(r["sources"][:5])])
    ws2 = wb.create_sheet("Full answers")
    ws2.append(["Company", "Status", "Full AI answer", "Sources Google cited", "Question asked"])
    for r in results:
        ws2.append([r["company"], r["status"], r["answer"], "\n".join(r["sources"]), r["question"]])
    for sheet, widths in ((ws, (30, 26, 90, 30, 14, 60)), (ws2, (30, 16, 120, 60, 60))):
        for c in sheet[1]:
            c.font, c.fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="1F2A44")
        for col, w in zip("ABCDEF", widths):
            sheet.column_dimensions[col].width = w
        sheet.freeze_panes = "B2"
        sheet.auto_filter.ref = sheet.dimensions
    out = OUTPUT / "ai-people.xlsx"
    wb.save(out)
    answered = sum(r["status"] == "answered" for r in results)
    print(f"Saved {out}: {answered}/{len(results)} answered, names found for {found}")


if __name__ == "__main__":
    main()
