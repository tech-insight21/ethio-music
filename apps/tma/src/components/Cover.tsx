"use client";

import { paletteFor } from "@/lib/covers";

interface CoverProps {
  seed: string;
  imageUrl?: string | null;
  alt?: string;
  className?: string;
  rounded?: string;
  icon?: "note" | "artist" | "album" | "playlist";
}

const ICONS: Record<string, React.ReactNode> = {
  note: (
    <path
      d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  artist: (
    <>
      <circle cx="12" cy="8" r="4" fill="currentColor" stroke="none" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" fill="currentColor" stroke="none" />
    </>
  ),
  album: (
    <>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="17" cy="7" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  playlist: (
    <>
      <path d="M4 6h10M4 11h10M4 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="17.5" cy="16" r="2.6" fill="currentColor" stroke="none" />
      <path d="M20.1 16V8.2l1.9-.6V10" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </>
  ),
};

export function Cover({ seed, imageUrl, alt = "", className = "", rounded = "rounded-xl", icon = "note" }: CoverProps) {
  const { from, to } = paletteFor(seed);
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={alt}
        loading="lazy"
        className={`object-cover bg-[var(--card-2)] ${rounded} ${className}`}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={alt || "artwork"}
      className={`relative overflow-hidden ${rounded} ${className}`}
      style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
    >
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          background:
            "radial-gradient(circle at 78% 22%, rgba(255,255,255,0.85) 0, transparent 34%), radial-gradient(circle at 20% 85%, rgba(255,255,255,0.4) 0, transparent 30%)",
        }}
      />
      <svg
        viewBox="0 0 24 24"
        className="absolute right-1.5 bottom-1.5 h-[38%] w-[38%] text-white/45"
        aria-hidden
      >
        {ICONS[icon]}
      </svg>
      <span className="absolute left-1.5 top-1 select-none text-[9px] font-black tracking-widest text-white/50">
        ETHIO
      </span>
    </div>
  );
}
