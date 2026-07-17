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
    "bedrijfsinformatieonline.nl",
    "yelp.com",
    "wikipedia.org",
    "tripadvisor.com",
    "opencorporates.com",
}


def is_blocked_domain(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == domain or host.endswith(f".{domain}") for domain in BLOCKED_DOMAINS)


def search_leads(query: str, max_results: int) -> list[dict]:
    urls = search_on_web(query, search_engine="duckduckgo", max_results=max_results)

    records = []
    for url in urls:
        if is_blocked_domain(url):
            records.append({"source_url": url, "error": "skipped: known directory/aggregator domain"})
            continue

        try:
            record = extract(url, niche=query)
            record["source_url"] = url
        except Exception as exc:  # one bad site shouldn't kill the batch
            record = {"source_url": url, "error": str(exc)}
        records.append(record)
    return records


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help='Search query, e.g. "electricians in Rotterdam"')
    parser.add_argument(
        "--max", type=int, default=5, help="Max candidate URLs to extract (default: 5)"
    )
    args = parser.parse_args()

    if args.max > 20:
        print("Refusing --max > 20 in one run — stay bounded, see README.", file=sys.stderr)
        sys.exit(1)

    results = search_leads(args.query, args.max)
    print(json.dumps(results, indent=2))
    unload_model()  # release RAM once the whole batch is done, not between URLs
