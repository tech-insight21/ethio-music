/* Deterministic gradient artwork — used until licensed cover art is uploaded.
 * Every entity gets a stable, distinct palette derived from its id/slug. */

const PALETTES: [string, string, string][] = [
  ["#f0b429", "#7c2d12", "Ethiopian gold"],
  ["#1db954", "#022c22", "Highland green"],
  ["#e5484d", "#450a0a", "Fire red"],
  ["#eab308", "#713f12", "Meskel dawn"],
  ["#10b981", "#064e3b", "Jade"],
  ["#f59e0b", "#78350f", "Danakil amber"],
  ["#84cc16", "#365314", "Olive"],
  ["#fb7185", "#4c0519", "Sunset rose"],
];

export function paletteFor(seed: string): { from: string; to: string } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const [from, to] = PALETTES[h % PALETTES.length];
  return { from, to };
}
