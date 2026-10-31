"use client";

import { Song } from "@/lib/supabase";
import { SongRow } from "../SongRow";
import { SkeletonRows } from "./HomeView";

interface SearchViewProps {
  query: string;
  onQueryChange: (q: string) => void;
  results: Song[];
  searching: boolean;
  currentSongId: string | null;
  isPlaying: boolean;
  favorites: Set<string>;
  onPlay: (song: Song, queue: Song[]) => void;
  onToggleFavorite: (songId: string) => void;
}

export function SearchView(p: SearchViewProps) {
  return (
    <div className="space-y-3 px-3 pb-40 pt-3">
      <div className="relative">
        <input
          value={p.query}
          onChange={(e) => p.onQueryChange(e.target.value)}
          placeholder="Search songs or artists… ይፈልጉ…"
          aria-label="Search songs"
          className="w-full rounded-xl bg-[var(--tg-card)] py-3 pl-10 pr-4 text-[15px] outline-none ring-1 ring-white/5 placeholder:text-[var(--tg-hint)] focus:ring-[var(--tg-accent)]/50"
        />
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--tg-hint)]">🔍</span>
      </div>

      {p.searching && (
        <div className="card p-1.5">
          <SkeletonRows n={4} />
        </div>
      )}

      {!p.searching && p.query.trim() === "" && (
        <div className="card mt-8 p-6 text-center text-sm text-[var(--tg-hint)]">
          <p className="mb-1 text-2xl">🎧</p>
          Search the licensed catalog —<br />
          Amharic · Oromo · Tigrinya · English
        </div>
      )}

      {!p.searching && p.query.trim() !== "" && (
        <div className="card divide-y divide-white/5 p-1.5">
          {p.results.length === 0 ? (
            <p className="p-5 text-center text-sm text-[var(--tg-hint)]">
              No results for “{p.query}”
            </p>
          ) : (
            p.results.map((s) => (
              <SongRow
                key={s.id}
                song={s}
                isCurrent={p.currentSongId === s.id}
                isPlaying={p.isPlaying}
                isFavorite={p.favorites.has(s.id)}
                onPlay={() => p.onPlay(s, p.results)}
                onToggleFavorite={() => p.onToggleFavorite(s.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
