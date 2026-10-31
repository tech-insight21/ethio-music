"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase, Song, Plan, Artist } from "@/lib/supabase";
import { useTelegram } from "@/lib/telegram";
import { TabBar, Tab } from "@/components/TabBar";
import { PlayerBar } from "@/components/PlayerBar";
import { HomeView } from "@/components/views/HomeView";
import { SearchView } from "@/components/views/SearchView";
import { LibraryView } from "@/components/views/LibraryView";
import { PremiumView } from "@/components/views/PremiumView";

const FAV_KEY = "ethio-music:favorites";

export default function App() {
  const { user, haptic } = useTelegram();
  const [tab, setTab] = useState<Tab>("home");

  // catalog state
  const [topSongs, setTopSongs] = useState<Song[]>([]);
  const [newSongs, setNewSongs] = useState<Song[]>([]);
  const [featured, setFeatured] = useState<Artist | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // search state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);

  // player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<Song[]>([]);
  const [current, setCurrent] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // favorites (device-local in demo build)
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoriteSongs, setFavoriteSongs] = useState<Song[]>([]);

  /* ── load catalog from Supabase (RLS-protected, anon role) ───────────── */
  useEffect(() => {
    const supabase = getSupabase();

    (async () => {
      try {
        const [top, latest, promo, planRows] = await Promise.all([
          supabase
            .from("songs")
            .select("*, artist:artists(id,name,slug,avatar_url,verified,monthly_listeners), genres:song_genres(genres(id,name,slug))")
            .eq("release_status", "approved")
            .order("play_count", { ascending: false })
            .limit(10),
          supabase
            .from("songs")
            .select("*, artist:artists(id,name,slug,avatar_url,verified,monthly_listeners), genres:song_genres(genres(id,name,slug))")
            .eq("release_status", "approved")
            .order("approved_at", { ascending: false })
            .limit(5),
          supabase
            .from("promotions")
            .select("id, promotion_type, artist:artists(id,name,slug,avatar_url,verified,monthly_listeners)")
            .eq("status", "active")
            .gt("ends_at", new Date().toISOString())
            .eq("promotion_type", "featured_artist")
            .limit(1),
          supabase.from("plans").select("*").eq("is_active", true).order("sort_order"),
        ]);

        if (top.error) throw top.error;
        if (latest.error) throw latest.error;
        if (planRows.error) throw planRows.error;

        setTopSongs((top.data ?? []) as unknown as Song[]);
        setNewSongs((latest.data ?? []) as unknown as Song[]);
        setPlans((planRows.data ?? []) as unknown as Plan[]);
        const feat = (promo.data ?? [])[0] as unknown as { artist: Artist } | undefined;
        setFeatured(feat?.artist ?? null);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load catalog");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ── favorites persistence ────────────────────────────────────────────── */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) setFavorites(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (favorites.size === 0) {
      setFavoriteSongs([]);
      return;
    }
    const supabase = getSupabase();
    (async () => {
      const { data } = await supabase
        .from("songs")
        .select("*, artist:artists(id,name,slug,avatar_url,verified,monthly_listeners), genres:song_genres(genres(id,name,slug))")
        .in("id", [...favorites])
        .eq("release_status", "approved");
      setFavoriteSongs((data ?? []) as unknown as Song[]);
    })();
  }, [favorites]);

  const toggleFavorite = useCallback(
    (songId: string) => {
      haptic("light");
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(songId)) next.delete(songId);
        else next.add(songId);
        try {
          localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
        } catch { /* ignore */ }
        return next;
      });
    },
    [haptic]
  );

  /* ── search (debounced) ───────────────────────────────────────────────── */
  useEffect(() => {
    if (tab !== "search" || query.trim() === "") {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      const supabase = getSupabase();
      const q = query.trim();
      const cols =
        "*, artist:artists(id,name,slug,avatar_url,verified,monthly_listeners), genres:song_genres(genres(id,name,slug))";
      try {
        // NOTE: PostgREST does not accept embedded-resource filters inside
        // .or(), so title and artist matches run as two queries and merge.
        const [byTitle, byArtistName] = await Promise.all([
          supabase
            .from("songs")
            .select(cols)
            .eq("release_status", "approved")
            .ilike("title", `%${q}%`)
            .limit(20),
          supabase.from("artists").select("id").ilike("name", `%${q}%`).limit(20),
        ]);

        let artistSongs: Song[] = [];
        const artistIds = (byArtistName.data ?? []).map((a) => a.id);
        if (artistIds.length > 0) {
          const { data } = await supabase
            .from("songs")
            .select(cols)
            .eq("release_status", "approved")
            .in("artist_id", artistIds)
            .limit(20);
          artistSongs = (data ?? []) as unknown as Song[];
        }

        const merged = [...((byTitle.data ?? []) as unknown as Song[])];
        const seen = new Set(merged.map((s) => s.id));
        for (const s of artistSongs) if (!seen.has(s.id)) merged.push(s);
        setResults(merged);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, tab]);

  /* ── playback ─────────────────────────────────────────────────────────── */
  const playSong = useCallback(
    (song: Song, q: Song[]) => {
      haptic("medium");
      setQueue(q);
      setCurrent(song);
      setProgress(0);
      // count the play (RLS: anonymous insert allowed with user_id = null)
      getSupabase()
        .from("song_plays")
        .insert({ song_id: song.id, source: "tma", seconds_played: 0 })
        .then(() => { /* best effort */ });
      setTimeout(() => {
        audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      }, 50);
    },
    [haptic]
  );

  const togglePlay = useCallback(() => {
    haptic("light");
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    else { el.pause(); setIsPlaying(false); }
  }, [haptic]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!current || queue.length === 0) return;
      const i = queue.findIndex((s) => s.id === current.id);
      const nextSong = queue[(i + dir + queue.length) % queue.length];
      if (nextSong) playSong(nextSong, queue);
    },
    [current, queue, playSong]
  );

  const currentIdx = useMemo(
    () => (current ? queue.findIndex((s) => s.id === current.id) : -1),
    [current, queue]
  );

  return (
    <main className="mx-auto min-h-screen max-w-md">
      {loadError && (
        <div className="mx-3 mt-3 rounded-xl bg-[var(--tg-red)]/15 p-3 text-sm text-[var(--tg-red)]">
          ⚠️ {loadError}
        </div>
      )}

      {tab === "home" && (
        <HomeView
          userName={user?.name ?? null}
          featuredArtist={featured}
          topSongs={topSongs}
          newSongs={newSongs}
          currentSongId={current?.id ?? null}
          isPlaying={isPlaying}
          favorites={favorites}
          loading={loading}
          onPlay={playSong}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {tab === "search" && (
        <SearchView
          query={query}
          onQueryChange={setQuery}
          results={results}
          searching={searching}
          currentSongId={current?.id ?? null}
          isPlaying={isPlaying}
          favorites={favorites}
          onPlay={playSong}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {tab === "library" && (
        <LibraryView
          favorites={favorites}
          favoriteSongs={favoriteSongs}
          loading={loading}
          currentSongId={current?.id ?? null}
          isPlaying={isPlaying}
          onPlay={playSong}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {tab === "premium" && <PremiumView plans={plans} loading={loading} />}

      <PlayerBar
        song={current}
        isPlaying={isPlaying}
        progress={current ? progress / Math.max(1, current.duration_seconds) : 0}
        onToggle={togglePlay}
        onNext={() => step(1)}
        onPrev={() => step(-1)}
      />

      <TabBar
        active={tab}
        onChange={(t) => {
          haptic("light");
          setTab(t);
        }}
      />

      {current && (
        <audio
          ref={audioRef}
          src={current.audio_url}
          onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
          onEnded={() => step(1)}
          onError={() => {
            setIsPlaying(false);
            if (currentIdx >= 0) step(1); // seed tracks are placeholders — skip forward
          }}
          preload="metadata"
        />
      )}
    </main>
  );
}
