"use client";

import { Song, Artist } from "@/lib/supabase";
import { SongRow } from "../SongRow";

interface HomeViewProps {
  userName: string | null;
  featuredArtist: Artist | null;
  topSongs: Song[];
  newSongs: Song[];
  currentSongId: string | null;
  isPlaying: boolean;
  favorites: Set<string>;
  loading: boolean;
  onPlay: (song: Song, queue: Song[]) => void;
  onToggleFavorite: (songId: string) => void;
}

export function HomeView(p: HomeViewProps) {
  return (
    <div className="space-y-5 px-3 pb-40 pt-3">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs text-[var(--tg-hint)]">እንኳን ደህና መጡ · Welcome</p>
          <h1 className="text-xl font-bold">{p.userName ? `${p.userName} 🇪🇹` : "ETHIO MUSIC"}</h1>
        </div>
        <span className="rounded-full bg-[var(--tg-green)]/15 px-2.5 py-1 text-[11px] font-medium text-[var(--tg-green)]">
          100% licensed
        </span>
      </header>

      {p.featuredArtist && (
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[var(--tg-card-2)] to-[var(--tg-card)] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tg-accent)]">
            Featured artist
          </p>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-[var(--tg-card)]">
              {p.featuredArtist.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.featuredArtist.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl">🎤</div>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold">
                {p.featuredArtist.name} {p.featuredArtist.verified && "✅"}
              </p>
              <p className="text-xs text-[var(--tg-hint)]">
                {p.featuredArtist.monthly_listeners.toLocaleString()} monthly listeners
              </p>
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-1.5 px-1 text-base font-semibold">🔥 Trending in Ethiopia</h2>
        <div className="card divide-y divide-white/5 p-1.5">
          {p.loading && <SkeletonRows n={5} />}
          {!p.loading &&
            p.topSongs.map((s, i) => (
              <SongRow
                key={s.id}
                song={s}
                index={i}
                isCurrent={p.currentSongId === s.id}
                isPlaying={p.isPlaying}
                isFavorite={p.favorites.has(s.id)}
                onPlay={() => p.onPlay(s, p.topSongs)}
                onToggleFavorite={() => p.onToggleFavorite(s.id)}
              />
            ))}
        </div>
      </section>

      {p.newSongs.length > 0 && (
        <section>
          <h2 className="mb-1.5 px-1 text-base font-semibold">🆕 New releases</h2>
          <div className="card divide-y divide-white/5 p-1.5">
            {p.newSongs.map((s) => (
              <SongRow
                key={s.id}
                song={s}
                isCurrent={p.currentSongId === s.id}
                isPlaying={p.isPlaying}
                isFavorite={p.favorites.has(s.id)}
                onPlay={() => p.onPlay(s, p.newSongs)}
                onToggleFavorite={() => p.onToggleFavorite(s.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function SkeletonRows({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 px-3 py-3">
          <div className="h-11 w-11 rounded-lg bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-3/5 rounded bg-white/10" />
            <div className="h-3 w-2/5 rounded bg-white/10" />
          </div>
        </div>
      ))}
    </>
  );
}
