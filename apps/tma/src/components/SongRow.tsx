"use client";

import Link from "next/link";
import { Cover } from "./Cover";
import { Icon, type IconName } from "./Icon";
import { useFavorites } from "@/lib/favorites";
import { usePlaySong } from "@/lib/player";
import type { Song } from "@/lib/supabase";
import { fmtCount, fmtDuration, haptic } from "@/lib/telegram";

export function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span className="flex h-3.5 w-4 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`w-[3px] rounded-sm bg-[var(--gold)] ${playing ? "eq-bar" : ""}`}
          style={{ height: "100%", animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}

interface SongRowProps {
  song: Song;
  queue: Song[];
  showIndex?: boolean;
  showCover?: boolean;
}

export function SongRow({ song, queue, showIndex = false, showCover = true }: SongRowProps) {
  const play = usePlaySong();
  const { isFavorite, toggle, hydrated } = useFavorites();
  const fav = hydrated && isFavorite(song.id);
  const isCurrent = false; // wired by pages via usePlayer where needed

  return (
    <div className="flex items-center gap-3 rounded-xl px-1.5 py-2 transition-colors active:bg-white/5">
      {showIndex && (
        <span className="w-5 shrink-0 text-center text-[13px] tabular-nums text-[var(--muted)]">
          {song.track_number ?? 0}
        </span>
      )}

      <button
        aria-label={`Play ${song.title}`}
        className="press relative shrink-0"
        onClick={() => play(song, queue)}
      >
        {showCover && (
          <Cover seed={song.id} imageUrl={song.cover_url} className="h-12 w-12" rounded="rounded-lg" />
        )}
        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30 opacity-0 transition-opacity hover:opacity-100">
          <Icon name="play" className="h-5 w-5 text-white" />
        </span>
      </button>

      <Link href={`/song/?id=${song.id}`} className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium leading-snug">{song.title}</p>
        <p className="truncate text-[13px] text-[var(--muted)]">
          {song.artist?.name ?? "Unknown artist"}
          {song.genres && song.genres[0]?.genres ? ` · ${song.genres[0].genres!.name}` : ""}
          {song.play_count > 0 ? ` · ${fmtCount(song.play_count)} plays` : ""}
        </p>
      </Link>

      <button
        aria-label={fav ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={fav}
        className="press shrink-0 p-1.5"
        onClick={() => toggle(song.id)}
      >
        <Icon
          name={fav ? "heartFilled" : "heart"}
          className={`h-5 w-5 ${fav ? "text-[var(--red)]" : "text-[var(--muted)]"}`}
        />
      </button>

      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
        {fmtDuration(song.duration_seconds)}
      </span>
    </div>
  );
}

export function NowPlayingRow({ song, queue, index }: { song: Song; queue: Song[]; index?: number }) {
  const play = usePlaySong();
  return (
    <button
      className="flex w-full items-center gap-3 rounded-xl px-1.5 py-2 text-left transition-colors active:bg-white/5"
      onClick={() => play(song, queue)}
    >
      {index !== undefined && (
        <span className="w-5 shrink-0 text-center text-[13px] tabular-nums text-[var(--muted)]">
          {index + 1}
        </span>
      )}
      <Cover seed={song.id} imageUrl={song.cover_url} className="h-12 w-12" rounded="rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-snug">{song.title}</span>
        <span className="block truncate text-[13px] text-[var(--muted)]">
          {song.artist?.name ?? "Unknown artist"}
        </span>
      </span>
      <span className="shrink-0 px-1 text-xs tabular-nums text-[var(--muted)]">
        {fmtDuration(song.duration_seconds)}
      </span>
    </button>
  );
}

/* ── Cards ──────────────────────────────────────────────────────────── */

export function ArtistCard({
  artist,
  size = "md",
}: {
  artist: { id: string; name: string; slug: string; avatar_url: string | null; verified: boolean; monthly_listeners: number };
  size?: "md" | "lg";
}) {
  const dim = size === "lg" ? "h-40 w-40" : "h-28 w-28";
  return (
    <Link
      href={`/artist/?slug=${artist.slug}`}
      className="press flex w-28 shrink-0 flex-col items-center gap-2 text-center md:w-32"
      onClick={() => haptic("light")}
    >
      <div className={`relative ${dim}`}>
        <Cover
          seed={artist.id}
          imageUrl={artist.avatar_url}
          rounded="rounded-full"
          className="h-full w-full"
          icon="artist"
        />
        {artist.verified && (
          <span className="absolute -right-0.5 bottom-0.5 text-[var(--gold)]" title="Verified">
            <Icon name="verified" className="h-5 w-5" />
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold leading-tight">{artist.name}</p>
        <p className="text-[11px] text-[var(--muted)]">{fmtCount(artist.monthly_listeners)} listeners</p>
      </div>
    </Link>
  );
}

export function AlbumCard({ album }: { album: { id: string; title: string; cover_url: string | null; release_date?: string | null; artist?: { name: string } | null } }) {
  return (
    <Link
      href={`/album/?id=${album.id}`}
      className="press w-36 shrink-0"
      onClick={() => haptic("light")}
    >
      <Cover
        seed={album.id}
        imageUrl={album.cover_url}
        className="aspect-square w-full"
        rounded="rounded-xl"
        icon="album"
      />
      <p className="mt-2 truncate text-[13px] font-semibold leading-tight">{album.title}</p>
      <p className="truncate text-[12px] text-[var(--muted)]">
        {album.artist?.name ?? (album.release_date ? String(album.release_date).slice(0, 4) : "Album")}
      </p>
    </Link>
  );
}

export function SectionHeader({
  title,
  icon,
  href,
  actionLabel = "See all",
}: {
  title: string;
  icon?: IconName;
  href?: string;
  actionLabel?: string;
}) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between px-0.5">
      <h2 className="flex items-center gap-1.5 text-[16px] font-bold tracking-tight">
        {icon && <Icon name={icon} className="h-4.5 w-4.5 text-[var(--gold)]" />}
        {title}
      </h2>
      {href && (
        <Link href={href} className="press text-[13px] font-medium text-[var(--muted)]">
          {actionLabel} ›
        </Link>
      )}
    </div>
  );
}
