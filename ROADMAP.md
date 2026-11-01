# Roadmap

What's left to do, in order. Product ideas come from [docs/GROWTH.md](docs/GROWTH.md) §7;
search/AI steps from [docs/AI-DISCOVERY.md](docs/AI-DISCOVERY.md). Effort: S ≤ half a day,
M 1–2 days, L 3+ days. 👤 = only the owner can do it.

## 1. Before making the repo public

- [ ] 👤 Move `AMAZON_CLIENT_ID`, `TELEGRAM_ADMIN_CHAT_ID` and `TELEGRAM_GROUP_IDS`
      from **Variables** to **Secrets** (GitHub → Settings → Environments → production).
      Variables are readable in public workflow logs; secrets are masked.
- [ ] 👤 Restrict the `production` environment to the `main` branch (Deployment
      branches → Selected branches → `main`), so a fork or PR can never deploy or read secrets.
- [ ] 👤 Settings → Actions → "Require approval for all outside collaborators" for fork PRs.
- [ ] 👤 Decide on `AMAZON_SCRAPE`: the search-page reader is visible in public code.
      Keep it off, or accept that anyone (Amazon included) can read it.
- [ ] 👤 Decide whether `docs/GROWTH.md` (the marketing plan) should be public.
- [x] MIT license for the code; name, logo and artwork reserved (`LICENSE`, README).

## 2. Clean up the repo (S)

- [ ] Stop tracking `.pnpm-store/v11/index.db` and `.agents/`; add both to `.gitignore`.
- [ ] Pick one package manager. Workflows use **npm**: drop `pnpm-lock.yaml` and
      `pnpm-workspace.yaml`, or switch the workflows to pnpm.
- [ ] Commit the SEO / AI-discovery work in progress (`src/seo.ts`, `src/mcp.ts`,
      `test/seo.test.ts`, `server.json`, `docs/AI-DISCOVERY.md` and the edits in
      `src/http.ts`, `src/site.ts`, `src/repo.ts`, `src/publish.ts`, `src/config.ts`,
      `src/jobs/worker-secrets.ts`) after `npm test` and `npm run typecheck` pass.

## 3. Get found by Google, Bing and AI assistants (owner steps)

- [ ] 👤 Buy a custom domain (e.g. `devdaspromos.com.br`), add it as a Worker custom
      domain, set `PUBLIC_BASE_URL`. Do this first so every submitted URL is final.
- [ ] 👤 Set `INDEXNOW_KEY`, `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`.
- [ ] 👤 Google Search Console + Bing Webmaster Tools: verify, submit `/sitemap.xml`.
- [ ] 👤 Update the URLs in `server.json` and list the MCP server in the registry.
- [ ] 👤 Create the "Dev das Promos" GPT using `/openapi.json`.
- [ ] 👤 Submit `/feed.xml` to Feedly and Inoreader.

## 4. Product: next features

| # | Feature | Why | Effort |
|---|---|---|---|
| 1 | **Member referral links + monthly ranking** (`/convite`, `/ranking`, "Hall da Fama" with admin ✅) | Cheapest way to get new members; join tracking already exists | M |
| 2 | **Category pages** `/categoria/:slug` (SSD, periféricos, monitores, games, áudio, setup) + in sitemap | Long-tail searches; deal pages already shipped | M |
| 3 | **Keyword alerts by DM** (`/alerta ssd 1tb`, `/alertas`, `/parar`) | Keeps people who mute the feed; gets them to start the bot | M |
| 4 | **Photo for blocked Amazon posts**: admin sends a screenshot/photo with the reply, used as the post image | Amazon blocks page reads from Cloudflare, so these posts have no picture | S |
| 5 | **X weekly Top 3 thread + link-mode A/B test** | Learn if link-in-reply is worth the cost, within the $10/month budget | S |
| 6 | **Weekly poll automation** (Telegram + WhatsApp, Wednesday) | Engagement with no daily effort | S |
| 7 | **Small copy items in renders** (disclosure, CTA lines) | Compliance and conversion | S |
| 8 | **Branded image cards from real product photos** | Better-looking posts on X/Instagram | L |

## 5. Amazon

- [ ] 👤 When the Associates account gets **Creators API** access, set the API keys
      and confirm `/buscar` returns Amazon deals; then turn `AMAZON_SCRAPE` off.
- [ ] Until then: keep sending links from the app (auto-tagged) and use the
      one-reply price + name flow when Amazon blocks the page.

## 6. Growth routine (owner, ongoing)

- [ ] 👤 Named Telegram invite links per source (`site`, `x`, `ig`, `tt`) and `?src=` in every bio.
- [ ] 👤 Open a WhatsApp Channel; keep the group admin-only.
- [ ] 👤 Post 3–5 short videos a week (🎬 button) on Reels / TikTok / Shorts.
- [ ] 👤 Weekly: check `/stats` (joins and retention per link, site visits per source,
      `web ai` / `web rss`) and move time to what works.
