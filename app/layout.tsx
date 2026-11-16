import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

// Nonce-bearing CSP headers are generated per request. Static HTML cannot
// contain the matching nonce on framework scripts, so every page is dynamic.
export const dynamic = "force-dynamic";

const figtree = Figtree({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-figtree",
});

export const metadata: Metadata = {
  title: { default: "Keymint", template: "%s | Keymint" },
  description: "A self-hosted password vault with application-level encryption.",
  icons: { icon: "/logo.png", apple: "/logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={figtree.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
