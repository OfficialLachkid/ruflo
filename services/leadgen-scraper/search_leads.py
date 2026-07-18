#!/usr/bin/env python3
"""Search for candidate businesses and extract a lead record from each result.

Builds on extract_lead.py: a DuckDuckGo search (no API key, no per-token
cost) finds candidate URLs for a query, then each page is run through the
same local Ollama extraction pipeline. Runs entirely locally.

Usage:
    python search_leads.py "electricians in Rotterdam"
    python search_leads.py "hair salons in Utrecht" --max 8
"""

import argparse
import json
import sys
from urllib.parse import urlparse

from scrapegraphai.utils.research_web import search_on_web

from extract_lead import extract, unload_model

# Domains observed (not guessed) to return real-but-irrelevant businesses —
# data brokers, directories, and search-result pages that rank for niche
# search terms without being an actual business in that niche. The
# extraction prompt asks the model to self-filter these too, but that's
# unreliable on an 8B model for this kind of judgment call (tested: it
# missed companydata.com twice in a row) — this list is the deterministic
# backstop. Expected to grow as new offenders turn up; not exhaustive.
BLOCKED_DOMAINS = {
    "companydata.com",
    "bolddata.nl",  # same company as companydata.com, different domain
    "bedrijfsinformatieonline.nl",
    "yelp.com",
    "wikipedia.org",
    "tripadvisor.com",
    "opencorporates.com",
    "elektriciensgids.nl",
    "elektricien.nl",  # bare generic niche-word domain — a Dutch directory pattern
    "trustoo.nl",  # review/matching marketplace, same class as yelp.com
    "consumentenbond.nl",  # Dutch consumer-advocacy nonprofit, not a business
    "spoedklus.nl",  # multi-trade emergency broker (plumber/electrician/locksmith/roofer)
    "startpagina.nl",  # self-describes as "Online directory"
    "klantervaringen.nl",  # self-describes as "Online review platform"
    "loodgieters-bedrijven.nl",  # confirmed lead-referral marketplace
    "yoys.nl",  # self-describes as "B2B Marketplace" in its own title
    "delokaleloodgieter.nl",  # multi-province referral platform
    "moving.nl",  # multi-category comparison marketplace (moving, plumbing, etc.)
}

# Marketing language Dutch/English directory and comparison sites consistently
# use to describe themselves — checked against the model's own business_type
# and services fields after extraction. Catches directory sites the domain
# list hasn't seen yet, wherever the model's extraction actually surfaced the
# directory language (it doesn't always — see BLOCKED_DOMAINS' elektricien.nl
# entry for a case where the model missed it entirely and needed the domain
# list instead).
DIRECTORY_LANGUAGE_MARKERS = (
    "gids", "vergelijk", "bedrijvengids", "geverifieerde bedrijven",
    "offertes van meerdere", "meerdere elektriciens", "vind een geschikte",
    "compare quotes", "verified businesses", "find multiple",
)


def is_blocked_domain(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == domain or host.endswith(f".{domain}") for domain in BLOCKED_DOMAINS)


def looks_like_directory(record: dict) -> bool:
    haystack = str(record.get("business_type", "")).lower()
    haystack += " " + " ".join(str(item) for item in (record.get("services") or [])).lower()
    return any(marker in haystack for marker in DIRECTORY_LANGUAGE_MARKERS)


def search_leads(query: str, max_results: int) -> list[dict]:
    urls = search_on_web(query, search_engine="duckduckgo", max_results=max_results)

    records = []
    seen_domains = set()  # same business, different pages (e.g. site.nl/ and site.nl/region)
    for url in urls:
        host = (urlparse(url).hostname or "").lower().removeprefix("www.")

        if is_blocked_domain(url):
            records.append({"source_url": url, "error": "skipped: known directory/aggregator domain"})
            continue

        if host in seen_domains:
            records.append({"source_url": url, "error": "skipped: already found a lead from this domain in this run"})
            continue

        try:
            record = extract(url, niche=query)
            record["source_url"] = url
            if looks_like_directory(record):
                record = {"source_url": url, "error": "skipped: extraction matched directory/comparison-site language"}
            else:
                seen_domains.add(host)
        except Exception as exc:  # one bad site shouldn't kill the batch
            record = {"source_url": url, "error": str(exc)}
        records.append(record)
    return records


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help='Search query, e.g. "electricians in Rotterdam"')
    parser.add_argument(
        "--max", type=int, default=10, help="Max candidate URLs to extract (default: 10)"
    )
    args = parser.parse_args()

    if args.max > 50:
        print("Refusing --max > 50 in one run — stay bounded, see README.", file=sys.stderr)
        sys.exit(1)

    results = search_leads(args.query, args.max)
    print(json.dumps(results, indent=2))
    unload_model()  # release RAM once the whole batch is done, not between URLs
