"use client";

import { Song } from "@/lib/supabase";
import { SongRow } from "../SongRow";

interface LibraryViewProps {
  favorites: Set<string>;
  favoriteSongs: Song[];
  loading: boolean;
  currentSongId: string | null;
  isPlaying: boolean;
  onPlay: (song: Song, queue: Song[]) => void;
  onToggleFavorite: (songId: string) => void;
}

export function LibraryView(p: LibraryViewProps) {
  return (
    <div className="space-y-4 px-3 pb-40 pt-3">
      <h1 className="px-1 text-xl font-bold">Your Library</h1>

      <div className="card p-3 text-xs leading-relaxed text-[var(--tg-hint)]">
        ❤️ Favorites are saved on this device in the demo build. Full accounts
        (cross-device favorites, playlists, subscriptions) are linked through the
        bot sign-in in the next milestone.
      </div>

      <section>
        <h2 className="mb-1.5 px-1 text-base font-semibold">Liked songs</h2>
        {p.loading ? (
          <div className="card p-5 text-center text-sm text-[var(--tg-hint)]">Loading…</div>
        ) : p.favoriteSongs.length === 0 ? (
          <div className="card p-6 text-center text-sm text-[var(--tg-hint)]">
            <p className="mb-1 text-2xl">🤍</p>
            Tap the heart on any song to add it here.
          </div>
        ) : (
          <div className="card divide-y divide-white/5 p-1.5">
            {p.favoriteSongs.map((s, i) => (
              <SongRow
                key={s.id}
                song={s}
                index={i}
                isCurrent={p.currentSongId === s.id}
                isPlaying={p.isPlaying}
                isFavorite
                onPlay={() => p.onPlay(s, p.favoriteSongs)}
                onToggleFavorite={() => p.onToggleFavorite(s.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
