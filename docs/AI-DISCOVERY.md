# Getting found by search engines and AI assistants

What the code does on its own, and the one-time steps only the owner can do.
Written 2026-10-27.

## What ships in the code

| Piece | Why it helps | Where |
|---|---|---|
| **Deal pages** `/oferta/:id-:slug` | One indexable URL per deal with the price history chart and plain-text facts ("menor preço que registramos…"). This is what Google, Bing and AI assistants can actually cite; the home page alone only ever shows "today". Ended deals keep their page for "histórico de preço X" searches. | `src/site.ts` (`dealPage`), `src/http.ts` |
| **Structured data** | `Product` + `Offer` (only while live) + `BreadcrumbList` on deal pages; `WebSite`, `Organization`, `ItemList` on the home page. | `src/site.ts` |
| **`robots.txt`** | Everyone allowed except tracked redirects; AI crawlers named explicitly (OAI-SearchBot, Claude-SearchBot, PerplexityBot…); points to the sitemap. | `src/seo.ts` |
| **`sitemap.xml`** | Home + deal pages of the last 180 days. | `src/seo.ts` |
| **`feed.xml`** (RSS) | Lets feed readers, IFTTT/Zapier, Telegram RSS bots and aggregators pick up every deal. Links carry `?src=rss`. | `src/seo.ts` |
| **`llms.txt`** | Markdown summary for LLMs: what the site is, how to query it, the live deals. | `src/seo.ts` |
| **IndexNow** | Every newly published deal page is pushed to Bing (ChatGPT search leans on it), Yandex, Seznam, Naver within minutes. Needs `INDEXNOW_KEY`. | `pingIndexNow` in `src/seo.ts`, called from `finishPublishing` |
| **MCP server** `POST /mcp` | Claude, ChatGPT (developer mode / apps), Cursor and other MCP clients can search the deals live: `search_deals`, `latest_deals`, `get_deal`, `community_links`. No login, read-only. | `src/mcp.ts` |
| **JSON API + OpenAPI** | `/api/ofertas?q=&preco_max=&loja=` and `/openapi.json`: everything a ChatGPT **GPT action** needs. | `src/mcp.ts` |
| **Site verification tags** | `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION` add the meta tags, so a `workers.dev` site can be verified without DNS. | `src/config.ts`, `src/site.ts` |

Clicks that come from AI tools show up in `/stats` as **`web ai`**, feed clicks as **`web rss`**.

Honest expectations: an MCP server does not make ChatGPT or Claude recommend the
site to everyone; it's used by people who connect it. Most AI visibility comes
from being indexed (Bing/Google) with clear, quotable pages, which is what the deal
pages, structured data, sitemap and IndexNow are for. Expect weeks, not days.

## Owner checklist

Do 1 first: every URL you submit afterwards should be the final one.

1. **(Recommended) Custom domain.** See GROWTH.md §7.5. Then set `PUBLIC_BASE_URL`
   to it and redeploy. Search engines and registries remember URLs.
2. **Set the new settings** in GitHub → Settings → Secrets and variables → Actions,
   then run the deploy workflow:
   - `INDEXNOW_KEY`: any 32 random letters/digits (`node -e "console.log(crypto.randomUUID().replace(/-/g,''))"`).
   - `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`: from steps 3 and 4.
3. **Google Search Console** → add a *URL prefix* property with your site URL →
   verify with *HTML tag* (paste the `content` value into `GOOGLE_SITE_VERIFICATION`,
   redeploy, click Verify) → Sitemaps → submit `sitemap.xml`.
4. **Bing Webmaster Tools** → add site (or import from Search Console) → verify with
   the meta tag (`BING_SITE_VERIFICATION`) → submit `sitemap.xml`. Bing feeds
   ChatGPT search, DuckDuckGo and Copilot, so this one matters most.
5. **Check it works:** open `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/feed.xml`
   and one `/oferta/...` page; paste a deal page into Google's Rich Results Test.
6. **List the MCP server.** Update the two URLs in `server.json`, then:
   - Official MCP Registry: install `mcp-publisher`, run `mcp-publisher login github`
     and `mcp-publisher publish` from the repo root (the name
     `io.github.David-Ackerman/...` is tied to your GitHub login; the tool tells you
     if it wants different casing).
   - Also submit the `/mcp` URL to Smithery, Glama, mcp.so and PulseMCP (web forms).
7. **Create a ChatGPT GPT** "Dev das Promos" (ChatGPT → GPTs → Create):
   - Actions → Import from URL → `<site>/openapi.json`; Authentication: none;
     Privacy policy: `<site>/privacidade`.
   - Instructions (paste): *"Você ajuda brasileiros a achar promoções de tech, games
     e setup. Sempre use a ação searchDeals para buscar ofertas reais; mostre preço,
     loja, quando foi publicada e o link buy_url. Avise que preços mudam e que os
     links são de afiliado (#publi). No fim, ofereça os grupos (community)."*
   - Publish to *Everyone* (needs a verified builder profile: your name or domain).
8. **Claude:** anyone can add `<site>/mcp` as a custom connector (Settings →
   Connectors → Add custom connector). Put that one-liner in the X bio thread,
   the pinned Telegram message and the site footer link (`/llms.txt`).
9. **Feeds:** submit `<site>/feed.xml` to Feedly and Inoreader (search for it so it
   gets indexed), and use it with a free Telegram RSS bot if you open a second channel.
10. **Weekly:** glance at `/stats` for `web ai` / `web rss` / `web google`, and at
    Search Console → Performance for which deal pages get impressions.
