"use client";

import { useCallback, useEffect, useState } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
 * Telegram Mini App SDK integration.
 *
 * AUTH RULE (non-negotiable): `initDataUnsafe` is NEVER used for
 * authentication — it is only read for cosmetic display (name/avatar).
 * The raw `initData` string is sent to the backend, which verifies its
 * HMAC-SHA256 signature against the bot token (see
 * supabase/functions/telegram-auth). The client cannot forge sessions.
 * ───────────────────────────────────────────────────────────────────────────── */

interface HapticFeedback {
  impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
  notificationOccurred: (type: "error" | "success" | "warning") => void;
  selectionChanged: () => void;
}
interface BackButton {
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}
interface MainButton {
  setText: (t: string) => void;
  show: () => void;
  hide: () => void;
  enable: () => void;
  disable: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
  setParams: (p: { color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }) => void;
}

interface TgWebApp {
  initData: string; // RAW signed payload — the ONLY source for auth
  initDataUnsafe?: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
      language_code?: string;
      is_premium?: boolean;
    };
  };
  version: string;
  colorScheme: "light" | "dark";
  viewportStableHeight: number;
  ready: () => void;
  expand: () => void;
  close: () => void;
  enableClosingConfirmation?: () => void;
  isVersionAtLeast: (v: string) => boolean;
  openLink: (url: string, opts?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  HapticFeedback?: HapticFeedback;
  BackButton?: BackButton;
  MainButton?: MainButton;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  onEvent: (e: string, cb: () => void) => void;
  offEvent: (e: string, cb: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TgWebApp };
  }
}

export interface TgUser {
  id: number;
  firstName: string;
  fullName: string;
  username: string | null;
  photoUrl: string | null;
  languageCode: string;
  isPremium: boolean;
}

export function getWebApp(): TgWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

/** True when running inside a real Telegram client. */
export function isInTelegram(): boolean {
  const tg = getWebApp();
  return Boolean(tg && tg.initData && tg.initData.length > 0);
}

/** Display-only Telegram user (from initDataUnsafe — NOT for auth). */
export function getDisplayUser(): TgUser | null {
  const u = getWebApp()?.initDataUnsafe?.user;
  if (!u) return null;
  return {
    id: u.id,
    firstName: u.first_name ?? "Listener",
    fullName: [u.first_name, u.last_name].filter(Boolean).join(" "),
    username: u.username ?? null,
    photoUrl: u.photo_url ?? null,
    languageCode: u.language_code ?? "en",
    isPremium: Boolean(u.is_premium),
  };
}

/** Raw signed initData payload for the backend. Empty string outside Telegram. */
export function getRawInitData(): string {
  return getWebApp()?.initData ?? "";
}

export function haptic(style: "light" | "medium" | "heavy" | "rigid" | "soft" = "light") {
  try {
    getWebApp()?.HapticFeedback?.impactOccurred(style);
  } catch {
    /* no-op outside Telegram */
  }
}

export function hapticNotify(type: "error" | "success" | "warning") {
  try {
    getWebApp()?.HapticFeedback?.notificationOccurred(type);
  } catch {
    /* no-op */
  }
}

/** App bootstrap: tell Telegram we're ready, expand, theme the chrome. */
export function useTelegramInit() {
  useEffect(() => {
    const tg = getWebApp();
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      tg.setHeaderColor?.("#0b111b");
      tg.setBackgroundColor?.("#0b111b");
    } catch {
      /* older clients */
    }
    const setVh = () => {
      document.documentElement.style.setProperty(
        "--vh",
        `${tg.viewportStableHeight / 100 || window.innerHeight / 100}`
      );
    };
    setVh();
    tg.onEvent("viewportChanged", setVh);
    return () => tg.offEvent("viewportChanged", setVh);
  }, []);
}

/** Telegram BackButton bound to the browser history. */
export function useTelegramBackButton(active: boolean) {
  useEffect(() => {
    const tg = getWebApp();
    if (!tg?.BackButton) return;
    if (!active) {
      tg.BackButton.hide();
      return;
    }
    const onClick = () => window.history.back();
    tg.BackButton.show();
    tg.BackButton.onClick(onClick);
    return () => {
      tg.BackButton?.offClick(onClick);
      tg.BackButton?.hide();
    };
  }, [active]);
}

export function openShare(songTitle: string, url: string) {
  const tg = getWebApp();
  const link = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(
    `🎧 ${songTitle} — on ETHIO MUSIC`
  )}`;
  if (tg) tg.openTelegramLink(link);
  else if (typeof window !== "undefined") window.open(link, "_blank");
}

/* ── formatting helpers ─────────────────────────────────────────────── */

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

/** Small polling data hook with loading / error / retry. */
export function useAsyncData<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const retry = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, retry };
}
