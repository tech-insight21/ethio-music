"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Cover } from "@/components/Cover";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { AlbumCard, SectionHeader, SongRow } from "@/components/SongRow";
import { BackendNotice, EmptyState, ErrorState, LoadingScreen, SkeletonRows } from "@/components/States";
import { useAuth } from "@/lib/auth";
import { useAsyncData, haptic, hapticNotify, fmtCount } from "@/lib/telegram";
import {
  getArtistAlbums,
  getArtistBySlug,
  getArtistSongs,
  getFollowerCount,
  getSupabase,
} from "@/lib/supabase";

export default function ArtistPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ArtistProfile />
    </Suspense>
  );
}

function ArtistProfile() {
  const slug = useSearchParams().get("slug") ?? "";
  const { status } = useAuth();
  const [followed, setFollowed] = useState<boolean | null>(null);

  const artist = useAsyncData(() => getArtistBySlug(slug), [slug]);
  const artistId = artist.data?.id ?? null;
  const songs = useAsyncData(
    () => (artistId ? getArtistSongs(artistId, 6) : Promise.resolve([])),
    [artistId]
  );
  const albums = useAsyncData(
    () => (artistId ? getArtistAlbums(artistId) : Promise.resolve([])),
    [artistId]
  );
  const followers = useAsyncData(
    () => (artistId ? getFollowerCount(artistId) : Promise.resolve(0)),
    [artistId]
  );

  const follow = async () => {
    if (status !== "authenticated" || !artistId) return; // button is hidden for guests
    haptic("medium");
    try {
      const supabase = getSupabase();
      if (followed) {
        const { error } = await supabase.from("follows").delete().eq("artist_id", artistId);
        if (error) throw error;
        setFollowed(false);
        followers.retry();
      } else {
        const { error } = await supabase.from("follows").insert({ artist_id: artistId });
        if (error) throw error;
        setFollowed(true);
        followers.retry();
      }
      hapticNotify("success");
    } catch {
      hapticNotify("error");
    }
  };

  if (artist.loading) return <LoadingScreen label="Loading artist…" />;

  if (artist.error) {
    return (
      <main className="px-3">
        <PageHeader title="Artist" />
        <ErrorState
          message={(artist.error as Error).message}
          onRetry={artist.retry}
        />
      </main>
    );
  }

  if (!artist.data) {
    return (
      <main className="px-3">
        <PageHeader title="Artist" />
        <EmptyState icon="🎤" title="Artist not found" body="This profile doesn't exist or isn't published yet." />
      </main>
    );
  }

  const a = artist.data;

  return (
    <main className="page-enter">
      {/* hero */}
      <div className="relative">
        <Cover seed={a.id} imageUrl={a.cover_url ?? a.avatar_url} className="h-52 w-full" rounded="rounded-none" icon="artist" />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg)] via-transparent to-black/30" />
        <div className="absolute left-2 top-2">
          <PageHeader title="" back />
        </div>
      </div>

      <div className="-mt-8 px-3">
        <div className="flex items-end gap-3">
          <Cover seed={a.id} imageUrl={a.avatar_url} className="h-20 w-20 shrink-0 border-2 border-[var(--bg)]" rounded="rounded-2xl" icon="artist" />
          <div className="min-w-0 pb-1">
            <h1 className="flex items-center gap-1.5 text-[21px] font-extrabold leading-tight">
              {a.name}
              {a.verified && <Icon name="verified" className="h-5 w-5 shrink-0 text-[var(--gold)]" />}
            </h1>
            <p className="text-[12px] text-[var(--muted)]">
              {fmtCount(a.monthly_listeners)} monthly listeners · {followers.data ?? 0} followers
            </p>
          </div>
        </div>

        {a.bio && <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--text)]/85">{a.bio}</p>}
        {a.region && <p className="mt-1 text-[12px] text-[var(--muted)]">📍 {a.region}, Ethiopia</p>}

        {/* follow */}
        {status === "authenticated" ? (
          <button
            className={`press mt-4 w-full rounded-xl py-3 text-[14px] font-bold ${
              followed ? "bg-[var(--card-2)] text-[var(--text)]" : "bg-[var(--gold)] text-black"
            }`}
            onClick={follow}
          >
            {followed === null ? "Follow" : followed ? "Following ✓" : "Follow"}
          </button>
        ) : (
          <div className="mt-4">
            <BackendNotice>
              Following artists requires signing in — the Telegram authentication
              backend (<code className="text-[var(--gold)]">supabase/functions/telegram-auth</code>)
              is not deployed yet. Deploy it to unlock follows, synced favorites and playlists.
            </BackendNotice>
          </div>
        )}

        {/* popular */}
        <SectionHeader title="Popular" />
        {songs.loading && <SkeletonRows n={4} />}
        {songs.error && !songs.data && <ErrorState onRetry={songs.retry} />}
        {songs.data && (
          <div className="card p-1.5">
            {songs.data.length === 0 ? (
              <p className="p-5 text-center text-sm text-[var(--muted)]">No released songs yet.</p>
            ) : (
              songs.data.map((s) => <SongRow key={s.id} song={s} queue={songs.data!} />)
            )}
          </div>
        )}

        {/* albums */}
        <SectionHeader title="Discography" />
        {albums.loading && <SkeletonRows n={2} cover={false} />}
        {albums.error && !albums.data && <ErrorState onRetry={albums.retry} />}
        {albums.data && albums.data.length > 0 && (
          <div className="no-scrollbar -mx-3 flex gap-3 overflow-x-auto px-3 pb-2">
            {albums.data.map((al) => (
              <AlbumCard key={al.id} album={{ ...al, artist: { name: a.name } }} />
            ))}
          </div>
        )}
        {albums.data && albums.data.length === 0 && (
          <EmptyState icon="💿" title="No albums yet" body="Singles will appear here as they're released." />
        )}
      </div>
    </main>
  );
}
