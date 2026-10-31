import { Markup } from "telegraf";

/**
 * Inline-keyboard builders — all navigation happens through callback data:
 *
 *   pg:<t|n|a>:<page>   paginate trending / new / artists
 *   ad:<artistId>       artist detail
 *   f:<artistId>        follow artist        u:<artistId>  unfollow artist
 *   prefs:menu|nr|pr    settings screens and toggles
 *   prefs:nr0           mute new releases (button on notifications)
 *   home                back to the main menu
 *   adm:bc:<token>      confirm admin broadcast (single use)
 *   noop                decorative button
 *
 * web_app buttons are only allowed in private chats — every builder that
 * includes one checks chat type and degrades to a plain URL button.
 */

const MAX_CB = 64; // Telegram callback_data limit

type KbBtn =
  | ReturnType<(typeof Markup.button)["callback"]>
  | ReturnType<(typeof Markup.button)["webApp"]>
  | ReturnType<(typeof Markup.button)["url"]>;

export function cbArtist(id: string): string {
  return `ad:${id}`.slice(0, MAX_CB);
}
export function cbFollow(id: string): string {
  return `f:${id}`.slice(0, MAX_CB);
}
export function cbUnfollow(id: string): string {
  return `u:${id}`.slice(0, MAX_CB);
}
export function cbPage(kind: "t" | "n" | "a", page: number): string {
  return `pg:${kind}:${page}`.slice(0, MAX_CB);
}

type CtxLike = { chat?: { type: string } | undefined };

function openAppRow(tmaUrl: string, ctx?: CtxLike): KbBtn[] {
  if (ctx?.chat && ctx.chat.type !== "private") {
    return [Markup.button.url("🌐 Open Web Player", tmaUrl)];
  }
  return [Markup.button.webApp("🎵 Open Music App", tmaUrl)];
}

/** Main menu attached to /start and most replies. */
export function mainMenuKb(tmaUrl: string, ctx?: CtxLike) {
  return Markup.inlineKeyboard([
    openAppRow(tmaUrl, ctx),
    [
      Markup.button.callback("🔥 Trending", cbPage("t", 0)),
      Markup.button.callback("🆕 New", cbPage("n", 0)),
    ],
    [
      Markup.button.callback("🎤 Artists", cbPage("a", 0)),
      Markup.button.callback("🔔 My settings", "prefs:menu"),
    ],
  ]);
}

/** Pager row for trending / new / artists lists. */
export function pagerKb(kind: "t" | "n" | "a", page: number, hasMore: boolean) {
  const nav: KbBtn[] = [];
  if (page > 0) nav.push(Markup.button.callback("⬅️ Prev", cbPage(kind, page - 1)));
  if (hasMore) nav.push(Markup.button.callback("Next ➡️", cbPage(kind, page + 1)));
  const rows: KbBtn[][] = [];
  if (nav.length > 0) rows.push(nav);
  rows.push([Markup.button.callback("🏠 Main menu", "home")]);
  return Markup.inlineKeyboard(rows);
}

/** Artist detail: follow toggle + open in app + back to list. */
export function artistKb(
  artistId: string,
  following: boolean,
  tmaUrl: string,
  ctx?: CtxLike,
) {
  const followRow: KbBtn[] = [
    following
      ? Markup.button.callback("🔔 Following ✓ (tap to unfollow)", cbUnfollow(artistId))
      : Markup.button.callback("🔔 Follow artist", cbFollow(artistId)),
  ];
  return Markup.inlineKeyboard([
    followRow,
    openAppRow(tmaUrl, ctx),
    [Markup.button.callback("⬅️ Back to artists", cbPage("a", 0))],
  ]);
}

/** Buttons attached to new-release notifications. */
export function releaseKb(opts: {
  artistId: string;
  following: boolean;
  tmaUrl: string;
}) {
  const rows: KbBtn[][] = [
    [Markup.button.webApp("▶️ Play in App", opts.tmaUrl)],
  ];
  if (!opts.following) {
    rows.push([Markup.button.callback("🔔 Follow this artist", cbFollow(opts.artistId))]);
  }
  rows.push([Markup.button.callback("🔕 Mute new releases", "prefs:nr0")]);
  return Markup.inlineKeyboard(rows);
}

/** /settings — toggle notification preferences. */
export function settingsKb(prefs: { notify_new_releases: boolean; notify_premium: boolean }) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        `New releases: ${prefs.notify_new_releases ? "✅ ON" : "❌ OFF"}`,
        "prefs:nr",
      ),
    ],
    [
      Markup.button.callback(
        `Premium alerts: ${prefs.notify_premium ? "✅ ON" : "❌ OFF"}`,
        "prefs:pr",
      ),
    ],
    [Markup.button.callback("⬅️ Back to main menu", "home")],
  ]);
}

/** Admin broadcast confirmation. */
export function broadcastConfirmKb(token: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Send it", `adm:bc:${token}`),
      Markup.button.callback("❌ Cancel", "adm:bc:no"),
    ],
  ]);
}
