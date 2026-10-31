import type { CatalogSong, CatalogPlan, CatalogArtist } from "../db/catalog.js";

/**
 * Message formatting helpers. Telegram MarkdownV2 requires escaping
 * _*[]()~`>#+-=|{}.! — we escape EVERYTHING dynamic and add emphasis via
 * wrapper helpers, so malformed-entity errors can never happen from user/
 * catalog data.
 */

const ESC = /[_*[\]()~`>#+\-=|{}.!]/g;

export function esc(s: string): string {
  return s.replace(ESC, "\\$&");
}

export function bold(s: string): string {
  return `*${esc(s)}*`;
}

export function code(s: string): string {
  return "`" + s + "`";
}

export function link(text: string, url: string): string {
  return `[${esc(text)}](${url})`;
}

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function songLine(s: CatalogSong, i: number): string {
  const parts = [
    `${i}. ${bold(s.title)}`,
    s.artist?.name ? `— ${esc(s.artist.name)}` : "",
    `${code(fmtDuration(s.duration_seconds))} · ${fmtCount(s.play_count)} plays`,
  ].filter(Boolean);
  return parts.join(" ");
}

export function artistLine(a: CatalogArtist): string {
  const badge = a.verified ? " ✅" : "";
  return `${bold(a.name)}${badge} · ${fmtCount(a.monthly_listeners)} listeners${
    a.region ? ` · ${esc(a.region)}` : ""
  }`;
}

export function planLine(p: CatalogPlan): string {
  const price = p.price_etb === 0 ? "Free" : `${fmtCount(Number(p.price_etb))} ETB`;
  return `${bold(p.name)}${p.name_am ? ` (${esc(p.name_am)})` : ""} — ${price} / ${p.duration_days}d${
    p.description ? `\n  ${esc(p.description)}` : ""
  }`;
}

/**
 * Cover image URL for sendPhoto — only real absolute http(s) URLs qualify;
 * placeholder storage paths fall back to text-only messages.
 */
export function coverUrlOf(s: CatalogSong): string | null {
  const url = s.cover_url;
  if (url && /^https:\/\//i.test(url)) return url;
  return null;
}

export function songDeepLink(songId: string): string {
  return `${process.env.TMA_URL ?? "https://tech-insight21.github.io/ethio-music/"}song?id=${songId}`;
}

export function artistDeepLink(artistId: string): string {
  return `${process.env.TMA_URL ?? "https://tech-insight21.github.io/ethio-music/"}artist?id=${artistId}`;
}
