"use client";

import { SongRow } from "@/components/SongRow";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/States";
import { useAuth } from "@/lib/auth";
import { useFavorites } from "@/lib/favorites";
import { usePlayer } from "@/lib/player";
import { Icon } from "@/components/Icon";
import { haptic } from "@/lib/telegram";

export default function FavoritesPage() {
  const { ids, songs, hydrated } = useFavorites();
  const { status } = useAuth();
  const { playQueue } = usePlayer();

  return (
    <main className="page-enter px-3">
      <PageHeader
        title="Favorites"
        subtitle={status === "authenticated" ? "Synced to your account" : "Saved on this device"}
      />

      {(!hydrated || (ids.size > 0 && songs.length < ids.size)) && (
        <div className="mb-2">
          <SkeletonRows n={Math.min(4, Math.max(1, ids.size))} />
        </div>
      )}

      {hydrated && ids.size === 0 && (
        <EmptyState
          icon="🤍"
          title="No favorites yet"
          body="Tap the heart on any song and it lands here — instantly."
        />
      )}

      {hydrated && songs.length === 0 && ids.size > 0 && (
        <ErrorState
          message="Couldn't load your liked songs. They're still saved — tap retry."
          onRetry={() => window.location.reload()}
        />
      )}

      {songs.length > 0 && (
        <>
          <button
            className="press mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--gold)] py-3 text-[15px] font-bold text-black"
            onClick={() => {
              haptic("medium");
              playQueue(songs, 0);
            }}
          >
            <Icon name="play" className="h-5 w-5" /> Play all ({songs.length})
          </button>
          <div className="card p-1.5">
            {songs.map((s) => (
              <SongRow key={s.id} song={s} queue={songs} />
            ))}
          </div>
          {status !== "authenticated" && (
            <p className="mt-3 text-center text-[11.5px] leading-relaxed text-[var(--muted)]">
              Guest mode: likes live in this device&apos;s storage. Deploy the auth
              backend and they&apos;ll sync to your account automatically.
            </p>
          )}
        </>
      )}
    </main>
  );
}
