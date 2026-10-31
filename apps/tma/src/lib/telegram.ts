"use client";

import { useEffect, useState } from "react";

interface TgWebApp {
  ready: () => void;
  expand: () => void;
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
  };
  themeParams?: Record<string, string>;
  initDataUnsafe?: {
    user?: {
      first_name?: string;
      username?: string;
      language_code?: string;
    };
  };
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TgWebApp };
  }
}

export function useTelegram() {
  const [user, setUser] = useState<{ name: string; lang: string } | null>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.("#0e1621");
    tg.setBackgroundColor?.("#0e1621");
    const u = tg.initDataUnsafe?.user;
    if (u) setUser({ name: u.first_name ?? u.username ?? "ወዳጄ", lang: u.language_code ?? "en" });
  }, []);

  const haptic = (style: "light" | "medium" | "heavy" = "light") => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  };

  return { user, haptic };
}

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function fmtListeners(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
