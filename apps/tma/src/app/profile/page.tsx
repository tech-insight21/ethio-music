"use client";

import { Cover } from "@/components/Cover";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { BackendNotice } from "@/components/States";
import { useAuth } from "@/lib/auth";
import { useFavorites } from "@/lib/favorites";
import { haptic, hapticNotify } from "@/lib/telegram";
import { getSupabase } from "@/lib/supabase";
import { useState } from "react";

const LANGS: { code: "am" | "om" | "ti" | "en"; label: string; native: string }[] = [
  { code: "am", label: "Amharic", native: "አማርኛ" },
  { code: "om", label: "Oromo", native: "Afaan Oromoo" },
  { code: "ti", label: "Tigrinya", native: "ትግርኛ" },
  { code: "en", label: "English", native: "English" },
];

export default function ProfilePage() {
  const { status, tgUser, session, errorKind, signIn, signOut } = useAuth();
  const { ids } = useFavorites();
  const [lang, setLang] = useState<string | null>(null);
  const [savingLang, setSavingLang] = useState(false);

  const saveLanguage = async (code: "am" | "om" | "ti" | "en") => {
    haptic("light");
    setLang(code);
    if (status !== "authenticated") return; // silently keep local choice; banner explains
    setSavingLang(true);
    try {
      // real DB update (RLS: profiles_update_self)
      const { error } = await getSupabase()
        .from("profiles")
        .update({ language_code: code })
        .eq("id", session!.user.id);
      if (error) throw error;
      hapticNotify("success");
    } catch {
      hapticNotify("error");
    } finally {
      setSavingLang(false);
    }
  };

  return (
    <main className="page-enter px-3">
      <PageHeader title="Profile" back={false} />

      {/* identity card */}
      <div className="card flex items-center gap-4 p-4">
        {tgUser?.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tgUser.photoUrl}
            alt="Your avatar"
            className="h-16 w-16 rounded-full object-cover"
          />
        ) : (
          <Cover seed={tgUser ? `u${tgUser.id}` : "guest"} className="h-16 w-16" rounded="rounded-full" icon="artist" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-extrabold">
            {tgUser?.fullName ?? "Guest listener"}
          </p>
          <p className="truncate text-[12.5px] text-[var(--muted)]">
            {tgUser?.username ? `@${tgUser.username}` : "Not signed in"}
            {tgUser?.isPremium && " · Telegram Premium"}
          </p>
          <p
            className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              status === "authenticated"
                ? "bg-[var(--green)]/15 text-[var(--green)]"
                : "bg-[var(--card-2)] text-[var(--muted)]"
            }`}
          >
            <Icon name={status === "authenticated" ? "check" : "user"} className="h-3 w-3" />
            {status === "authenticated" ? "Signed in via Telegram" : "Guest mode"}
          </p>
        </div>
      </div>

      {/* auth state explanation */}
      {status !== "authenticated" && (
        <div className="mt-4">
          {errorKind === "backend_missing" ? (
            <BackendNotice>
              <p className="font-semibold">Auth backend not deployed yet.</p>
              <p className="mt-1 leading-relaxed">
                Your Telegram identity was received, but session minting requires
                the <code className="text-[var(--gold)]">telegram-auth</code> edge
                function (it verifies the signed initData server-side). Deploy it
                from the repo — then this app signs you in automatically.
              </p>
            </BackendNotice>
          ) : errorKind === "network" ? (
            <BackendNotice>
              Open ETHIO MUSIC from inside Telegram to sign in. Browsing works
              everywhere; account features need the Telegram handshake.
            </BackendNotice>
          ) : (
            <BackendNotice>
              Browsing is fully open. Signing in (via Telegram&apos;s signed
              initData → backend verification) unlocks synced favorites,
              playlists and follows.
            </BackendNotice>
          )}
          <button
            className="press mt-3 w-full rounded-xl border border-[var(--gold)]/40 bg-[var(--gold)]/10 py-2.5 text-[14px] font-bold text-[var(--gold)]"
            onClick={() => void signIn()}
          >
            Connect Telegram account
          </button>
        </div>
      )}

      {/* stats */}
      <div className="card mt-4 grid grid-cols-2 divide-x divide-white/5 p-0 text-center">
        <div className="p-4">
          <p className="text-xl font-extrabold text-[var(--gold)]">{ids.size}</p>
          <p className="text-[11px] text-[var(--muted)]">liked songs</p>
        </div>
        <div className="p-4">
          <p className="text-xl font-extrabold text-[var(--green)]">100%</p>
          <p className="text-[11px] text-[var(--muted)]">licensed plays</p>
        </div>
      </div>

      {/* language preference */}
      <section className="mt-5">
        <p className="mb-2 text-[13px] font-bold text-[var(--muted)]">App language</p>
        <div className="grid grid-cols-2 gap-2">
          {LANGS.map((l) => (
            <button
              key={l.code}
              className={`press card px-3 py-2.5 text-left ${
                lang === l.code ? "ring-1 ring-[var(--gold)]" : ""
              }`}
              onClick={() => void saveLanguage(l.code)}
            >
              <span className="block text-[14px] font-bold">{l.native}</span>
              <span className="block text-[11px] text-[var(--muted)]">{l.label}</span>
            </button>
          ))}
        </div>
        {savingLang && <p className="mt-1.5 text-[11px] text-[var(--muted)]">Saving…</p>}
        {status !== "authenticated" && (
          <p className="mt-1.5 text-[11px] text-[var(--muted)]">
            Language choice is remembered on this device; it syncs to your profile
            after sign-in.
          </p>
        )}
      </section>

      {/* session actions */}
      {status === "authenticated" && (
        <button
          className="press mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--red)]/30 bg-[var(--red)]/10 py-3 text-[14px] font-bold text-[var(--red)]"
          onClick={() => void signOut()}
        >
          <Icon name="logout" className="h-4.5 w-4.5" /> Sign out
        </button>
      )}

      <p className="mt-6 text-center text-[11px] text-[var(--muted)]">
        ETHIO MUSIC v2 · ኢትዮጵያ · built for Telegram
      </p>
    </main>
  );
}
