# Leadgen Scraper

## Purpose

Structured extraction layer for lead generation: turn a business's public web pages into a structured lead record (company description, services, contact details, socials, and a rough read on website quality) so the sales agent doesn't have to do that reading itself.

This is an extraction layer, not the lead generation system. It does not qualify, score, or decide fit — see [[05_Playbooks/Lead_Generation_Playbook]] in the vault for the qualification rules this feeds into.

## Stack

- [ScrapeGraphAI](https://github.com/ScrapeGraphAI/Scrapegraph-ai) (MIT) — LLM-driven scraping pipelines (`SmartScraperGraph` etc.) built on LangChain, with Playwright for JS-rendered pages.
- Local LLM backend via [Ollama](https://ollama.com) — **tokenless**, runs entirely on this machine. No Anthropic/OpenAI API key required and no per-token cost.

## Why local instead of a hosted LLM

A Claude.ai / Claude Code subscription does **not** include Anthropic API credits — those are billed separately, per token. Pointing ScrapeGraphAI at a hosted LLM (OpenAI, Anthropic via `langchain-anthropic`, etc.) would mean a second, separate bill. Running it against a local Ollama model avoids that entirely — the only cost is this machine's compute.

## Setup (already done on this machine)

```bash
# from repo root
python3 -m venv .venv-leadgen
source .venv-leadgen/bin/activate
pip install -r services/leadgen-scraper/requirements.txt
python -m playwright install chromium

# local model for tokenless extraction
ollama pull llama3.1:8b
```

## Usage

Single known URL:

```bash
source .venv-leadgen/bin/activate
python services/leadgen-scraper/extract_lead.py https://example-business.com
```

Search + batch extract (candidate discovery, no known URL yet):

```bash
source .venv-leadgen/bin/activate
python services/leadgen-scraper/search_leads.py "electricians in Rotterdam" --max 5
```

`search_leads.py` runs a DuckDuckGo search (via `ddgs`, no API key) for candidate URLs, then extracts each through the same pipeline as `extract_lead.py`, returning a JSON array of lead records. Directory/listing pages (marketplaces, review sites) tend to come back with `"NA"` fields since there's no single business to extract — filter those out downstream. `--max` is capped at 20 per run to stay bounded; see "Explicitly Out of Scope" below.

See `extract_lead.py` for the extraction schema and Ollama config. Swap `OLLAMA_MODEL` for a smaller/faster model (`llama3.2:3b`) if extraction quality is good enough and speed matters more, or a larger one if the 8B model under-extracts on complex pages.

## Output Contract

Matches the "Minimum Structured Lead Record" shape from the vault playbook:

- business name
- website
- business type / what they do
- services offered
- contact details (email, phone) if publicly listed
- social links
- a rough read on website quality (modern / dated / none found) — used as a fit signal, not a verdict

## Explicitly Out of Scope Here

- lead qualification / fit scoring — stays in the sales agent's judgment, not this extractor
- outbound sending — this only reads public pages, never contacts anyone
- bulk/unattended crawling at scale — `search_leads.py` is bounded to one search query and `--max 20` per run, not a scheduled/looping crawler; revisit compliance and rate-limiting before scaling further
