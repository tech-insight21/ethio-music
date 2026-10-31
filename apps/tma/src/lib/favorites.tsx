"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./auth";
import { addFavoriteDb, getSongsByIds, removeFavoriteDb, type Song } from "./supabase";
import { haptic, hapticNotify } from "./telegram";

/* ─────────────────────────────────────────────────────────────────────────────
 * Favorites.
 *  • Authenticated (backend auth deployed): favorites sync to the DB — real.
 *  • Guest (backend auth not yet deployed): favorites live on this device
 *    only. The UI labels this honestly; nothing pretends to be saved.
 * ───────────────────────────────────────────────────────────────────────────── */

const LS_KEY = "ethio:favorites";

interface FavoritesContextValue {
  ids: Set<string>;
  songs: Song[]; // hydrated favorite songs
  hydrated: boolean;
  isFavorite: (songId: string) => boolean;
  toggle: (songId: string) => void;
}

const FavoritesContext = createContext<FavoritesContextValue>({
  ids: new Set(),
  songs: [],
  hydrated: false,
  isFavorite: () => false,
  toggle: () => {},
});

function readLocal(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(ids: Set<string>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...ids]));
  } catch {
    /* storage full / private mode */
  }
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [songs, setSongs] = useState<Song[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // initial load: local list; if authenticated, pull DB favorites and merge
  useEffect(() => {
    let alive = true;
    (async () => {
      const local = readLocal();
      const localSet = new Set(local);

      if (status === "authenticated") {
        try {
          const { fetchMyFavorites } = await import("./supabase");
          const dbIds = await fetchMyFavorites();
          const merged = new Set<string>([...dbIds, ...localSet]);
          if (!alive) return;
          setIds(merged);
          writeLocal(merged);
          setHydrated(true);
          // push any device-only favorites to the DB (real write)
          for (const id of localSet) {
            if (!dbIds.includes(id)) {
              try {
                await addFavoriteDb(id);
              } catch {
                /* non-fatal */
              }
            }
          }
          return;
        } catch {
          if (!alive) return;
          setIds(localSet);
          setHydrated(true);
          return;
        }
      }
      if (!alive) return;
      setIds(localSet);
      setHydrated(true);
    })();
    return () => {
      alive = false;
    };
  }, [status]);

  // hydrate song metadata whenever the id set changes
  useEffect(() => {
    let alive = true;
    (async () => {
      if (ids.size === 0) {
        setSongs([]);
        return;
      }
      const { data } = await getSongsByIds([...ids]).then((d) => ({ data: d })).catch(() => ({ data: [] as Song[] }));
      if (!alive) return;
      setSongs(data ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [ids]);

  const toggle = useCallback(
    (songId: string) => {
      haptic("light");
      setIds((prev) => {
        const nextSet = new Set(prev);
        const removing = nextSet.has(songId);
        if (removing) nextSet.delete(songId);
        else nextSet.add(songId);
        writeLocal(nextSet);

        if (status === "authenticated") {
          // real DB write (RLS: favorites are scoped to auth.uid())
          if (removing) {
            removeFavoriteDb(songId).catch(() => hapticNotify("error"));
          } else {
            addFavoriteDb(songId).catch(() => hapticNotify("error"));
          }
        }
        // guest: device-only by design — labeled in the UI
        return nextSet;
      });
    },
    [status]
  );

  const value = useMemo(
    () => ({
      ids,
      songs,
      hydrated,
      isFavorite: (songId: string) => ids.has(songId),
      toggle,
    }),
    [ids, songs, hydrated, toggle]
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  return useContext(FavoritesContext);
}
