"use client";

import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { BackendNotice, EmptyState } from "@/components/States";
import { useAuth } from "@/lib/auth";
import { useFavorites } from "@/lib/favorites";
import { haptic } from "@/lib/telegram";

const TILES = [
  { href: "/favorites/", label: "Favorites", icon: "heart" as const, accent: "var(--red)", desc: "Songs you loved" },
  { href: "/playlists/", label: "Playlists", icon: "list" as const, accent: "var(--gold)", desc: "Your mixes" },
];

export default function LibraryPage() {
  const { status } = useAuth();
  const { ids } = useFavorites();

  return (
    <main className="page-enter px-3">
      <PageHeader title="My Library" back={false} />

      <div className="grid grid-cols-2 gap-3">
        {TILES.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="press card flex flex-col gap-2 p-4"
            onClick={() => haptic("light")}
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ background: "var(--card-2)", color: t.accent }}
            >
              <Icon name={t.icon} className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[15px] font-bold">{t.label}</span>
              <span className="block text-[12px] text-[var(--muted)]">{t.desc}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* quick stats — real local data */}
      <div className="card mt-4 p-4">
        <p className="text-[13px] font-bold text-[var(--muted)]">On this device</p>
        <div className="mt-2 flex items-center gap-4">
          <div>
            <p className="text-xl font-extrabold text-[var(--gold)]">{ids.size}</p>
            <p className="text-[11px] text-[var(--muted)]">liked songs</p>
          </div>
        </div>
      </div>

      {status !== "authenticated" && (
        <div className="mt-4">
          <BackendNotice>
            Cross-device playlists, follow lists and listening history sync need
            sign-in. The Telegram auth backend
            (<code className="text-[var(--gold)]">supabase/functions/telegram-auth</code>)
            ships in this repo — deploy it with
            <code className="mx-1 text-[var(--gold)]">supabase functions deploy telegram-auth</code>
            to enable these features. Until then favorites are saved on this device only.
          </BackendNotice>
        </div>
      )}

      <div className="mt-6">
        <EmptyState
          icon="📚"
          title="More coming to your library"
          body="Offline downloads and listening history arrive with the subscription milestone."
        />
      </div>
    </main>
  );
}
