"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { MiniPlayer } from "./MiniPlayer";
import { AuthProvider } from "@/lib/auth";
import { FavoritesProvider } from "@/lib/favorites";
import { PlayerProvider } from "@/lib/player";
import { useTelegramInit } from "@/lib/telegram";

/** Client boundary for all global providers + persistent chrome. */
export function AppProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  useTelegramInit();
  const fullScreenPlayer = pathname === "/player/";

  return (
    <AuthProvider>
      <PlayerProvider>
        <FavoritesProvider>
          <div className={fullScreenPlayer ? "" : "page-pad"}>{children}</div>
          <MiniPlayer />
          {!fullScreenPlayer && <BottomNav />}
        </FavoritesProvider>
      </PlayerProvider>
    </AuthProvider>
  );
}
