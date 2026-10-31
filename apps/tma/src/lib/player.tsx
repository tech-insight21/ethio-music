"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Song } from "./supabase";
import { getSupabase, logPlay } from "./supabase";
import { haptic } from "./telegram";

/* ─────────────────────────────────────────────────────────────────────────────
 * Global audio player. A single Audio instance lives for the whole app so
 * playback continues across page navigation (mini-player → full player).
 * ───────────────────────────────────────────────────────────────────────────── */

interface PlayerContextValue {
  current: Song | null;
  queue: Song[];
  isPlaying: boolean;
  progress: number; // seconds
  duration: number; // seconds
  audioError: boolean;
  playQueue: (queue: Song[], startIndex: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (fraction: number) => void;
  close: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Song[]>([]);
  const indexRef = useRef(0);

  const [current, setCurrent] = useState<Song | null>(null);
  const [queue, setQueue] = useState<Song[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState(false);

  // create the audio element once
  useEffect(() => {
    const el = new Audio();
    el.preload = "metadata";
    audioRef.current = el;

    const onTime = () => setProgress(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration)) setDuration(el.duration);
    };
    const onEnd = () => advance(1, true);
    const onErr = () => {
      setAudioError(true);
      setIsPlaying(false);
    };
    const onPause = () => setIsPlaying(false);
    const onPlayEvt = () => setIsPlaying(true);

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onErr);
    el.addEventListener("pause", onPause);
    el.addEventListener("play", onPlayEvt);

    return () => {
      el.pause();
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onErr);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("play", onPlayEvt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAndPlay = useCallback((song: Song) => {
    const el = audioRef.current;
    if (!el) return;
    setAudioError(false);
    setProgress(0);
    setDuration(song.duration_seconds || 0);
    el.src = song.audio_url;
    el.play().catch(() => setIsPlaying(false));
  }, []);

  const advance = useCallback(
    (dir: 1 | -1, auto = false) => {
      const q = queueRef.current;
      if (q.length === 0) return;
      const nextIndex = (indexRef.current + dir + q.length) % q.length;
      indexRef.current = nextIndex;
      const song = q[nextIndex];
      if (!song) return;
      if (!auto) haptic("light");
      setCurrent(song);
      loadAndPlay(song);
    },
    [loadAndPlay]
  );

  const playQueue = useCallback(
    (q: Song[], startIndex: number) => {
      if (q.length === 0) return;
      haptic("medium");
      queueRef.current = q;
      indexRef.current = Math.max(0, Math.min(startIndex, q.length - 1));
      setQueue(q);
      const song = q[indexRef.current];
      setCurrent(song);
      // real analytics write (RLS: anonymous allowed with user_id null)
      void logPlay(song.id);
      loadAndPlay(song);
    },
    [loadAndPlay]
  );

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !current) return;
    haptic("light");
    if (el.paused) el.play().catch(() => setIsPlaying(false));
    else el.pause();
  }, [current]);

  const next = useCallback(() => advance(1), [advance]);
  const prev = useCallback(() => {
    const el = audioRef.current;
    if (el && el.currentTime > 4) {
      el.currentTime = 0;
      return;
    }
    advance(-1);
  }, [advance]);

  const seek = useCallback((fraction: number) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = Math.max(0, Math.min(1, fraction)) * el.duration;
    setProgress(el.currentTime);
  }, []);

  const close = useCallback(() => {
    audioRef.current?.pause();
    setCurrent(null);
    setQueue([]);
    queueRef.current = [];
    indexRef.current = 0;
  }, []);

  // Refresh the queue metadata when songs change identity (e.g. favorites)
  useEffect(() => {
    if (current) {
      const idx = queue.findIndex((s) => s.id === current.id);
      if (idx >= 0) indexRef.current = idx;
    }
  }, [queue, current]);

  return (
    <PlayerContext.Provider
      value={{
        current,
        queue,
        isPlaying,
        progress,
        duration,
        audioError,
        playQueue,
        toggle,
        next,
        prev,
        seek,
        close,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}

/** Convenience: play a single song with a surrounding queue. */
export function usePlaySong() {
  const { playQueue } = usePlayer();
  return useCallback(
    (song: Song, queue: Song[]) => {
      const idx = Math.max(0, queue.findIndex((s) => s.id === song.id));
      playQueue(queue.length > 0 ? queue : [song], queue.length > 0 ? idx : 0);
    },
    [playQueue]
  );
}
