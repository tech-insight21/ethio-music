"use client";

import Link from "next/link";
import { Cover } from "@/components/Cover";
import { Icon } from "@/components/Icon";
import { ErrorState, SkeletonCards } from "@/components/States";
import { useAsyncData, haptic } from "@/lib/telegram";
import { getArtists } from "@/lib/supabase";

export default function ArtistsPage() {
  const { data, error, loading, retry } = useAsyncData(() => getArtists(), []);

  return (
    <main className="page-enter px-3">
      <header className="pb-3 pt-4">
        <h1 className="text-[22px] font-extrabold tracking-tight">Artists</h1>
        <p className="text-[12px] text-[var(--muted)]">
          Ethiopia&apos;s voices — from azmari legends to new-wave pop
        </p>
      </header>

      {loading && (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <SkeletonCards n={1} />
            </div>
          ))}
        </div>
      )}

      {error && !data && <ErrorState onRetry={retry} />}

      {data && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5">
          {data.map((a) => (
            <Link
              key={a.id}
              href={`/artist/?slug=${a.slug}`}
              className="press flex flex-col items-center gap-2 text-center"
              onClick={() => haptic("light")}
            >
              <div className="relative aspect-square w-full">
                <Cover
                  seed={a.id}
                  imageUrl={a.avatar_url}
                  rounded="rounded-2xl"
                  className="h-full w-full"
                  icon="artist"
                />
                {a.verified && (
                  <span
                    className="absolute bottom-1.5 right-1.5 text-[var(--gold)]"
                    title="Verified artist"
                  >
                    <Icon name="verified" className="h-5 w-5" />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-bold leading-tight">{a.name}</p>
                <p className="text-[11.5px] text-[var(--muted)]">
                  {a.monthly_listeners.toLocaleString()} monthly listeners
                </p>
                {a.region && <p className="text-[11px] text-[var(--muted)]/70">{a.region}, ET</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
