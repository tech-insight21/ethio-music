import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { AppProviders } from "@/components/AppProviders";

export const metadata: Metadata = {
  title: "ETHIO MUSIC",
  description:
    "Ethiopia's music streaming mini app — Amharic, Oromo, Tigrinya & English. Licensed releases only.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0b111b",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {/* Telegram Mini Apps SDK — loaded before hydration so initData is present */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <AppProviders>
          <div className="app-shell border-x border-[var(--border)]">{children}</div>
        </AppProviders>
      </body>
    </html>
  );
}
