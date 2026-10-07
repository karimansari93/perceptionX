"""Shared helpers for the prospect-list pipeline."""
import re
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"
INPUTS = ROOT / "inputs"
OUTPUT = ROOT / "output"
for d in (CACHE, INPUTS, OUTPUT):
    d.mkdir(exist_ok=True)

CONTACT_EMAIL = "karim@perceptionx.ai"
USER_AGENT = f"PerceptionX prospect-list {CONTACT_EMAIL}"
MIN_EMPLOYEES = 5_000    # floor for inclusion
MAIN_THRESHOLD = 10_000  # main tab; 5,000-9,999 go on their own tab

# Two-part public suffixes, so "bbc.co.uk" stays "bbc.co.uk" and not "co.uk".
_TWO_PART_SUFFIXES = {
    "co.uk", "org.uk", "ac.uk", "gov.uk", "plc.uk", "ltd.uk", "co.jp", "or.jp", "ne.jp", "ac.jp",
    "com.au", "net.au", "org.au", "co.nz", "co.za", "com.br", "com.cn", "com.hk", "com.sg",
    "com.mx", "com.ar", "com.tr", "com.tw", "com.my", "com.ph", "com.pk", "com.sa", "com.eg",
    "co.in", "co.kr", "co.id", "co.th", "co.il", "com.co", "com.pe", "com.vn", "com.ng",
    "ac.in", "gov.in", "edu.au", "gov.au", "edu.cn", "gov.cn", "co.ke", "com.qa", "com.kw",
    "co.ae", "gov.ae", "ac.ae", "com.ua", "com.pl", "com.ec", "com.bd", "com.lb",
}


def norm_domain(url):
    """'https://www.Pfizer.com/about' -> 'pfizer.com'. Returns '' if nothing usable."""
    if not url:
        return ""
    s = str(url).strip().lower()
    s = re.sub(r"^[a-z]+://", "", s)
    s = s.split("/")[0].split("?")[0].split("#")[0].split(":")[0].strip(".")
    if not s or "." not in s:
        return ""
    labels = s.split(".")
    keep = 3 if ".".join(labels[-2:]) in _TWO_PART_SUFFIXES else 2
    return ".".join(labels[-keep:])


_LEGAL_SUFFIX = re.compile(
    r"\b(incorporated|inc|corp|corporation|company|co|ltd|limited|plc|llc|lp|sa|ag|se|nv|bv|"
    r"spa|s\.p\.a|ab|asa|oyj|gmbh|kgaa|holdings?|group|the|de|cv|sab|tbk|bhd|pjsc|jsc|oao|pao)\b"
)


def norm_name(name):
    """Loose name key for matching when there is no domain."""
    s = re.sub(r"\s*/[a-z]{2,3}/?\s*$", "", str(name or "").lower())  # SEC state tag: "MARRIOTT ... /MD"
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = _LEGAL_SUFFIX.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def get(url, *, params=None, headers=None, stream=False, tries=5, timeout=120):
    """GET with polite retries."""
    h = {"User-Agent": USER_AGENT}
    h.update(headers or {})
    for i in range(tries):
        try:
            r = requests.get(url, params=params, headers=h, stream=stream, timeout=timeout)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"{r.status_code}")
            return r
        except (requests.RequestException,) as e:
            if i == tries - 1:
                raise
            time.sleep(2 ** (i + 1))
