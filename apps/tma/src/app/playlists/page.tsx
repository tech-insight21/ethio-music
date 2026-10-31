"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { BackendNotice, EmptyState, ErrorState, SkeletonRows } from "@/components/States";
import { useAuth } from "@/lib/auth";
import { haptic, hapticNotify, useAsyncData } from "@/lib/telegram";
import { createPlaylistDb, fetchMyPlaylists } from "@/lib/supabase";

export default function PlaylistsPage() {
  const { status } = useAuth();
  const playlists = useAsyncData(
    () => (status === "authenticated" ? fetchMyPlaylists() : Promise.resolve([])),
    [status]
  );
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      // real DB insert (RLS: playlists.owner_id = auth.uid())
      await createPlaylistDb(title.trim(), isPublic);
      setTitle("");
      setCreating(false);
      hapticNotify("success");
      playlists.retry();
    } catch {
      hapticNotify("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page-enter px-3">
      <PageHeader
        title="Playlists"
        action={
          status === "authenticated" ? (
            <button
              aria-label="New playlist"
              className="press flex h-9 w-9 items-center justify-center rounded-full bg-[var(--gold)] text-black"
              onClick={() => {
                haptic("light");
                setCreating((v) => !v);
              }}
            >
              <Icon name="plus" className="h-5 w-5" />
            </button>
          ) : undefined
        }
      />

      {status !== "authenticated" ? (
        <BackendNotice>
          <p className="font-semibold">Playlists need an account.</p>
          <p className="mt-1">
            Sign-in happens automatically through Telegram once the auth backend is
            deployed (<code className="text-[var(--gold)]">supabase/functions/telegram-auth</code>).
            Nothing is faked here — no session, no playlist writes.
          </p>
        </BackendNotice>
      ) : (
        <>
          {creating && (
            <div className="card anim-rise p-4">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Playlist name"
                aria-label="Playlist name"
                maxLength={120}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--card-2)] px-3 py-2.5 text-[15px] outline-none focus:border-[var(--gold)]/50"
              />
              <label className="mt-3 flex items-center gap-2 text-[13px] text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="h-4 w-4 accent-[var(--gold)]"
                />
                Public — anyone can listen
              </label>
              <button
                disabled={busy || !title.trim()}
                className="press mt-3 w-full rounded-xl bg-[var(--gold)] py-2.5 text-[14px] font-bold text-black disabled:opacity-40"
                onClick={create}
              >
                {busy ? "Creating…" : "Create playlist"}
              </button>
            </div>
          )}

          <div className="mt-3">
            {playlists.loading && <SkeletonRows n={3} cover={false} />}
            {playlists.error && !playlists.data && (
              <ErrorState message="Couldn't load your playlists." onRetry={playlists.retry} />
            )}
            {playlists.data && playlists.data.length === 0 && (
              <EmptyState
                icon="🎼"
                title="No playlists yet"
                body="Tap + to create your first mix — Ethiopian classics, Oromo heat, night drive…"
                action={{ label: "New playlist", onClick: () => setCreating(true) }}
              />
            )}
            {playlists.data && playlists.data.length > 0 && (
              <div className="card divide-y divide-white/5 p-1.5">
                {playlists.data.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-2 py-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--card-2)] text-[var(--gold)]">
                      <Icon name="list" className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">{p.title}</p>
                      <p className="text-[12px] text-[var(--muted)]">
                        {p.is_public ? "Public" : "Private"} ·{" "}
                        {new Date(p.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
