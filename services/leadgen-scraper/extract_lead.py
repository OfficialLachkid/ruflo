#!/usr/bin/env python3
"""Extract a structured lead record from a business's public website.

Runs entirely locally against Ollama — no Anthropic/OpenAI API key, no
per-token cost. See README.md for setup.

Usage:
    python extract_lead.py https://example-business.com
"""

import json
import sys

from pydantic import BaseModel, Field
from scrapegraphai.graphs import SmartScraperGraph

OLLAMA_MODEL = "llama3.1:8b"

EXTRACTION_PROMPT = (
    "Extract a lead record for this business: its name, what it does "
    "(business type / services), any contact details (email, phone) that "
    "are publicly listed, links to social media profiles, and whether the "
    "site itself looks modern, dated, or barely functional."
)


class LeadRecord(BaseModel):
    business_name: str = Field(description="The business's name")
    business_type: str = Field(description="What the business does / its industry")
    services: list[str] = Field(description="Services or products offered")
    contact_email: str | None = Field(default=None, description="Public contact email, if listed")
    contact_phone: str | None = Field(default=None, description="Public contact phone, if listed")
    social_links: list[str] = Field(default_factory=list, description="Social media profile URLs")
    website_quality: str = Field(
        description="One of: modern, dated, minimal, broken — a rough read on the site itself"
    )


def extract(url: str) -> dict:
    graph = SmartScraperGraph(
        prompt=EXTRACTION_PROMPT,
        source=url,
        schema=LeadRecord,
        config={
            "llm": {
                "model": f"ollama/{OLLAMA_MODEL}",
                "format": "json",
                "temperature": 0,
            },
            "verbose": False,
            "headless": True,
        },
    )
    return graph.run()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python extract_lead.py <url>", file=sys.stderr)
        sys.exit(1)

    result = extract(sys.argv[1])
    print(json.dumps(result, indent=2))
