# Growth plan: Dev das Promos

A practical plan to grow reach, members and clicks across the Telegram group,
WhatsApp, X (@devdaspromocoes) and the public site, written for **one admin with
limited time**. Explanations are in English; everything meant for the audience is
in pt-BR and ready to paste.

Written on 2026-10-17. **Black Friday 2026 is on Friday, November 27** (Cyber
Monday on the 30th), and Shopee's **11.11** sale falls inside the first 30 days.
The whole plan is built so the community is ready to catch that wave: it is the
one time of year when Brazilians actively look for deal groups, and also the
time when they distrust deals the most ("Black Fraude").

- [1. Diagnosis](#1-diagnosis)
- [2. Positioning and voice](#2-positioning-and-voice)
- [3. Channel playbooks](#3-channel-playbooks)
- [4. Ready-to-paste copy (pt-BR)](#4-ready-to-paste-copy-pt-br)
- [5. 30-day launch calendar](#5-30-day-launch-calendar)
- [6. KPIs and measurement](#6-kpis-and-measurement)
- [7. Product changes for the engineer](#7-product-changes-for-the-engineer)
- [8. Owner checklist](#8-owner-checklist)
- [Sources and confidence](#sources-and-confidence)

---

## 1. Diagnosis

**The bottleneck is acquisition, by a wide margin.** The product side (finding,
approving, posting, tracking deals) is already ahead of most Brazilian deal
groups: a fake-discount filter, a price check before posting, banners on ended
deals, a weekly Top 10 and per-channel tracked links. What it lacks is a steady
stream of new people. Ranked:

| # | Bottleneck | Stage | Why it matters here |
|---|---|---|---|
| 1 | **No discovery engine.** | Acquisition | Telegram and WhatsApp groups are *closed*: nobody stumbles into them. Growth comes only from things that live in public feeds (short video, X, search) or from members forwarding posts. Today the only public surfaces are an X account with 3 posts/day and a site on a `workers.dev` address with no SEO surface (one page, no sitemap, no per-deal or per-category pages). |
| 2 | **Can't tell what brings people in.** | Measurement | `/stats` counts clicks per channel and group, but not *joins*. All site traffic is one "web" bucket, so the X bio, Instagram bio and TikTok bio are indistinguishable. Without that, the admin can't double down on what works. (Fixable without code on day 1 with Telegram's named invite links; see [§3.1](#31-telegram)). |
| 3 | **Generic look on public feeds.** | Acquisition / conversion | A deal post with a store photo looks like every other "achadinhos" account. Nothing in the feed says "this is the dev who checks the price history". The differentiator (no fake discounts) exists in the code but not in the copy. |
| 4 | **Join friction from X and the site.** | Conversion | On X, only the day's first deal carries a link; the rest say "link na bio". If the bio link drops people on a page where joining is a secondary button, most bounce. The bio link should land on the site with a strong "entrar no grupo" CTA *and* the deal they came for. |
| 5 | **Retention risk from volume.** | Retention | A new group that posts 15 mediocre deals a day gets muted and left. With 5 searches × 2 previews/day, the admin can easily approve too much. In a tech niche, *fewer, better* deals and a weekly roundup keep people. |
| 6 | **WhatsApp scale.** | Retention / ops | WhatsApp groups cap at 1,024 participants ([source](https://messengerbot.app/hi/whatsapp-channels-2026-what-they-are-and-how-to-use-them/)) and posting is manual. Fine for now; plan for a WhatsApp Channel early. |

**Conversion (click → purchase)** is not the bottleneck yet: deals are already
filtered for real discounts and commission-aware ranking. Revisit after 60 days
with Shopee's conversion report (the post `ref` is the sub-id).

**What this means for the plan:** spend the admin's scarce time on (1) short
videos and manual X engagement, which are free and public, (2) measuring joins per
source, and (3) a sharper positioning that makes people *want to forward* posts.
Automate everything else.

---

## 2. Positioning and voice

### One-line positioning

> **Dev das Promos: as ofertas de tech, games e setup que um dev checou antes de você. Desconto fake não passa.**

English gist: the deals group for people who like tech, curated by a dev who
checks the price history, so fake discounts never make it in.

This is honest *because the code does it*: the collector skips products that were
cheaper in the last 30 days, the bot re-checks the price before posting, and ended
deals get a banner. Lean on it hard around Black Friday, when "Black Fraude"
distrust peaks.

### Three content pillars

1. **Preço bugado (the deals).** Real discounts on tech, gadgets, games and
   setup gear, with the old/new price and the store. This is 80–90% of posts.
2. **Desconto real ou fake? (the proof).** Showing the price history, calling out
   fake discounts, explaining "o preço 'de' estava inflado". This is the trust
   builder and the best short-video material. It is also unique: generic groups
   can't do it because they don't keep price history.
3. **Setup e comunidade (the people).** "Mostra seu setup", polls ("qual
   periférico você troca primeiro?"), "monte um setup com R$ 500", weekly Top 10.
   This is what makes people stay and forward.

### Tone rules

- **Dev humor, one joke, then get out of the way.** The AI caption is 1–2
  sentences; keep it that way. Jokes about bugs, deploys, commits, RAM, "funciona
  na minha máquina". Never at the reader's expense.
- **Numbers do the selling.** Price, old price, % off, store. No adjectives like
  "imperdível", "corre", "últimas unidades" unless the bot actually knows it (it
  does know "ESGOTOU" after the fact, and that's the only urgency we use).
- **Never claim what we can't prove.** No "menor preço do Brasil", no "só hoje"
  unless the store says so. What we *can* say, from our own data: "menor preço que
  vimos nos últimos 30 dias".
- **Always disclose.** Every post and video carries `#publi` and "link de
  afiliado" (already in `POST_FOOTER`). See [compliance](#compliance-notes).
- **Talk like a person in a group chat**, pt-BR, "você", short lines, at most 1–2
  emojis per block. No ALL CAPS shouting.
- **Admit mistakes fast.** If a deal ended, the banner does it; if a post was
  wrong, say "foi mal, bug nosso" in the group. That *is* the brand.

### What makes them different from generic "achadinhos" groups

| Generic achadinhos group | Dev das Promos |
|---|---|
| Everything from capinha to air fryer | Only tech, gadgets, games, setup |
| 30–80 posts/day, mostly Shopee filler | ~8–12 curated posts/day, quality first |
| "De R$ 299 por R$ 99!!" (inflated "de") | Price history checked, fake discount filtered |
| Dead links, sold-out deals stay up | Price re-checked before posting; "ESGOTOU" banner after |
| Faceless | A recognizable character (the dev mascot) and a voice |
| Member list exposed to scammers | Admin-only feed, hidden members, clear anti-scam rules |

---

## 3. Channel playbooks

Time budget assumed: **about 60 minutes/day on weekdays, 2 hours on one weekend
day.** The bot already does the deal work; the admin's time goes to approvals
(~10 min/day), video (~30 min/day on average, batched), and X engagement
(~15 min/day).

### 3.1 Telegram

**Decision to make in week 1: group vs channel.** Most large Brazilian deal
communities run a Telegram **channel** (broadcast, admin-only) with an optional
linked **discussion group**, not a plain group. For Dev das Promos:

| | Plain group (today) | Channel + linked discussion group (recommended) |
|---|---|---|
| Discovery | Private `+` invite link, not searchable | Public `@username` shows up in Telegram search and has a clean `t.me/devdaspromos` link |
| Feed | Member chatter mixes with deals | Clean feed of deals; comments live under each post |
| Scam exposure | Members visible to scam bots unless hidden | Subscribers are never listed |
| Size limit | 200k members | Unlimited subscribers |
| Join tracking | Named invite links work | Named invite links work |

Recommended migration (no code, ~30 min; the engineer should confirm the bot
behaves the same in a channel: posting, editing for the ESGOTOU banner, roundup):

1. Create a public channel "Dev das Promos", username e.g. `@devdaspromos` (check
   availability), same photo/banner. Add the bot as admin with "post messages" and
   "edit messages of others".
2. In the channel settings, set the **existing group as its discussion group**,
   so current members keep a place to talk and comments appear under posts.
3. Get the channel id with `/id` (forward a channel post to the bot or follow the
   engineer's instructions) and put it in `TELEGRAM_GROUP_IDS`. **Remove the old
   group id** from that list: channel posts are copied into the linked discussion
   group automatically, so keeping both would post every deal twice.
4. Pin a message in the old group: "As ofertas agora saem no canal @devdaspromos,
   aqui fica o papo". Update `SITE_TELEGRAM_URL`, the X bio and everything else.

If you prefer to keep a group only: set **members cannot send messages** (or
slow mode 60s if you want chat), turn on **Hide members** and **aggressive
anti-spam** in the group settings (Telegram offers both for larger groups), and
keep the rest of this playbook.

**Settings either way**

- Photo: the mascot face on a solid color (readable at 40px). Banner image in the
  pinned message.
- **Named invite links (do this on day 1, no code):** Settings → Invite links →
  Create a new link, give it a name. Telegram shows how many people joined through
  each one. Create one per source: `site`, `x-bio`, `x-fixado`, `ig-bio`,
  `tiktok-bio`, `yt-bio`, `wa-grupo`, `indicacao-geral`, and one per partner. Use
  them everywhere instead of the single link. This is the cheapest high-value
  action in the whole plan.
- Rules in the description and pinned message (copy in [§4.4](#44-telegram-pinned-welcome-message)).
- In the discussion group: no links from members except store links in
  discussion threads, no referral codes, no DMs offering "deals". Ban scammers on
  sight.

**Cadence and formats**

- **8–12 deals/day**, spaced by the queue (40 min, 8h–23h). Approve the best 2–3
  per search run, not everything. During Black Friday week you can go up to ~20/day,
  but keep the same bar.
- **Weekly Top 10, Sundays 18h** (already automated; just tap ✅). Pin it until
  Wednesday.
- **One poll per week** (Wednesday evening): native Telegram poll, e.g. "Qual
  categoria vocês querem mais?" Use the answer to tune `SHOPEE_KEYWORDS`.
- **One "Mostra seu setup" thread per month** in the discussion group, best one
  gets reposted in the channel (with permission).
- **Black Friday:** a pinned "Guia anti-Black-Fraude" post (how we check prices),
  plus a daily "Top 5 de hoje" on the 27th and 30th.

**Member-get-member**

- Every Top 10 and every pinned post ends with a forwardable invite line
  ([§4.6](#46-invite--share-messages-members-can-forward)).
- Once the engineer ships referral links ([§7](#7-product-changes-for-the-engineer)),
  members get a personal link from the bot and a monthly "Hall da Fama" of who
  brought the most people who *stayed*.
- Recognition costs nothing and is always allowed. Prizes for referrals have legal
  constraints in Brazil; see [compliance](#compliance-notes).

**Avoid:** adding people without consent, "boost" or member-buying services,
cross-posting the invite link into other people's groups, posting more because
"the bot found it", leaving sold-out deals unmarked (the bot handles this).

### 3.2 WhatsApp

WhatsApp stays manual (one tap from the preview). Unofficial gateways risk bans,
so keep `WHATSAPP_MODE=share`.

**Structure**

- Keep the **group** for now, set to **only admins can send messages** and **only
  admins can edit group info**. This keeps it a clean feed and protects members.
- **Open a WhatsApp Channel ("Canal") in week 2.** Channels are admin-only,
  have no follower cap, hide followers' phone numbers, and are discoverable in the
  Updates tab ([source](https://messengerbot.app/hi/whatsapp-channels-2026-what-they-are-and-how-to-use-them/)).
  Many people refuse to join groups because their number is exposed; a channel
  removes that objection. Post the same best deals there. (Channels also support
  24h "status"-style updates per [WABetaInfo](https://wabetainfo.com/whatsapp-is-rolling-out-the-fifa-world-cup-2026-hub-for-channels/);
  useful for a daily "top 3 de hoje".)
- When the group nears ~900 members, open group #2 rather than letting it fill;
  the bot already supports per-group tracking for Telegram, and for WhatsApp the
  share link is per channel.

**Cadence**

- **5–8 deals/day**, only the best ones (WhatsApp notifications are more intrusive
  than Telegram; people leave faster). Nothing after 22h.
- Send the **weekly Top 10** via the 📲 button on the roundup preview.
- One **native WhatsApp poll** per week, same question as Telegram.

**Avoid:** broadcast lists to people who didn't opt in, Evolution/Z-API on the
main number, mass-forwarding to other groups, posting the group link in other
groups you are in.

### 3.3 X (@devdaspromocoes)

**What the bot does automatically (keep it):** ~3 posts/day, photo + text without
link, the day's first deal gets a reply with the link, the rest say "link na
bio". Store diversity and niche rules are already handled.

**Budget math (from `.env.example` costs):** 90 posts/month × US$ 0.015 ≈ US$ 1.35;
30 link replies × US$ 0.20 = US$ 6.00. Total ≈ US$ 7.35, leaving ~US$ 2.65 of
headroom (about 13 more link replies). **Everything below is done by the admin
from the X app, which costs nothing.**

**Note on links (uncertain, worth a test):** the "link-free post + link in reply"
pattern comes from the widely reported link penalty. In July 2026, Elon Musk said
X hadn't penalized links "for over a year" and Nikita Bier said links no longer
need to go in replies; an observational study of 28k posts found no impression
drop for posts with links ([summary](https://opentweet.io/x-algorithm-changes)).
Other marketers still report lower reach ([SocialPilot](https://socialpilot.co/blog/twitter-algorithm)).
Since a link post costs US$ 0.20 versus US$ 0.215 for post + link reply, run a
2-week test (see [§7, item 9](#7-product-changes-for-the-engineer)): if link
posts get similar impressions, `X_MODE=link` on the day's best deal is slightly
cheaper *and* converts better.

**Organic tactics (15 min/day)**

- **Replies are the growth channel on X.** Replies weigh far more than likes in
  ranking (the exact multipliers in the 2026 code are reportedly redacted, so treat
  numbers you read online as unverified; [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm)).
  Every day, reply usefully to 5–10 posts from big Brazilian tech/gaming
  accounts (tech news, hardware reviewers, game stores, dev influencers) *within
  the first 30 minutes* of their post. Useful = a fact, a price comparison, a
  joke in the brand voice. **Never drop a deal link in someone else's thread.**
- **Quote posts:** when a big account posts about a product launch or a price,
  quote it with "Já teve por R$ X em [mês], hoje tá R$ Y. Se cair, aviso no
  grupo." This showcases the price-history pillar.
- **Reply to every reply** on your own posts in the first hour. X added mutual-
  follow signals in 2026 ([summary](https://opentweet.io/x-algorithm-changes)),
  so building real back-and-forth with tech accounts compounds.
- **1 engagement post/day** (polls, "qual seu setup", hot takes) from the
  templates in [§4.8](#48-x-engagement-templates-non-deal-posts). Polls are cheap
  engagement and tell you what to search for.
- **Weekly thread (Sundays):** "Top 5 da semana" with photos, built manually
  from the Top 10 roundup. Put the site link in the *last* tweet of the thread.
- **Pinned post:** the "por que seguir" post ([§4.2](#42-x-pinned-post)), refreshed
  monthly. Pin the best-performing Black Friday guide during November.
- **Bio link:** point to the site with a source tag, `?src=x` (works today as a
  plain URL; it will be measured once [§7 item 1](#7-product-changes-for-the-engineer)
  ships). Put the Telegram `x-bio` named invite link in the pinned post.
- **Header:** the existing banner ("Bug no preço. Commit no carrinho.").

**Avoid:** follow/unfollow, engagement pods, buying followers, auto-DMs,
reply-spamming deal links, trending hashtags unrelated to the post. The bot
already uses at most one brand hashtag + `#publi`.

### 3.4 Site and SEO

The site is the landing page for every "link na bio" on X, Instagram and TikTok,
so its first job is **converting visitors into members**, and only second
ranking on Google.

**Now (no or little code)**

- Use the Telegram **`site` named invite link** for `SITE_TELEGRAM_URL` and the
  WhatsApp group (or Channel) link for `SITE_WHATSAPP_URL`.
- Use `?src=` tags in every bio: `?src=x`, `?src=ig`, `?src=tt`, `?src=yt`.
- **Buy a custom domain** (e.g. `devdaspromos.com.br`, ~R$ 40/year at registro.br;
  a `.dev` domain is on-brand but costs more). It builds trust (people distrust
  `workers.dev` links), is shorter to say in videos, and lets search equity
  accumulate on an address you own. Connect it to the Worker as a custom domain in
  Cloudflare; the engineer then changes `PUBLIC_BASE_URL` (keeping the old address
  working, since old posts link to `/go/` on it).
- Register in **Google Search Console** and **Bing Webmaster Tools** once the
  domain is live.

**SEO approach, realistically.** Ranking for "promoção" or "ofertas" against
Pelando, Promobit, Zoom and the stores is not realistic. The winnable searches
are long-tail and evergreen: "histórico de preço [produto]", "[produto] vale a
pena no preço", "ofertas de SSD NVMe", "teclado mecânico barato". The bot already
stores every price it sees (`price_snapshots`), which is exactly the content those
searches want. So the SEO work is: category pages, per-deal pages with price
history, a sitemap, and Product structured data (product snippets are meant for
pages that aggregate product info, which fits an affiliate site better than
merchant listings; see [Google's announcement](https://developers.google.com/search/blog/2022/09/merchant-listings)).
Expect SEO to matter after 90+ days, not in the first month. Details in [§7](#7-product-changes-for-the-engineer).

**Avoid:** auto-generated filler text, keyword stuffing, copying store
descriptions, cloaking affiliate links. Keep `rel="sponsored"` on outbound links
(already done).

### 3.5 Short video (Reels, TikTok, YouTube Shorts): the main acquisition engine

Short video is the only free channel where a brand-new account can reach tens of
thousands of strangers. One video, three uploads (record once, post to all three
with native captions).

**Cadence:** **4 videos/week** in the first month (batch-record 4 on the weekend in
~90 min, edit ~15 min each in CapCut). Post at 12h or 19h–21h; check `/stats`
best hours and each platform's analytics after 2 weeks and adjust.

**Formats that fit this brand**

1. **"Desconto real ou fake?"**: screen recording of a product page + the price
   history, verdict at the end. Best trust builder, and evergreen-ish.
2. **"Setup de dev com R$ X"**: build a desk setup from current deals under a
   budget. High save/share rate.
3. **"Comprei o gadget mais barato de tech da Shopee"**: real unboxing of a cheap
   item you actually bought (also the contest prize pool).
4. **"3 achados de tech abaixo de R$ 50"**: fast list, faces optional.
5. **"Bug no preço"**: a single absurd real deal, 15s, reaction format.

**Rules for every video**

- **Hook in the first 2 seconds**, on screen as text *and* spoken.
- **Show the mascot** (sticker/overlay or a cutout) at the start and end so the
  account is recognizable; face on camera is optional but helps.
- **Prices go stale; videos don't.** Say "preço no dia da gravação, confere no
  link" and favor formats where the lesson outlives the price (fake vs real,
  setup ideas).
- **CTA every time, one only:** "Link do grupo na bio" (bio → site with `?src=`).
- **Disclose:** "link de afiliado" on screen + `#publi` in the caption; also turn
  on each platform's commercial/branded content label where available (the exact
  toggle names change; check each app).
- Reply to comments with video replies; they are cheap follow-up content.

**Avoid:** reposting other creators' videos, AI voice-overs that sound like spam
pages, fake "comprei e me arrependi" stories, showing a price as "hoje" in a video
that will be watched next week.

### Compliance notes

- **Affiliate disclosure (CONAR):** CONAR's influencer guide requires the
  commercial relationship to be clear to the audience, and recommends `#publi` /
  `#publicidade` alongside the platforms' own labels ([CONAR guide, 2020 PDF](https://static.poder360.com.br/2020/12/Guia-influenciadores.pdf),
  [Propmark summary](https://propmark.com.br/?p=125124)). A 2026 update of the guide
  reportedly puts more weight on the platforms' built-in ad labels; I could not
  verify the text, so **do both**: keep `#publi · link de afiliado` everywhere
  *and* use platform labels where they exist. Check [conar.org.br](https://www.conar.org.br)
  for the current version.
- **Giveaways and prizes (important):** in Brazil, giving away prizes "a título
  de propaganda" by draw, voucher or contest generally needs prior authorization
  from the Ministério da Fazenda (Secretaria de Prêmios e Apostas, Lei 5.768/1971),
  and only companies (CNPJ) can be authorized, not individuals; random draws on
  social networks and cash/PIX prizes are reported as not allowed
  ([Migalhas](https://www.migalhas.com.br/depeso/347817/influenciadores-e-os-sorteios-nas-redes-sociais),
  [third-party summary of SPA guidance](https://visu.network/br/ferramentas/regulamento-de-sorteio/)).
  The exception is a purely **cultural contest** (no luck, no payment, no link to
  buying anything), which SPA reportedly reads narrowly. A prize for "who brought
  the most members" is a promotional contest and is **likely to need
  authorization**. This is not legal advice: talk to a lawyer before running any
  prize. The plan therefore uses (a) a referral ranking with **recognition only**
  and (b) a cultural setup contest judged on merit, as the default.

---

## 4. Ready-to-paste copy (pt-BR)

Replace `[link]` placeholders with the matching **named invite link** or the site
URL with `?src=`.

### 4.1 X bio (≤160 characters)

Option A (recommended):
```
Bug no preço, commit no carrinho. 🐛🛒 Ofertas de tech, games e setup com histórico de preço checado. Desconto fake não passa. Grupo grátis 👇 #publi
```
Option B:
```
Dev caçando preço bugado pra você: SSD, periféricos, games e setup. Só desconto real (a gente checa o histórico). Links de afiliado #publi
```
Option C:
```
Ofertas de tech, gadgets e setup 🖥️ Curadoria de dev, preço checado no histórico, zero desconto fake. Todas as ofertas no link 👇 #publi
```
Website field: `https://[seu-dominio]/?src=x` (until the domain exists:
`https://das-promos.dev-das-promos.workers.dev/?src=x`).

### 4.2 X pinned post

```
Oi, eu sou o Dev das Promos 👨‍💻

Todo dia eu caço ofertas de tech, games e setup na Shopee, Amazon e Mercado Livre e:
✅ checo o histórico de preço (desconto inflado não entra)
✅ confiro o preço de novo antes de postar
✅ aviso quando esgota

Aqui no X saem só as melhores do dia. Todas vão pro grupo grátis no Telegram 👇
[link x-fixado]

#publi · links de afiliado
```
(Post the link in the pinned post itself; it's a manual post, so no API cost.)

### 4.3 Telegram channel/group description (≤255 characters)

```
Ofertas de tech, games e setup escolhidas por um dev 👨‍💻 Checamos o histórico de preço: desconto fake não entra. Só o admin posta. Links de afiliado (#publi). Site: [seu-dominio] · X: @devdaspromocoes
```

### 4.4 Telegram pinned welcome message

```
👋 Bem-vindo ao Dev das Promos!
Bug no preço. Commit no carrinho. 🐛🛒

O que sai aqui:
🖥️ Ofertas de tech, gadgets, games e setup (Shopee, Amazon e Mercado Livre)
📉 Só desconto real: a gente compara com o histórico de preço antes de postar
❌ Quando uma oferta esgota ou o preço sobe, o post ganha um aviso
🏆 Domingo às 18h: Top 10 da semana

Como aproveitar:
🔔 Deixe as notificações ligadas (ou só as menções, se preferir menos barulho)
🔗 Os links são de afiliado: a gente pode ganhar uma comissão, sem custo extra pra você (#publi)
💬 Preço e estoque mudam rápido. Confira na loja antes de pagar.

Regras rápidas:
1. Só o admin posta ofertas.
2. Ninguém daqui vai te chamar no privado oferecendo promoção, cupom ou "vaga". Se acontecer, é golpe: bloqueie e denuncie.
3. Respeito sempre. Sem spam, sem link de outros grupos, sem código de indicação.

Gostou? Manda pro amigo que vive montando setup: [link indicacao-geral]
```

### 4.5 WhatsApp group description and rules

Description:
```
Dev das Promos 👨‍💻 Ofertas de tech, games e setup com preço checado no histórico. Desconto fake não entra.
5 a 8 ofertas por dia, nada depois das 22h. Domingo: Top 10 da semana.
Links de afiliado (#publi): podemos ganhar comissão, sem custo extra pra você.
Mais ofertas no Telegram: [link wa-grupo]
```
Rules (pinned message or below the description):
```
📌 Regras do grupo
1. Só admins enviam mensagens. É um feed de ofertas, sem conversa, pra não lotar seu celular.
2. O admin NUNCA chama ninguém no privado. Mensagem oferecendo cupom, "vaga" ou pedindo código/PIX é golpe.
3. Preço e estoque mudam rápido: confira na loja antes de pagar.
4. Os links são de afiliado (#publi).
5. Quer silenciar? Tudo bem, o Top 10 de domingo resume a semana.
```

### 4.6 Invite / share messages members can forward

Short (for WhatsApp/Telegram forwards):
```
Achei um grupo de promo de tech que não posta desconto fake: eles checam o histórico de preço antes. Só SSD, periférico, game e setup, sem spam de capinha 😅
👉 [link indicacao-geral]
```
For devs/gamers:
```
Pra quem tá montando ou melhorando setup: o Dev das Promos posta oferta de tech com preço checado (e avisa quando esgota). Grátis, só o admin posta.
Telegram: [link indicacao-geral]
WhatsApp: [link do canal]
```
Black Friday version (use from Nov 20):
```
Black Friday sem Black Fraude 🕵️ O Dev das Promos compara o preço com o histórico antes de postar, então desconto inflado não entra. Vale entrar antes do dia 27:
👉 [link indicacao-geral]
```

### 4.7 Weekly Top 10 footer (add as the last line when sending, or ask the engineer to add it)

```
Curtiu o Top 10? Encaminha pra quem vai comprar algo de tech essa semana 🙏 [link indicacao-geral]
```

### 4.8 X engagement templates (non-deal posts)

1. **Poll (categories):**
   ```
   Pra eu caçar essa semana: o que vocês querem ver mais no feed?
   🖱️ Periféricos
   💾 SSD / RAM
   🎮 Games e controles
   🪑 Cadeira / mesa / setup
   ```
2. **Setup prompt:**
   ```
   Mostra seu setup com uma foto e diz qual foi a melhor compra dele (e quanto pagou) 👇
   Começo eu: monitor ultrawide comprado na promo, melhor commit da minha vida.
   ```
3. **Price-history take (pillar 2):**
   ```
   Lembrete de dev antes da Black Friday: "de R$ 499 por R$ 299" não significa nada se semana passada já era R$ 289.
   Eu só posto oferta que tá abaixo do histórico. Qual produto você tá esperando cair?
   ```
4. **Hot take / debate:**
   ```
   Opinião impopular: teclado mecânico de R$ 150 já resolve a vida de 90% dos devs.
   Concorda ou vai defender o seu de R$ 900? 😅
   ```
5. **"Bug report" (weekly recap, Sunday, as a thread opener):**
   ```
   🐛 Bug report da semana: os 5 preços mais bugados que passaram pelo grupo 🧵
   ```
   (Then 1 tweet per deal with photo; site link in the last tweet. Mark ended deals as "esgotou".)

### 4.9 Short-video scripts (15–30s)

Each: on-screen text in **bold**, voice-over in quotes. Caption on every upload:
`Link do grupo na bio. #publi link de afiliado #setup #tech`

**Video 1: "Desconto fake" (25s)**
- 0–2s: Close on product page with a big red "-60%". **"Esse -60% é mentira."**
- 2–8s: Screen recording scrolling to the price history (from our data or the
  store's). "Semana passada esse mesmo fone custava R$ 129. Hoje 'de R$ 299 por R$ 119'."
- 8–16s: Highlight the real drop. "O desconto real é de 8%. O resto é preço inflado."
- 16–22s: Mascot overlay. "No Dev das Promos eu checo o histórico antes de postar. Fake não entra."
- 22–25s: **"Link do grupo na bio"**, "link de afiliado" small on screen.

**Video 2: "Setup de dev com R$ 500" (30s)**
- 0–2s: Empty desk, then hands slap the table. **"Setup de dev com R$ 500. Dá?"**
- 2–20s: Quick cuts, one per item with price on screen: teclado, mouse, suporte de monitor, luminária, mousepad grande. "Teclado mecânico R$ 139... mouse R$ 59..."
- 20–26s: Total on screen. "Deu R$ 487, com preço de hoje."
- 26–30s: **"Os links tão no grupo, link na bio"** + "#publi link de afiliado".

**Video 3: "Comprei o gadget de tech mais barato da Shopee" (30s)**
- 0–2s: Package in hand. **"Paguei R$ 19 nisso. Bug ou golpe?"**
- 2–20s: Unboxing + test (e.g. hub USB, suporte de celular, luz de mesa). Honest verdict.
- 20–26s: "Vale pelo preço? [sim/não e por quê]."
- 26–30s: "Esse vai pro sorteio cultural do mês, regras no grupo. Link na bio."
  (Only say this if the contest in §4.10 is running.)

**Video 4: "3 achados abaixo de R$ 50 pra sua mesa" (20s)**
- 0–2s: Text over desk: **"3 coisas de R$ 50 que mudam sua mesa"**.
- 2–16s: 3 items, 4–5s each: shot of the item in use, price on screen.
- 16–20s: "Preço do dia da gravação, confere no link. Grupo na bio." + disclosure.

**Video 5: "Bug no preço" (15s)**
- 0–2s: Mascot overlay + alarm sound. **"BUG NO PREÇO 🚨"** (only for a real, history-checked drop).
- 2–10s: Product page, old price struck, new price, "menor preço que a gente viu em 30 dias".
- 10–15s: "Esse já foi pro grupo há 2 horas. Quer ver primeiro? Link na bio." + disclosure.

### 4.10 Monthly contest announcement

**Default (lower legal risk): cultural contest + recognition-only referral ranking.**
The admin pays for the prize; no store sponsors it.

```
🏆 Desafio do Setup de [MÊS]

Quer ganhar um [gadget, ex.: hub USB-C / suporte de monitor, até R$ 80]? É um presente pago do meu bolso, sem patrocínio de loja.

Como participar:
1. Poste no grupo de conversa (ou responda este post) uma foto do seu setup + uma frase: "o melhor upgrade que eu fiz foi ___ porque ___".
2. Até [data], 23h59. Uma participação por pessoa.

Como escolho:
Critérios: criatividade da frase (50%), organização do setup (30%), dica útil pros outros (20%). Não é sorteio e não precisa comprar nada nem indicar ninguém.

Resultado em [data] aqui no grupo. O vencedor tem 7 dias pra me chamar no privado pelo @[seu_usuario] (eu nunca chamo primeiro). Envio pros Correios só no Brasil.

E o Hall da Fama 🏅: todo mês eu agradeço aqui quem mais trouxe gente pro grupo (só reconhecimento, sem prêmio). Pegue seu link com o bot em /convite.

Regulamento completo: [link]. Dúvidas, só perguntar.
```

**Compliance note for this contest:** cultural contests are the exemption under
Lei 5.768/1971, but SPA reportedly reads the exemption narrowly (praise for a
brand, using entries for advertising, or restricting to customers can void it).
Keep it merit-based, free, open (anyone can answer the post), without mentioning
store brands in the judging, and keep the prize cheap. Confirm with a lawyer
before the first run. Never run a random draw ("sorteio") or a "prize for most
referrals" until the admin has a CNPJ and an authorization (or a lawyer says
otherwise). See [Compliance notes](#compliance-notes).

**Option B, only with authorization: "Indique e ganhe".** Keep this text in a
drawer; use it only if a lawyer confirms the format or after obtaining SPA
authorization through a company:
```
🎁 Indique e ganhe de [MÊS] (promoção autorizada, Certificado de Autorização SPA/MF nº [número])
Quem trouxer mais amigos que continuarem no grupo por 7 dias ganha um [gadget]. Pegue seu link pessoal com o bot: /convite. Contas falsas ou entradas compradas são desclassificadas. Regulamento: [link]. Sem compra necessária.
```

---

## 5. 30-day launch calendar

Owner: the admin. Daily baseline (not repeated below): ~10 min approving
previews, ~15 min of X replies, answering comments. Times are extra on top.

### Week 1 (Oct 19–25): foundations and measurement

| Day | Action | Time |
|---|---|---|
| Mon | Record the baseline: members in Telegram/WhatsApp, X followers, `/stats 7` screenshot. Create Telegram **named invite links** per source. | 30 min |
| Mon | Decide channel vs group; if channel, migrate (§3.1). Set descriptions and pinned welcome (§4.3, §4.4). | 45 min |
| Tue | WhatsApp: admins-only, description + rules (§4.5). | 15 min |
| Tue | X: new bio (§4.1), pinned post (§4.2), bio link `?src=x`. List 20 big BR tech/gaming accounts to reply to (an X List). | 30 min |
| Wed | Create Instagram, TikTok and YouTube accounts with the same handle, mascot photo, bio link `?src=ig/tt/yt`. | 40 min |
| Wed | Buy the domain; ask the engineer to connect it (§7). | 15 min |
| Thu | Tune approvals: target 8–12/day; review `BLOCKED_WORDS` and `SHOPEE_KEYWORDS` against the niche. | 20 min |
| Sat | Batch-record videos 1, 2, 4, 5 (§4.9). Order 2–3 cheap gadgets for video 3 and the contest. | 2 h |
| Sun | Send Top 10 (✅). Post the first "bug report" thread on X. Weekly review (§6). | 40 min |

### Week 2 (Oct 26–Nov 1): first content push

| Day | Action | Time |
|---|---|---|
| Mon, Wed, Fri, Sun | Publish one video to Reels/TikTok/Shorts each day. | 15 min each |
| Tue | Open the **WhatsApp Channel**; post its link in the group and on the site config. | 20 min |
| Wed | First Telegram + WhatsApp poll ("qual categoria vocês querem mais?"). | 5 min |
| Daily | 1 engagement post on X from §4.8. | 5 min |
| Thu | Reach out to 3 small tech creators / dev communities (Discord, meetups) offering a "parceria": they share the group, you credit them; give each their own named invite link. Respect each community's self-promotion rules. | 45 min |
| Sat | Batch-record 4 more videos, incl. "Desconto real ou fake?" for 11.11. | 2 h |
| Sun | Top 10 + X thread + weekly review. | 40 min |

### Week 3 (Nov 2–8): pre-11.11, start the contest

| Day | Action | Time |
|---|---|---|
| Mon | Announce the **Desafio do Setup** (§4.10) after the lawyer check; pin it. | 20 min |
| Mon–Sun | 4 videos (one about how to spot fake discounts on 11.11). | 1 h total |
| Tue | Prepare the "Guia anti-Black-Fraude" pinned post (how we check prices, what "menor preço em 30 dias" means). | 30 min |
| Thu | Double the X reply habit to 15 replies/day through Black Friday. | +15 min/day |
| Sat | Record 4 Black Friday videos in advance (evergreen: "como saber se o desconto é real"). | 2 h |
| Sun | Top 10 + weekly review: which named link brought most joins? Shift time to it. | 40 min |

### Week 4 (Nov 9–15): 11.11 and contest results

| Day | Action | Time |
|---|---|---|
| Mon–Tue | Set `POSTS_PER_RUN` higher / run `/buscar` more often on 11.11 (Wed); approve only real drops. | +20 min |
| Wed 11.11 | "Top 5 do 11.11" post at 12h and 19h in Telegram/WhatsApp; video 5 format. | 45 min |
| Thu | Push the Black Friday invite message (§4.6) to members: "manda pra quem vai comprar na Black". | 10 min |
| Sat | Announce contest winner, repost their setup (with permission), ship the prize. Hall da Fama of referrers. | 30 min |
| Sun | 30-day review against targets (§6); pick the top 2 channels for days 31–60. | 1 h |

**Days 31–45 (to Black Friday, Nov 27):** daily video during BF week, pinned
anti-Black-Fraude guide, two "Top 5 de hoje" posts on Nov 27 and 30, cap at ~20
deals/day, and ask every new member to forward the invite.

---

## 6. KPIs and measurement

### Targets

These assume a near-zero start and the time budget above. They are planning
numbers, not promises; the spread depends mostly on whether a few videos take
off. Replace with your own after recording the baseline on day 1.

| Metric | Day 30 | Day 60 (post-BF) | Day 90 |
|---|---|---|---|
| Telegram members (channel + group) | 300 | 1,000 | 1,800 |
| WhatsApp (group + channel) | 150 | 500 | 900 |
| X followers | 200 | 450 | 700 |
| Short-video followers (sum IG+TT+YT) | 300 | 1,200 | 2,500 |
| Site visits/day (avg) | 30 | 120 | 150 |
| Tracked clicks/day (non-bot, all channels) | 40 | 200 (BF peak higher) | 200 |
| Telegram daily CTR (unique clicks/day ÷ members) | 8% | 8% | 7% |
| Clicks per post (Telegram) | 3 | 10 | 15 |
| 7-day join→stay rate (Telegram, from named links) | 85% | 85% | 85% |

### How to read them

**`/stats 7` (and `/stats 30`) from the bot**
- **Cliques por canal:** `telegram`, `whatsapp`, `x`, `web`. "pessoas" is unique
  hashed IPs, a decent proxy for people. Rising `web` with flat `x` means bio links
  (X/IG/TikTok) are working; the X number counts only the link replies.
- **Por grupo:** one line per Telegram group/channel id (and per WhatsApp/X
  target). Use it to compare the old group vs the channel during migration.
  After [§7 item 1](#7-product-changes-for-the-engineer) it will also split `web`
  by `?src=`.
- **Por loja:** clicks per post per store. If Amazon/Mercado Livre get 2× Shopee
  per post, send more manual links from them.
- **Melhores horários:** move video posting and the WhatsApp "best of" to the
  top 2 hours.
- **Top produtos:** feed for videos and the Sunday X thread.
- **X spend:** keep under US$ 10; if there is headroom by the 20th, add link
  replies on strong deals.

**Daily CTR** = unique Telegram clicks in a day ÷ Telegram members. Falling CTR
while members grow means quality or volume is off (approve fewer).

**Native analytics**
- **Telegram:** named invite links → "joined" count per link (weekly). Channels
  with enough subscribers also show Statistics (views per post, growth, mutes).
- **WhatsApp:** group member count; Channel insights (followers, reach) in the
  channel info screen, where available.
- **X:** Analytics (impressions, profile visits, link clicks on the pinned post,
  follows). Watch **profile visits → follows** and impressions per reply.
- **IG/TikTok/YouTube:** 3-second hold rate, average watch %, shares, profile
  visits, bio link taps. A video with >60% watch on a 20s clip is worth a remake.
- **Shopee affiliate report:** conversions per sub-id (= post `ref`); monthly.

### Weekly review ritual (Sundays, right after sending the Top 10, ~20 min)

1. Send `/stats 7`; copy the 6 key numbers into a sheet (members TG/WA, X
   followers, clicks/day, web clicks, top store).
2. Open Telegram invite links: joins per source this week. **Which source won?**
3. Look at the top 3 videos by shares: what was the hook? Make 2 variations next week.
4. Look at `Top produtos`: adjust `SHOPEE_KEYWORDS`/`BLOCKED_WORDS` and which
   manual Amazon/ML links to hunt.
5. Pick **one** thing to stop and **one** to double next week. Write it down.

---

## 7. Product changes for the engineer

Ranked by impact ÷ effort. Effort: S (≤ half a day), M (1–2 days), L (3+ days).
All respect CLAUDE.md: no `node:*` in Worker code, SQL only in `src/repo.ts`,
append-only migrations, affiliate links never rewritten, new Worker settings in
`WORKER_KEYS`.

### 1. Source attribution on the site (`?src=`) + page-view counts. **Impact high, effort S**
- **What:** read `?src=` on `/` and `/ofertas`, normalize it against an allow-list
  (`x, ig, tt, yt, tg, wa, share, google`; anything else → `other`, missing →
  `''`). Use it as the `target` of the deal's `web` link (the `links` table already
  has `target`), so `/stats` "Por grupo" shows `web x`, `web ig`, etc. Also count
  page views per day per source in a small table (one upsert per request).
  Add a "Site" block to `/stats`: visits per source and clicks ÷ visits.
- **Why:** today every bio link is one "web" bucket; the admin can't tell which
  platform brings buyers. Visits are not counted at all.
- **Expected effect:** lets the weekly review move time to the best source;
  enables the CTR KPI for the site.
- **Where:** `src/http.ts` (route), `src/site.ts` (pass source; keep `<link
  rel=canonical>` without the parameter), `src/repo.ts` (`siteDeals` currently
  joins `l.target = ''`; parameterize it; new `recordPageView`), new migration,
  `formatStats` in `src/bot.ts`. Skip bots with the existing `BOT_UA`.
- **Accept when:** `/?src=x` clicks appear as `web x` in `/stats`; `?src=<junk>`
  never creates more than one extra link per post (`other`); canonical unchanged;
  page views per source visible in `/stats`; unit test for the allow-list.

### 2. Telegram join tracking per invite link. **Impact high, effort M**
- **What:** add `"chat_member"` (and `"chat_join_request"` if ever used) to
  `allowed_updates` in `src/jobs/set-webhook.ts` (today it's only `message` and
  `callback_query`). Handle `chat_member` updates in `src/bot.ts`: when status
  goes to `member`, store `(chat_id, invite_link.name, joined_at)`; when it goes to
  `left`/`kicked`, mark the leave. Store the Telegram user id only as a salted hash
  (like `ip_hash`). Add `/convites` to create named links via `createChatInviteLink`
  (`name` ≤ 32 chars) and a "Entradas" block in `/stats`: joins, leaves and 7-day
  retention per link name.
- **Why:** joins are the north-star metric; Telegram's app shows joins per link but
  not leaves or retention, and not next to clicks.
- **Expected effect:** the admin sees which source brings members who *stay*.
- **Where:** `src/jobs/set-webhook.ts`, `src/bot.ts`, `src/telegram.ts`,
  `src/repo.ts`, new migration, docs/ARCHITECTURE.md (new table + update type).
- **Accept when:** joining via a named link records the name; leaving records the
  leave; `/stats 7` shows per-link joins/leaves/retention; works for the channel
  too (bot is admin); no raw user ids stored.

### 3. Site conversion: sticky join CTA, share buttons, honest price badge. **Impact medium-high, effort S**
- **What:** (a) a sticky bottom bar on mobile "📲 Receba as ofertas no Telegram"
  (and WhatsApp) after the first screen; (b) on each card, small "Enviar pra um
  amigo" links (WhatsApp `wa.me/?text=` and Telegram `t.me/share/url`) pointing to
  the site with `?src=share`, never to the affiliate link; (c) a badge
  "📉 Menor preço que vimos em 30 dias" when `price_cents <= lowest_seen_cents`
  (data already on `posts`); (d) a one-line "Por que confiar" strip under
  the header ("checamos o histórico de preço; oferta esgotada sai do site"); ended
  deals are already filtered out by `siteDeals` (`deal_ended_at IS NULL`). Still
  no scripts needed.
- **Why:** the site is the landing page for every "link na bio"; joining is the
  conversion that compounds. The badge makes the main differentiator visible.
- **Expected effect:** higher visit → join rate; more organic forwards.
- **Where:** `src/site.ts`, `src/repo.ts` (`siteDeals` returns `lowest_seen_cents`).
- **Accept when:** CTA visible on 375px width without covering the "Ver oferta"
  button; share links contain `?src=share` and no affiliate URL; badge appears only
  when the condition holds; wording never says "menor preço do Brasil".

### 4. Member referral links + monthly ranking (recognition). **Impact high, effort M (after #2)**
- **What:** members DM the bot `/convite` (private chat) and get a personal
  invite link (`createChatInviteLink`, name `ref:<short id>`), reused if it exists.
  `/ranking` (admin) lists net joins per referrer for the month, counting only
  joiners still in the group after 7 days. Optional opt-in: the bot posts a monthly
  "Hall da Fama" preview for the admin to approve (✅ like the roundup), showing
  first names only.
- **Why:** member-get-member is the cheapest acquisition loop in group communities,
  and recognition is legally safe (see compliance notes; no automatic prizes).
- **Expected effect:** +10–20% monthly joins from members (estimate).
- **Where:** `src/bot.ts` (commands, private chat only), `src/telegram.ts`,
  `src/repo.ts`, migration (referrers table: hashed user id, display name, link),
  reuse the roundup approval pattern from `src/roundup.ts`.
- **Accept when:** a member gets the same link on repeat `/convite`; joins that
  leave within 7 days don't count; nothing is posted publicly without admin ✅;
  handles the bot-not-admin error with a clear message.

### 5. Custom domain + SEO surface: sitemap, deal pages with price history, category pages. **Impact medium (compounding after 90 days), effort M–L**
- **What:**
  - Custom domain as a Worker custom domain; `PUBLIC_BASE_URL` → new domain;
    keep the `workers.dev` host serving `/go/*` (old posts) and 301 the HTML pages
    to the new domain.
  - `/oferta/:id-:slug`: per-deal page with photo, prices, the joke, store,
    **price history chart from `price_snapshots`** (server-rendered inline SVG),
    "Ver oferta" via the `web` link, and the join CTA. After it ends: keep the
    page with "Encerrada" and the history (useful for "histórico de preço"
    searches), mark `availability: OutOfStock`.
  - `/categoria/:slug` for 6–10 niche categories (SSD/armazenamento, periféricos,
    monitores, games, áudio, setup/mesa), mapped from keywords/title rules.
  - `sitemap.xml` (home, categories, deal pages of the last 90 days) and list it
    in `robots.txt`.
  - JSON-LD `Product` with `offers` (price in BRL, `priceCurrency`,
    `availability`) on deal pages, aiming at product snippets; per-page
    `og:image` = product photo, `og:title` = product + price.
- **Why:** long-tail, evergreen searches ("histórico de preço X", "SSD NVMe
  barato") are winnable; price history is unique content we already have.
- **Expected effect:** slow; meaningful organic visits after ~3 months.
- **Where:** `src/http.ts` (routes), `src/site.ts` (templates), `src/repo.ts`
  (queries), `public/` (nothing new), `wrangler.toml` (custom domain route),
  `ROBOTS_TXT`, docs/ARCHITECTURE.md (routes table).
- **Accept when:** sitemap validates; Rich Results Test passes for a deal page;
  canonical URLs on the new domain; old `/go/` links still redirect; no prices
  written by the AI (render from data); ended deals show clearly as ended.

### 6. Keyword alerts by bot DM. **Impact medium (retention), effort M**
- **What:** in a private chat, `/alerta ssd 1tb` saves a keyword (max 5 per
  user); `/alertas` lists, `/parar` removes all. When a post is published, DM
  matching subscribers once with the Telegram rendering and a new `telegram-dm`
  link (or the channel's link with target `dm`). Respect Telegram rate limits
  (queue sends; ~25 msgs/s max).
- **Why:** gives people a reason to start the bot (which also enables
  `/convite`), and retains people who mute the feed.
- **Where:** `src/bot.ts`, `src/publish.ts` (after a successful publish, outside
  the idempotent gate so a retry doesn't re-alert: record alert deliveries),
  `src/repo.ts`, migration.
- **Accept when:** no duplicate DMs on retry; `/parar` works; blocked bots
  (403) remove the subscriber; clicks show under their own target in `/stats`.

### 7. Weekly poll automation. **Impact medium-low, effort S**
- **What:** Wednesday 19h cron proposes a poll to the admin (question from a
  rotating list in config or the top categories of the week); ✅ sends it with
  `sendPoll` to every Telegram destination. Store the results when the poll
  closes (`poll` updates) and show the winner in the admin chat.
- **Why:** cheap weekly engagement; tells the admin what to search for.
- **Where:** `src/http.ts` (new cron; add it to the cron test in
  `test/unit.test.ts`), `wrangler.toml`, `src/bot.ts`, `src/telegram.ts`.
- **Accept when:** nothing goes out without ✅; cron accepted by Cloudflare (the
  existing test passes).

### 8. Branded image cards from real product photos. **Impact medium, effort L**
- **What:** generate a 1080×1080 (Telegram/IG) and 1200×675 (X) card: the real
  product photo, price, old price, % off, store, small mascot + "Dev das Promos"
  frame, "#publi". Generate in GitHub Actions (Node) at preview time, not in the
  Worker (free plan CPU limits make image rendering there impractical), store in
  R2 (free tier) or reuse Telegram `file_id`; X uses it in thread mode instead of
  the raw photo.
- **Why:** recognizable posts in X and IG feeds; screenshots of posts carry the brand.
- **Where:** new `src/card.ts` (Node only, used by `src/collect.ts`),
  `src/publishers/x.ts`, `src/publish.ts`, storage config in `src/config.ts`
  (+ `WORKER_KEYS` if the Worker needs the bucket).
- **Accept when:** the product photo is never altered beyond resizing/cropping;
  price on the card comes from the same data `render.ts` uses; falls back to the
  raw photo on any error; X cost unchanged.

### 9. X within budget: weekly Top 3 thread + link-mode A/B test. **Impact medium-low, effort S**
- **What:** (a) Sunday, after the roundup is approved, offer "🐦 Thread no X"
  posting the Top 3 as a 4-post thread (~US$ 0.06 + one link reply US$ 0.20)
  if the monthly budget allows; (b) support an A/B schedule for 2 weeks: on even
  days, the first deal uses `link` mode (link in the post, one call, US$ 0.20)
  instead of post + link reply (US$ 0.215), tagged so `/stats` can compare `x`
  clicks per mode; admin compares impressions in X Analytics.
- **Why:** the link-penalty claim is disputed in 2026; the test settles it with
  our own data at no extra cost.
- **Where:** `src/publish.ts` (X thread rules), `src/roundup.ts`,
  `src/publishers/x.ts`, `src/bot.ts` (`formatStats`).
- **Accept when:** budget cap respected; thread never posts without admin ✅; A/B
  results visible in `/stats`.

### 10. Small copy items in renders. **Impact low-medium, effort S**
- Telegram/WhatsApp: add "📉 menor preço que vimos em 30 dias" line when true
  (same rule as #3) in `src/render.ts`. Weekly Top 10: add the forward/invite
  line from §4.7 in `src/roundup.ts`, using a new `INVITE_URL` setting (add to
  `.env.example`, `src/config.ts`, `WORKER_KEYS`).
- **Accept when:** the line only appears when the data proves it; the AI caption is
  untouched; tests for both cases.

**Not recommended:** automated WhatsApp gateways on the main number, auto-follow
or auto-reply on X, scraping member lists, adding UTM parameters to affiliate links
(they must stay byte-for-byte), automated prize draws.

---

## 8. Owner checklist

Steps only the admin can do. P1 = this week, P2 = this month, P3 = later.

1. **Record the baseline** (members, followers, `/stats 7`) in a sheet. 10 min, P1.
2. **Create Telegram named invite links** per source and replace the single link
   everywhere (site config, bios, pinned posts). 20 min, P1.
3. **Decide channel vs group; if channel, migrate** (§3.1) and update
   `TELEGRAM_GROUP_IDS` + `SITE_TELEGRAM_URL` in GitHub settings, then redeploy.
   45 min, P1.
4. **Paste descriptions and pinned messages** (§4.3–4.5); set admins-only
   posting, hide members / anti-spam where available. 30 min, P1.
5. **Update X**: bio, website `?src=x`, pinned post, create a private List of 20
   tech accounts to reply to. 30 min, P1.
6. **Create Instagram, TikTok, YouTube** with the same name, mascot avatar, bio
   link with `?src=`. 40 min, P1.
7. **Buy the domain** at registro.br (or Cloudflare Registrar) and give the
   engineer access to set it up. 15 min + ~R$ 40/year, P1.
8. **Tighten approvals:** 8–12 deals/day; update `SHOPEE_KEYWORDS`/`BLOCKED_WORDS`.
   20 min, P1.
9. **Batch-record the first 4 videos** (§4.9) and order 2–3 cheap gadgets for
   unboxing/contest prize. 2 h + ~R$ 100, P1.
10. **Daily X replies** (5–10, then 15 during November) and one engagement post.
    15–20 min/day, P1 (ongoing).
11. **Open the WhatsApp Channel** and add its link to the site config. 20 min, P2.
12. **Lawyer check on the contest format** before announcing it; write a short
    regulamento page (can be a pinned message or a page on the site). 1 h + fee, P2.
13. **Partnership outreach**: 3 small tech creators / dev communities per week,
    each with its own named invite link; follow their self-promotion rules. 45 min/week, P2.
14. **Send manual Amazon/Mercado Livre links** for the best niche deals (the bot
    can't search them yet), especially for Black Friday. 15 min/day in November, P2.
15. **Prepare Black Friday assets**: anti-Black-Fraude guide, invite message,
    4 evergreen videos. 2 h, P2 (before Nov 20).
16. **Weekly review ritual** every Sunday (§6). 20 min/week, P2 (ongoing).
17. **Register Google Search Console + Bing Webmaster** after the domain is live;
    submit the sitemap when the engineer ships it. 20 min, P3.
18. **Push Amazon toward Creators API eligibility** (sales from manual links count)
    so Amazon search can be automated. Ongoing, P3.
19. **Consider a CNPJ (MEI may or may not fit affiliate activity; ask an
    accountant)** if prizes, sponsorships or authorized promotions become part of the
    plan. 1 h research, P3.

---

## Sources and confidence

- X ranking and links: [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm)
  (primary, partially redacted); [OpenTweet on 2026 algorithm changes](https://opentweet.io/x-algorithm-changes)
  (reports Musk/Bier statements, July 2026, and a 28k-post observational study);
  [SocialPilot](https://socialpilot.co/blog/twitter-algorithm) (marketing blog,
  still claims a link penalty). **Medium confidence**; hence the A/B test.
- Telegram invite links (`createChatInviteLink`, `name` ≤ 32 chars,
  `member_limit` / `creates_join_request`): [python-telegram-bot docs](https://docs.python-telegram-bot.org/telegram.chatinvitelink.html),
  [aiogram ChatInviteLink](https://docs.aiogram.dev/en/latest/_modules/aiogram/types/chat_invite_link.html).
  `chat_member` updates must be requested explicitly in `allowed_updates` (Bot API
  docs); **high confidence**, engineer to confirm on the live bot.
- WhatsApp Channels and group cap: [Messengerbot](https://messengerbot.app/hi/whatsapp-channels-2026-what-they-are-and-how-to-use-them/),
  [WABetaInfo](https://wabetainfo.com/whatsapp-is-rolling-out-the-fifa-world-cup-2026-hub-for-channels/).
  **Medium confidence** on feature details; check in the app.
- Google product snippets vs merchant listings: [Google Search Central blog](https://developers.google.com/search/blog/2022/09/merchant-listings).
  How Google treats affiliate deal pages specifically is my inference.
- CONAR disclosure: [CONAR influencer guide (2020)](https://static.poder360.com.br/2020/12/Guia-influenciadores.pdf),
  [Propmark](https://propmark.com.br/?p=125124). The 2026 update is unverified.
- Prize promotions: [Migalhas](https://www.migalhas.com.br/depeso/347817/influenciadores-e-os-sorteios-nas-redes-sociais),
  [Visu regulamento tool summarizing SPA pages](https://visu.network/br/ferramentas/regulamento-de-sorteio/).
  **Not legal advice**; get a lawyer's opinion before any prize.
- KPI targets are planning estimates from experience with small niche
  communities, not benchmarks from a study.
