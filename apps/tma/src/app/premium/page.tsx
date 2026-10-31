"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { BackendNotice, ErrorState, SkeletonCards } from "@/components/States";
import { useAsyncData, haptic } from "@/lib/telegram";
import { getPlans } from "@/lib/supabase";

export default function PremiumPage() {
  const { data, error, loading, retry } = useAsyncData(() => getPlans(), []);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <main className="page-enter px-3">
      <PageHeader title="Premium" back={false} />

      {/* hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#713f12] via-[#3f2d10] to-[var(--card)] p-5">
        <div
          className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full opacity-25"
          style={{ background: "radial-gradient(circle, var(--gold), transparent 70%)" }}
          aria-hidden
        />
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--gold)]">
          ETHIO MUSIC
        </p>
        <h2 className="mt-1 text-2xl font-extrabold leading-tight">
          ዜማ በሙሉ ·<br />Music without limits
        </h2>
        <p className="mt-2 max-w-[15rem] text-[12.5px] leading-relaxed text-white/75">
          Support Ethiopian artists directly. Every birr flows back to the people
          who make the music.
        </p>
        <div className="mt-3 flex gap-2">
          {["Telebirr", "Chapa"].map((p) => (
            <span
              key={p}
              className="rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-semibold text-white/85"
            >
              {p}
            </span>
          ))}
        </div>
      </div>

      {/* plans — live from the database */}
      <div className="mt-4 space-y-3">
        {loading && <SkeletonCards n={2} />}
        {error && !data && <ErrorState message="Couldn't load plans." onRetry={retry} />}
        {data?.map((plan) => {
          const active = selected === plan.id;
          return (
            <button
              key={plan.id}
              className={`press card block w-full p-4 text-left ${
                plan.code === "premium" ? "ring-1 ring-[var(--gold)]/60" : ""
              } ${active ? "ring-2 ring-[var(--gold)]" : ""}`}
              onClick={() => {
                haptic("light");
                setSelected(plan.id);
              }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-extrabold">
                    {plan.name}
                    {plan.name_am && (
                      <span className="ml-1.5 text-[13px] font-medium text-[var(--muted)]">
                        {plan.name_am}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted)]">
                    {plan.description}
                  </p>
                </div>
                <p className="shrink-0 text-right">
                  <span className="text-lg font-extrabold text-[var(--gold)]">
                    {plan.price_etb === 0 ? "Free" : `${plan.price_etb}`}
                  </span>
                  {plan.price_etb > 0 && (
                    <span className="block text-[10px] text-[var(--muted)]">
                      ETB / {plan.duration_days}d
                    </span>
                  )}
                </p>
              </div>
              <ul className="mt-2.5 space-y-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-[13px]">
                    <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-[var(--green)]" />
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {/* checkout — requires backend: NO fake payments */}
      <div className="mt-5">
        <BackendNotice>
          <p className="font-semibold">Checkout is the one thing we won&apos;t fake.</p>
          <p className="mt-1 leading-relaxed">
            Subscribing requires the payment backend: a Telebirr/Chapa merchant
            account, a payment webhook writing to the <code>payments</code> table,
            and a subscription activation function. Plans above are live from the
            database; activation ships with the payments milestone.
          </p>
        </BackendNotice>
      </div>

      <p className="mt-5 text-center text-[11px] leading-relaxed text-[var(--muted)]">
        🔒 Licensed catalog only. Rights holders are paid from verified play data.
      </p>
    </main>
  );
}
