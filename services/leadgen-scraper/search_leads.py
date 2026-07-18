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
    "linkedin.com",  # job postings and profiles, not a business's own site
    "technieknederland.nl",  # trade association ("Vakorganisatie"), not a business
    "klusup.nl",  # gig-work matching platform ("you'll be matched with a plumber")
    "loodgietershub.nl",  # self-describes as bringing customers and plumbers together
    "bouwproducten.nl",  # construction-industry news/product platform, not a plumber
    # Social platforms and ad/search redirect domains — never a business's own
    # site by definition, safe to block broadly rather than case-by-case.
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "tiktok.com",
    "bing.com",  # search-ad click-tracking redirect URLs turned up, not real pages
    "alexwaterandbouw.eu",  # SEO content site (pricing guides) with a business-sounding name
    "homedeal.nl",  # quote-comparison marketplace ("vergelijk offertes van vakspecialisten")
    "werkspot.nl",  # largest Dutch home-services marketplace, same class as homedeal
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


def is_mostly_empty(record: dict) -> bool:
    """business_name isn't literally "NA" (the only thing the existing NA
    filter checks) but everything else came back NA/empty — e.g. the model
    fell back to using the domain itself as the name. Not a usable lead
    either way.
    """
    return str(record.get("business_type", "")).strip().upper() == "NA"


def search_leads(query: str, max_results: int, skip_domains: set[str] | None = None) -> list[dict]:
    urls = search_on_web(query, search_engine="duckduckgo", max_results=max_results)

    records = []
    seen_domains = set()  # same business, different pages (e.g. site.nl/ and site.nl/region)
    known_domains = skip_domains or set()  # already saved in the leads table from past runs
    for url in urls:
        host = (urlparse(url).hostname or "").lower().removeprefix("www.")

        if is_blocked_domain(url):
            records.append({"source_url": url, "error": "skipped: known directory/aggregator domain"})
            continue

        if host in known_domains:
            records.append({"source_url": url, "error": "skipped: domain already in leads table"})
            continue

        if host in seen_domains:
            records.append({"source_url": url, "error": "skipped: already found a lead from this domain in this run"})
            continue

        try:
            record = extract(url, niche=query)
            record["source_url"] = url
            if looks_like_directory(record):
                record = {"source_url": url, "error": "skipped: extraction matched directory/comparison-site language"}
            elif is_mostly_empty(record):
                record = {"source_url": url, "error": "skipped: extraction came back empty (business_type NA)"}
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
    parser.add_argument(
        "--skip-domains-file",
        default=None,
        help="File with one domain per line to skip (already-saved leads)",
    )
    args = parser.parse_args()

    if args.max > 50:
        print("Refusing --max > 50 in one run — stay bounded, see README.", file=sys.stderr)
        sys.exit(1)

    skip_domains: set[str] = set()
    if args.skip_domains_file:
        with open(args.skip_domains_file, encoding="utf-8") as f:
            skip_domains = {line.strip().lower() for line in f if line.strip()}

    results = search_leads(args.query, args.max, skip_domains=skip_domains)
    print(json.dumps(results, indent=2))
    unload_model()  # release RAM once the whole batch is done, not between URLs
