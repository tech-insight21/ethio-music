"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Cover } from "@/components/Cover";
import { Icon } from "@/components/Icon";
import { LoadingScreen } from "@/components/States";
import { usePlayer } from "@/lib/player";
import { fmtDuration, haptic } from "@/lib/telegram";
import { getSongById, type Song } from "@/lib/supabase";
import { useState } from "react";

export default function PlayerPage() {
  return (
    <Suspense fallback={<LoadingScreen label="Opening player…" />}>
      <FullScreenPlayer />
    </Suspense>
  );
}

function FullScreenPlayer() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const player = usePlayer();

  // deep-link support: /player/?id=X when X is not already loaded
  const [deepLinkLoading, setDeepLinkLoading] = useState(false);
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    if (player.current?.id === id) return;
    let alive = true;
    setDeepLinkLoading(true);
    setDeepLinkError(null);
    getSongById(id)
      .then((s: Song) => {
        if (!alive) return;
        player.playQueue([s], 0);
      })
      .catch(() => alive && setDeepLinkError("This song isn't available."))
      .finally(() => alive && setDeepLinkLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // keep Telegram back button available on this page too
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.BackButton) return;
    const onClick = () => router.back();
    tg.BackButton.show();
    tg.BackButton.onClick(onClick);
    return () => {
      tg.BackButton?.offClick(onClick);
      tg.BackButton?.hide();
    };
  }, [router]);

  const { current, isPlaying, progress, duration, audioError, toggle, next, prev, seek, close } = player;

  if (deepLinkLoading && !current) return <LoadingScreen label="Loading track…" />;
  if (deepLinkError && !current) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-3xl" aria-hidden>🎵</p>
        <p className="text-[15px] font-semibold">{deepLinkError}</p>
        <button className="press rounded-full bg-[var(--gold)] px-6 py-2.5 text-sm font-bold text-black" onClick={() => router.back()}>
          Go back
        </button>
      </main>
    );
  }

  if (!current) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-4xl" aria-hidden>🎧</p>
        <p className="text-[16px] font-bold">Nothing is playing</p>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          Pick a song from Trending, an album, or your favorites — the player
          keeps music going while you browse.
        </p>
        <button
          className="press rounded-full bg-[var(--gold)] px-6 py-2.5 text-sm font-bold text-black"
          onClick={() => router.back()}
        >
          Back
        </button>
      </main>
    );
  }

  const dur = duration || current.duration_seconds || 0;
  const pct = dur > 0 ? Math.min(100, (progress / dur) * 100) : 0;

  return (
    <main className="page-enter relative flex min-h-[calc(var(--vh,1vh)*100)] flex-col px-6 pb-8 pt-3">
      {/* top bar */}
      <div className="flex items-center justify-between pb-2">
        <button
          aria-label="Close player"
          className="press flex h-9 w-9 items-center justify-center rounded-full bg-[var(--card)]"
          onClick={() => {
            haptic("light");
            router.back();
          }}
        >
          <Icon name="chevronLeft" className="h-5 w-5" />
        </button>
        <div className="text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--muted)]">Now playing</p>
          <p className="text-[10px] text-[var(--muted)]">from ETHIO MUSIC · licensed</p>
        </div>
        <button
          aria-label="Stop and close"
          className="press flex h-9 w-9 items-center justify-center rounded-full bg-[var(--card)]"
          onClick={() => {
            haptic("light");
            close();
            router.back();
          }}
        >
          <Icon name="x" className="h-4.5 w-4.5" />
        </button>
      </div>

      {/* artwork */}
      <div className="mt-2 flex justify-center">
        <div className="relative">
          <Cover
            seed={current.id}
            imageUrl={current.cover_url ?? current.album?.cover_url}
            className={`aspect-square w-[min(78vw,20rem)] shadow-2xl shadow-black/70 transition-transform duration-500 ${
              isPlaying ? "scale-100" : "scale-[0.94]"
            }`}
            rounded="rounded-[28px]"
          />
          <div
            className="pointer-events-none absolute inset-0 rounded-[28px] border border-white/10"
            aria-hidden
          />
        </div>
      </div>

      {/* title */}
      <div className="mt-6 text-center">
        <h1 className="truncate text-[22px] font-extrabold leading-tight">{current.title}</h1>
        <p className="mt-0.5 truncate text-[14px] text-[var(--gold)]">{current.artist?.name ?? ""}</p>
        {audioError && (
          <p className="mt-2 rounded-xl bg-[var(--gold)]/10 px-3 py-2 text-[12px] leading-relaxed text-[var(--gold)]">
            Demo audio placeholder isn&apos;t available in this build. Track metadata
            is live — real masters stream once uploaded to the catalog.
          </p>
        )}
      </div>

      {/* seek bar */}
      <div className="mt-6">
        <input
          type="range"
          className="seek w-full"
          aria-label="Seek"
          min={0}
          max={1000}
          value={dur > 0 ? Math.round((progress / dur) * 1000) : 0}
          style={{ ["--fill" as string]: `${pct}%` }}
          onChange={(e) => seek(Number(e.target.value) / 1000)}
        />
        <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-[var(--muted)]">
          <span>{fmtDuration(progress)}</span>
          <span>{fmtDuration(dur)}</span>
        </div>
      </div>

      {/* controls */}
      <div className="mt-4 flex items-center justify-center gap-7">
        <button
          aria-label="Previous"
          className="press text-[var(--text)]"
          onClick={prev}
        >
          <Icon name="prev" className="h-7 w-7" />
        </button>
        <button
          aria-label={isPlaying ? "Pause" : "Play"}
          className="press flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[var(--gold)] text-black shadow-xl shadow-[var(--gold)]/20"
          onClick={toggle}
        >
          <Icon name={isPlaying ? "pause" : "play"} className="h-8 w-8" />
        </button>
        <button
          aria-label="Next"
          className="press text-[var(--text)]"
          onClick={next}
        >
          <Icon name="next" className="h-7 w-7" />
        </button>
      </div>

      {/* up next */}
      {player.queue.length > 1 && (
        <div className="mt-7">
          <p className="mb-2 text-[13px] font-bold text-[var(--muted)]">Up next</p>
          <div className="no-scrollbar max-h-44 space-y-0.5 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2">
            {player.queue
              .filter((s) => s.id !== current.id)
              .slice(0, 8)
              .map((s) => (
                <button
                  key={s.id}
                  className="press flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left active:bg-white/5"
                  onClick={() => {
                    haptic("light");
                    const idx = player.queue.findIndex((q) => q.id === s.id);
                    player.playQueue(player.queue, idx);
                  }}
                >
                  <Cover seed={s.id} imageUrl={s.cover_url} className="h-8 w-8" rounded="rounded-md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{s.title}</span>
                    <span className="block truncate text-[11px] text-[var(--muted)]">{s.artist?.name}</span>
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </main>
  );
}
