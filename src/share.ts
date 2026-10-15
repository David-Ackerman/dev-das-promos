import type { Config } from "./config.ts";
import { renderInput } from "./preview.ts";
import { shareUrl } from "./publishers/whatsapp.ts";
import { renderWhatsApp, renderX } from "./render.ts";
import type { PostRow } from "./types.ts";
import { escapeHtml } from "./util.ts";

/** Links that open an app with the post already written; the admin just sends it. */
export function whatsappShareUrl(cfg: Config, post: PostRow, link: string): string {
  return shareUrl(renderWhatsApp(renderInput(cfg, post, link)));
}

/** The X post with our tracked link (free when you post it yourself). */
export function xShareText(cfg: Config, post: PostRow, link: string): string {
  return renderX(renderInput(cfg, post, link), link);
}

/**
 * Page behind the 🐦 button. A plain x.com/intent link opens inside Telegram's
 * browser, where nobody is logged in to X, so this page offers: copy the text
 * (works everywhere), open the X app directly, or the website as a last resort.
 */
export function xSharePage(text: string): string {
  const q = encodeURIComponent(text);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Postar no X</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #0f1419; --muted: #536471; --line: #cfd9de; --btn: #0f1419; --btn-fg: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #000; --fg: #e7e9ea; --muted: #71767b; --line: #2f3336; --btn: #eff3f4; --btn-fg: #0f1419; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  main { max-width: 520px; margin: 0 auto; padding: 20px 16px 32px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  textarea { box-sizing: border-box; width: 100%; min-height: 220px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: transparent; color: inherit; font: inherit; resize: vertical; }
  .btn { display: block; box-sizing: border-box; width: 100%; margin-top: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: inherit; font: inherit; font-weight: 700; text-align: center; text-decoration: none; cursor: pointer; }
  .primary { background: var(--btn); color: var(--btn-fg); border-color: var(--btn); }
  p { color: var(--muted); font-size: 14px; margin: 16px 0 0; }
</style>
</head>
<body>
<main>
  <h1>Postar no X</h1>
  <textarea id="t" readonly>${escapeHtml(text)}</textarea>
  <button class="btn primary" id="copy" type="button">📋 Copiar texto</button>
  <a class="btn" href="twitter://post?message=${q}">Abrir no app do X</a>
  <a class="btn" href="https://x.com/intent/post?text=${q}" target="_blank" rel="noopener">Abrir no site do X</a>
  <p>Se o app não abrir com o texto pronto: copie, abra o X e cole.</p>
</main>
<script>
  const t = document.getElementById("t");
  const b = document.getElementById("copy");
  b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(t.value); }
    catch { t.select(); document.execCommand("copy"); }
    b.textContent = "✅ Copiado!";
    setTimeout(() => { b.textContent = "📋 Copiar texto"; }, 2000);
  });
</script>
</body>
</html>`;
}
