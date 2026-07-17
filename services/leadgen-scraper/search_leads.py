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

from scrapegraphai.utils.research_web import search_on_web

from extract_lead import extract


def search_leads(query: str, max_results: int) -> list[dict]:
    urls = search_on_web(query, search_engine="duckduckgo", max_results=max_results)

    records = []
    for url in urls:
        try:
            record = extract(url)
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
