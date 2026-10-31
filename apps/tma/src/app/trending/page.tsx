"use client";

import { SongRow } from "@/components/SongRow";
import { ErrorState, SkeletonRows } from "@/components/States";
import { useAsyncData } from "@/lib/telegram";
import { getTrendingSongs } from "@/lib/supabase";

export default function TrendingPage() {
  const { data, error, loading, retry } = useAsyncData(() => getTrendingSongs(20), []);

  return (
    <main className="page-enter px-3">
      <header className="pb-2 pt-4">
        <h1 className="flex items-center gap-2 text-[22px] font-extrabold tracking-tight">
          <span aria-hidden>🔥</span> Trending
        </h1>
        <p className="text-[12px] text-[var(--muted)]">
          What Ethiopia is playing right now · ranked by real plays
        </p>
      </header>

      {loading && <SkeletonRows n={8} />}

      {error && !data && <ErrorState onRetry={retry} />}

      {data && (
        <div className="card p-1.5">
          {data.length === 0 ? (
            <p className="p-6 text-center text-sm text-[var(--muted)]">
              No play data yet — play something and it will chart!
            </p>
          ) : (
            data.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <span
                  className={`w-6 shrink-0 text-center text-[15px] font-extrabold tabular-nums ${
                    i < 3 ? "text-[var(--gold)]" : "text-[var(--muted)]"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <SongRow song={s} queue={data} showIndex={false} />
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}
