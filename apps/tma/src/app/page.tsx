"use client";

import Link from "next/link";
import { Cover } from "@/components/Cover";
import { Icon } from "@/components/Icon";
import { AlbumCard, ArtistCard, SectionHeader, SongRow } from "@/components/SongRow";
import { ErrorState, SkeletonCards, SkeletonHero, SkeletonRows } from "@/components/States";
import { useAuth } from "@/lib/auth";
import { useAsyncData } from "@/lib/telegram";
import { getArtists, getFeaturedArtist, getNewSongs, getTrendingSongs, type Artist, type Song } from "@/lib/supabase";

export default function HomePage() {
  const { tgUser } = useAuth();
  const trending = useAsyncData(() => getTrendingSongs(6), []);
  const fresh = useAsyncData(() => getNewSongs(5), []);
  const featured = useAsyncData(() => getFeaturedArtist(), []);
  const artists = useAsyncData(() => getArtists(), []);

  const greeting =
    tgUser?.firstName ? `${tgUser.firstName}` : "ወዳጄ";

  return (
    <main className="page-enter px-3">
      {/* header */}
      <header className="flex items-center justify-between pb-1 pt-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-widest text-[var(--gold)]">
            እንኳን ደህና መጡ
          </p>
          <h1 className="truncate text-[22px] font-extrabold tracking-tight">
            {greeting} <span aria-hidden>🇪🇹</span>
          </h1>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--green)]/30 bg-[var(--green)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--green)]">
          100% licensed
        </span>
      </header>

      {/* featured artist (from live promotions) */}
      <section aria-label="Featured artist" className="pt-2">
        {featured.loading && <SkeletonHero />}
        {featured.error && !featured.data && (
          <ErrorState message="Couldn't load the featured artist." onRetry={featured.retry} />
        )}
        {featured.data && (
          <Link
            href={`/artist/?slug=${featured.data.slug}`}
            className="press relative block overflow-hidden rounded-2xl border border-[var(--border)]"
          >
            <Cover
              seed={featured.data.id}
              imageUrl={featured.data.avatar_url}
              className="h-40 w-full"
              rounded="rounded-2xl"
              icon="artist"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]">
                Featured artist
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xl font-extrabold">
                {featured.data.name}
                {featured.data.verified && <Icon name="verified" className="h-5 w-5 text-[var(--gold)]" />}
              </p>
              <p className="text-[12px] text-white/70">
                {featured.data.monthly_listeners.toLocaleString()} monthly listeners
              </p>
            </div>
          </Link>
        )}
      </section>

      {/* trending */}
      <SectionHeader title="Trending in Ethiopia" icon="flame" href="/trending/" />
      {trending.loading && <SkeletonRows n={5} />}
      {trending.error && !trending.data && (
        <ErrorState message="Couldn't load trending songs." onRetry={trending.retry} />
      )}
      {trending.data && (
        <div className="card p-1.5">
          {trending.data.length === 0 ? (
            <p className="p-5 text-center text-sm text-[var(--muted)]">Catalog is warming up.</p>
          ) : (
            trending.data.map((s) => <SongRow key={s.id} song={s} queue={trending.data!} />)
          )}
        </div>
      )}

      {/* new releases */}
      <SectionHeader title="New releases" />
      {fresh.loading && <SkeletonRows n={3} />}
      {fresh.error && !fresh.data && (
        <ErrorState message="Couldn't load new releases." onRetry={fresh.retry} />
      )}
      {fresh.data && fresh.data.length > 0 && (
        <div className="card p-1.5">
          {fresh.data.map((s: Song) => (
            <SongRow key={s.id} song={s} queue={fresh.data!} />
          ))}
        </div>
      )}
      {fresh.data && fresh.data.length === 0 && (
        <p className="rounded-xl bg-[var(--card)] p-4 text-center text-sm text-[var(--muted)]">
          No releases yet — be the first artist to publish.
        </p>
      )}

      {/* artists rail */}
      <SectionHeader title="Artists" icon="user" href="/artists/" />
      {artists.loading && <SkeletonCards n={3} />}
      {artists.error && !artists.data && (
        <ErrorState message="Couldn't load artists." onRetry={artists.retry} />
      )}
      {artists.data && (
        <div className="no-scrollbar -mx-3 flex gap-3 overflow-x-auto px-3 pb-1">
          {artists.data.map((a: Artist) => (
            <ArtistCard key={a.id} artist={a} />
          ))}
        </div>
      )}

      {/* premium banner */}
      <Link
        href="/premium/"
        className="press anim-rise mt-6 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-[#713f12]/60 via-[var(--card)] to-[var(--card)] p-4"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--gold)] text-black">
          <Icon name="star" className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block text-[15px] font-bold">Go Premium</span>
          <span className="block text-[12px] text-[var(--muted)]">
            Unlimited streaming from 99 ETB / month
          </span>
        </span>
        <Icon name="chevronRight" className="h-5 w-5 text-[var(--muted)]" />
      </Link>

      <p className="mt-6 text-center text-[11px] leading-relaxed text-[var(--muted)]">
        ETHIO MUSIC · ኢትዮጵያ
        <br />
        Only licensed releases. Artists get paid.
      </p>
    </main>
  );
}
