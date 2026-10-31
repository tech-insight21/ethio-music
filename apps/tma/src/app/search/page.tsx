"use client";

import { useEffect, useState } from "react";
import { ArtistCard, SongRow } from "@/components/SongRow";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/States";
import { useAsyncData } from "@/lib/telegram";
import { searchCatalog, type Artist, type Song } from "@/lib/supabase";

const RECENT_KEY = "ethio:recent-searches";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) setRecent(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
  }, []);

  const debounced = useDebounced(query, 350);
  const trimmed = debounced.trim();

  useEffect(() => {
    if (trimmed.length >= 2) {
      setRecent((prev) => {
        const next = [trimmed, ...prev.filter((r) => r !== trimmed)].slice(0, 6);
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed]);

  const results = useAsyncData(
    () => (trimmed.length >= 2 ? searchCatalog(trimmed) : Promise.resolve({ songs: [], artists: [] as Artist[] })),
    [trimmed]
  );

  const showResults = trimmed.length >= 2;

  return (
    <main className="page-enter px-3">
      <header className="pb-2 pt-3">
        <h1 className="text-[22px] font-extrabold tracking-tight">Search</h1>
        <p className="text-[12px] text-[var(--muted)]">Amharic · Oromo · Tigrinya · English</p>
      </header>

      <div className="relative">
        <input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Songs or artists…"
          aria-label="Search songs and artists"
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] py-3 pl-10 pr-9 text-[15px] outline-none placeholder:text-[var(--muted)] focus:border-[var(--gold)]/50"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden>
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
        </span>
        {query && (
          <button
            aria-label="Clear search"
            className="press absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
            onClick={() => setQuery("")}
          >
            ✕
          </button>
        )}
      </div>

      {/* recent searches (device-local) */}
      {!showResults && recent.length > 0 && (
        <section className="pt-4">
          <p className="mb-2 text-[13px] font-semibold text-[var(--muted)]">Recent</p>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <button
                key={r}
                className="press rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-[13px]"
                onClick={() => setQuery(r)}
              >
                {r}
              </button>
            ))}
            <button
              className="press rounded-full px-3 py-1.5 text-[13px] text-[var(--muted)]"
              onClick={() => {
                setRecent([]);
                try {
                  localStorage.removeItem(RECENT_KEY);
                } catch {
                  /* ignore */
                }
              }}
            >
              Clear
            </button>
          </div>
        </section>
      )}

      {/* idle */}
      {!showResults && recent.length === 0 && (
        <div className="pt-16 text-center text-[var(--muted)]">
          <p className="text-3xl" aria-hidden>🎧</p>
          <p className="mt-2 text-sm leading-relaxed">
            Search the licensed catalog —<br />
            artists, titles and genres.
          </p>
        </div>
      )}

      {/* results */}
      {showResults && (
        <div className="pt-4">
          {results.loading && <SkeletonRows n={5} />}

          {results.error && !results.data && (
            <ErrorState message="Search failed. Check your connection." onRetry={results.retry} />
          )}

          {results.data && (
            <>
              {results.data.artists.length > 0 && (
                <section className="pb-2">
                  <p className="mb-2 text-[13px] font-semibold text-[var(--muted)]">Artists</p>
                  <div className="no-scrollbar -mx-3 flex gap-3 overflow-x-auto px-3">
                    {results.data.artists.map((a) => (
                      <ArtistCard key={a.id} artist={a} />
                    ))}
                  </div>
                </section>
              )}

              {results.data.songs.length > 0 ? (
                <section>
                  <p className="mb-1 text-[13px] font-semibold text-[var(--muted)]">Songs</p>
                  <div className="card p-1.5">
                    {results.data.songs.map((s: Song) => (
                      <SongRow key={s.id} song={s} queue={results.data!.songs} />
                    ))}
                  </div>
                </section>
              ) : results.data.artists.length === 0 ? (
                <EmptyState
                  icon="🔍"
                  title={`No results for “${trimmed}”`}
                  body="Try another spelling, or browse Trending for what Ethiopia is playing right now."
                />
              ) : null}
            </>
          )}
        </div>
      )}
    </main>
  );
}

function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
