"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { getDisplayUser, getRawInitData, type TgUser } from "./telegram";

/* ─────────────────────────────────────────────────────────────────────────────
 * Authentication
 *
 * Flow (when running inside Telegram):
 *   1. Client reads the RAW `WebApp.initData` (signed by Telegram).
 *   2. Client POSTs it to  POST {SUPABASE_URL}/functions/v1/telegram-auth
 *   3. The edge function verifies the HMAC-SHA256 signature with the bot
 *      token, upserts an auth user and mints a Supabase session.
 *   4. Client stores the session via supabase.auth.setSession().
 *
 * The client NEVER derives identity from `initDataUnsafe`.
 *
 * ⚠️ BACKEND REQUIRED: the edge function must be deployed
 *    (`supabase functions deploy telegram-auth`). Until then the app runs
 *    in GUEST MODE — browsing works; writes show a "requires backend"
 *    notice instead of pretending to succeed.
 * ───────────────────────────────────────────────────────────────────────────── */

export type AuthStatus = "loading" | "guest" | "authenticated";
export type AuthErrorKind = "backend_missing" | "auth_rejected" | "network" | null;

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  tgUser: TgUser | null; // display only
  errorKind: AuthErrorKind;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  status: "loading",
  session: null,
  tgUser: null,
  errorKind: null,
  signIn: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [errorKind, setErrorKind] = useState<AuthErrorKind>(null);
  const tgUser = useMemo(() => getDisplayUser(), []);

  useEffect(() => {
    let alive = true;

    (async () => {
      const supabase = getSupabase();

      // 1. existing persisted session?
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      if (data.session) {
        setSession(data.session);
        setStatus("authenticated");
        return;
      }

      // 2. inside Telegram → exchange raw initData for a session
      const initData = getRawInitData();
      if (!initData) {
        setStatus("guest"); // plain browser or Telegram without payload
        return;
      }
      setStatus("loading");
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/telegram-auth`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
          },
          body: JSON.stringify({ initData }),
        });
        if (!alive) return;
        if (res.status === 404) {
          setErrorKind("backend_missing");
          setStatus("guest");
          return;
        }
        if (!res.ok) {
          setErrorKind("auth_rejected");
          setStatus("guest");
          return;
        }
        const payload = (await res.json()) as {
          session?: { access_token: string; refresh_token: string };
        };
        if (!payload.session?.access_token) {
          setErrorKind("auth_rejected");
          setStatus("guest");
          return;
        }
        const { data: setData, error: setErr } = await supabase.auth.setSession({
          access_token: payload.session.access_token,
          refresh_token: payload.session.refresh_token,
        });
        if (!alive) return;
        if (setErr || !setData.session) {
          setErrorKind("auth_rejected");
          setStatus("guest");
          return;
        }
        setSession(setData.session);
        setStatus("authenticated");
      } catch {
        if (alive) {
          setErrorKind("network");
          setStatus("guest");
        }
      }
    })();

    // 3. keep in sync with token refresh / sign-out events
    const { data: sub } = getSupabase().auth.onAuthStateChange((_event, s) => {
      if (!alive) return;
      setSession(s);
      setStatus(s ? "authenticated" : "guest");
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async () => {
    setErrorKind(null);
    setStatus("loading");
    const initData = getRawInitData();
    if (!initData) {
      setErrorKind("network"); // opened outside Telegram
      setStatus("guest");
      return;
    }
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/telegram-auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
        },
        body: JSON.stringify({ initData }),
      });
      if (res.status === 404) {
        setErrorKind("backend_missing");
        setStatus("guest");
        return;
      }
      if (!res.ok) {
        setErrorKind("auth_rejected");
        setStatus("guest");
        return;
      }
      const payload = (await res.json()) as {
        session?: { access_token: string; refresh_token: string };
      };
      if (!payload.session) {
        setErrorKind("auth_rejected");
        setStatus("guest");
        return;
      }
      const { data: setData, error } = await getSupabase().auth.setSession({
        access_token: payload.session.access_token,
        refresh_token: payload.session.refresh_token,
      });
      if (error || !setData.session) {
        setErrorKind("auth_rejected");
        setStatus("guest");
        return;
      }
      setSession(setData.session);
      setStatus("authenticated");
    } catch {
      setErrorKind("network");
      setStatus("guest");
    }
  }, []);

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    setSession(null);
    setStatus("guest");
  }, []);

  return (
    <AuthContext.Provider value={{ status, session, tgUser, errorKind, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
