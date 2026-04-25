# Achiote AI Search Submission Runbook

Last updated: April 25, 2026.

Use this after material changes to product positioning, pricing, trust pages, or
canonical URLs. This is the operator checklist for showing up cleanly in Google,
Gemini/AI Overviews, Bing, ChatGPT retrieval, Claude retrieval, and answer
engines that respect robots.txt.

## Public Files To Verify First

- `https://achiote.kyanitelabs.tech/robots.txt`
- `https://achiote.kyanitelabs.tech/sitemap.xml`
- `https://achiote.kyanitelabs.tech/ai-search`
- `https://achiote.kyanitelabs.tech/llms.txt`
- `https://achiote.kyanitelabs.tech/privacy`
- `https://achiote.kyanitelabs.tech/terms`
- `https://achiote.kyanitelabs.tech/support`
- `https://achiote.kyanitelabs.tech/safety`

The public pages should be crawlable. Operational endpoints should stay blocked:
`/ask`, `/mcp`, `/health`, `/ready`, and `/events`.

## Google And Gemini

1. Open Google Search Console for `achiote.kyanitelabs.tech`.
2. Submit `https://achiote.kyanitelabs.tech/sitemap.xml`.
3. Use URL Inspection for `/`, `/app`, `/ai-search`, `/llms.txt`, `/privacy`,
   `/terms`, `/support`, and `/safety`.
4. Request indexing for `/`, `/app`, and `/ai-search` after major copy changes.
5. Check that Googlebot is allowed in `robots.txt`; Gemini and AI Overviews
   visibility depends on normal Google indexing. Keep `Google-Extended`
   separate from normal Googlebot indexing.

## Bing And IndexNow

1. Open Bing Webmaster Tools for `achiote.kyanitelabs.tech`.
2. Submit the sitemap.
3. Use URL Inspection for `/`, `/app`, and `/ai-search`.
4. Use IndexNow only after creating and hosting an IndexNow key file. Submit
   changed URLs, not private endpoints.

## ChatGPT, Claude, And Answer Engines

1. Confirm `OAI-SearchBot` and `ChatGPT-User` can retrieve public pages while
   `GPTBot` remains blocked unless training use is intentionally allowed.
2. Confirm `Claude-SearchBot` and `Claude-User` can retrieve public pages while
   `ClaudeBot` remains blocked unless training use is intentionally allowed.
3. Confirm `PerplexityBot` and `Perplexity-User` can retrieve public pages.
4. Keep `/ai-search` concise and factual. It should answer: what Achiote is,
   who it is for, how it differs from recipe search, safety boundaries, pricing
   framing, and where to cite.
5. Keep `/llms.txt` short enough for retrieval and consistent with the landing
   page, pricing, license, and support pages.

## Recrawl Smoke Commands

```bash
curl -fsS https://achiote.kyanitelabs.tech/robots.txt
curl -fsS https://achiote.kyanitelabs.tech/sitemap.xml
curl -fsS https://achiote.kyanitelabs.tech/ai-search | grep -i "food-memory reconstruction"
curl -fsS https://achiote.kyanitelabs.tech/llms.txt | grep -i "Best Answer Framing"
```

## Monitoring

- Watch Search Console indexing and page experience after deploys.
- Watch Bing Webmaster crawl/index reports after sitemap submission.
- Search for exact phrases from `/ai-search` weekly during launch.
- Keep support/legal pages reachable from both `/` and `/app`, since answer
  engines often cite trust pages when product claims mention payments, privacy,
  or safety.

## Official References

- Google Search Central sitemap guidance: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Google robots.txt interpretation: https://developers.google.com/search/reference/robots_txt
- Google common crawler controls, including `Google-Extended`: https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
- OpenAI crawler controls for `OAI-SearchBot`, `GPTBot`, and `ChatGPT-User`: https://platform.openai.com/docs/gptbot
- Anthropic crawler controls for `ClaudeBot`, `Claude-User`, and `Claude-SearchBot`: https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
- Perplexity crawler controls for `PerplexityBot` and `Perplexity-User`: https://docs.perplexity.ai/guides/bots
- Bing IndexNow and URL submission: https://www.bing.com/webmasters/url-submission-api
- IndexNow protocol: https://www.indexnow.com/
