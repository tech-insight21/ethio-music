"use client";

import { Plan } from "@/lib/supabase";

interface PremiumViewProps {
  plans: Plan[];
  loading: boolean;
}

export function PremiumView({ plans, loading }: PremiumViewProps) {
  return (
    <div className="space-y-4 px-3 pb-40 pt-3">
      <header className="px-1">
        <h1 className="text-xl font-bold">ETHIO MUSIC Premium</h1>
        <p className="mt-1 text-sm text-[var(--tg-hint)]">
          Support Ethiopian artists directly. Payments via Telebirr & Chapa.
        </p>
      </header>

      {loading && <div className="card h-32 animate-pulse" />}

      {!loading && (
        <div className="space-y-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`card p-4 ${
                plan.code === "premium" ? "ring-2 ring-[var(--tg-accent)]/60" : ""
              }`}
            >
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-base font-bold">
                    {plan.name} {plan.name_am && <span className="text-[var(--tg-hint)]">· {plan.name_am}</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--tg-hint)]">{plan.description}</p>
                </div>
                <p className="shrink-0 pl-3 text-right">
                  <span className="text-lg font-bold text-[var(--tg-accent)]">
                    {plan.price_etb === 0 ? "Free" : `${plan.price_etb} ETB`}
                  </span>
                  {plan.price_etb > 0 && (
                    <span className="block text-[10px] text-[var(--tg-hint)]">
                      / {plan.duration_days} days
                    </span>
                  )}
                </p>
              </div>
              <ul className="mt-2.5 space-y-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-[13px] text-[var(--tg-text)]/90">
                    <span className="text-[var(--tg-green)]">✓</span> {f}
                  </li>
                ))}
              </ul>
              {plan.code !== "free" && (
                <button
                  className="mt-3 w-full rounded-xl bg-[var(--tg-accent)] py-2.5 text-sm font-semibold text-black active:opacity-80"
                  onClick={() => alert("Telebirr / Chapa checkout launches with the payment milestone 🚀")}
                >
                  Subscribe with Telebirr / Chapa
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="px-2 text-center text-[11px] text-[var(--tg-hint)]">
        🔒 Only licensed releases are ever hosted. Royalties are tracked per rights
        holder in the catalog database.
      </p>
    </div>
  );
}
