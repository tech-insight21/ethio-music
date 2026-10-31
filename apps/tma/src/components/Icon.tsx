"use client";

/* Minimal inline icon set (lucide-style strokes) — no icon library weight. */

export type IconName =
  | "home" | "search" | "flame" | "library" | "user"
  | "play" | "pause" | "prev" | "next" | "heart" | "heartFilled"
  | "chevronLeft" | "chevronRight" | "plus" | "share" | "x"
  | "check" | "verified" | "star" | "logout" | "refresh" | "list";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  flame: <path d="M12 3s1 2.4 1 4.2c0 1.6-1.1 2.6-2.4 3.8C9.2 12.4 8 13.9 8 16a4 4 0 0 0 8 0c0-1.2-.5-2.3-1.2-3.2M12 21a7 7 0 0 1-7-7c0-2.5 1.2-4.2 2.5-5.8C8.8 6.5 10 5 10 3" />,
  library: (
    <>
      <path d="M4 5v16M9 5v16" />
      <path d="m13.5 6 4.5 14" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c1.5-3.5 4.2-5 7.5-5s6 1.5 7.5 5" />
    </>
  ),
  play: <path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="4" width="4.2" height="16" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.8" y="4" width="4.2" height="16" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  prev: (
    <>
      <path d="M18 5.5v13L9 12l9-6.5Z" fill="currentColor" stroke="none" />
      <rect x="5" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  next: (
    <>
      <path d="M6 5.5v13L15 12 6 5.5Z" fill="currentColor" stroke="none" />
      <rect x="16.6" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  heart: <path d="M12 20.5s-7.5-4.7-9.3-9C1.2 8 3.2 4.9 6.4 4.9c2 0 3.6 1.1 4.6 2.7h2c1-1.6 2.6-2.7 4.6-2.7 3.2 0 5.2 3.1 3.7 6.6-1.8 4.3-9.3 9-9.3 9Z" />,
  heartFilled: <path d="M12 20.5s-7.5-4.7-9.3-9C1.2 8 3.2 4.9 6.4 4.9c2 0 3.6 1.1 4.6 2.7h2c1-1.6 2.6-2.7 4.6-2.7 3.2 0 5.2 3.1 3.7 6.6-1.8 4.3-9.3 9-9.3 9Z" fill="currentColor" stroke="none" />,
  chevronLeft: <path d="m14.5 5-7 7 7 7" />,
  chevronRight: <path d="m9.5 5 7 7-7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  share: (
    <>
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  verified: (
    <>
      <path
        d="M12 2.5 14.4 4l2.8-.3 1 2.7 2.3 1.7-.9 2.7.9 2.7-2.3 1.7-1 2.7-2.8-.3L12 19.5 9.6 18l-2.8.3-1-2.7-2.3-1.7.9-2.7-.9-2.7L5.8 6.4l1-2.7 2.8.3L12 2.5Z"
        fill="currentColor"
        stroke="none"
      />
      <path d="m8.8 11.2 2.2 2.2 4.4-4.6" stroke="#0b111b" strokeWidth="2" />
    </>
  ),
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />,
  logout: (
    <>
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="m15 8 4 4-4 4M19 12H9" />
    </>
  ),
  refresh: <path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
};

interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className = "h-5 w-5" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
