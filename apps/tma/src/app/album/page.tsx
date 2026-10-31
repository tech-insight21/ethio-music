"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Cover } from "@/components/Cover";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { SongRow } from "@/components/SongRow";
import { EmptyState, ErrorState, LoadingScreen, SkeletonRows } from "@/components/States";
import { usePlayer } from "@/lib/player";
import { useAsyncData, fmtDuration, haptic } from "@/lib/telegram";
import { getAlbumById } from "@/lib/supabase";

export default function AlbumPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AlbumDetails />
    </Suspense>
  );
}

function AlbumDetails() {
  const id = useSearchParams().get("id") ?? "";
  const { playQueue } = usePlayer();
  const album = useAsyncData(() => (id ? getAlbumById(id) : Promise.reject(new Error("Missing album id"))), [id]);

  if (album.loading) return <LoadingScreen label="Loading album…" />;

  if (album.error) {
    return (
      <main className="px-3">
        <PageHeader title="Album" />
        <ErrorState message={(album.error as Error).message} onRetry={album.retry} />
      </main>
    );
  }

  if (!album.data) {
    return (
      <main className="px-3">
        <PageHeader title="Album" />
        <EmptyState icon="💿" title="Album not found" />
      </main>
    );
  }

  const al = album.data;
  const tracks = al.songs ?? [];
  const totalSec = tracks.reduce((acc, t) => acc + t.duration_seconds, 0);
  const year = al.release_date ? String(al.release_date).slice(0, 4) : "";

  return (
    <main className="page-enter px-3">
      <PageHeader title={al.title} subtitle={al.artist?.name} />

      <div className="flex gap-4">
        <Cover seed={al.id} imageUrl={al.cover_url} className="h-36 w-36 shrink-0 shadow-2xl shadow-black/50" rounded="rounded-2xl" icon="album" />
        <div className="flex min-w-0 flex-col justify-end pb-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]">
            {al.album_type ?? "Album"}
          </p>
          <h1 className="mt-0.5 text-xl font-extrabold leading-tight">{al.title}</h1>
          {al.artist && (
            <p className="truncate text-[13px] text-[var(--muted)]">
              {al.artist.name} {year && `· ${year}`}
            </p>
          )}
          <p className="text-[12px] text-[var(--muted)]">
            {tracks.length} tracks · {fmtDuration(totalSec)}
          </p>
        </div>
      </div>

      {al.description && (
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--text)]/80">{al.description}</p>
      )}

      <button
        className="press mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--gold)] py-3 text-[15px] font-bold text-black"
        onClick={() => {
          haptic("medium");
          if (tracks.length > 0) playQueue(tracks, 0);
        }}
        disabled={tracks.length === 0}
      >
        <Icon name="play" className="h-5 w-5" /> Play album
      </button>

      <div className="card mt-4 p-1.5">
        {tracks.length === 0 ? (
          <p className="p-5 text-center text-sm text-[var(--muted)]">No released tracks yet.</p>
        ) : (
          tracks.map((t) => <SongRow key={t.id} song={t} queue={tracks} showIndex showCover={false} />)
        )}
      </div>

      <p className="mt-4 text-center text-[11px] text-[var(--muted)]">
        ℹ️ {al.title} is distributed under a verified license. Royalties flow to the
        rights holder on every play.
      </p>
    </main>
  );
}
