import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { AppHeader } from "@/components/app/app-header";
import { AppFooter } from "@/components/app/app-footer";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f6f3",
};

/* og:* meta URLs resolve against this base; without it Next anchors them
   to localhost. The deployed console is the default; SITE_URL overrides
   it for other environments. */
const siteUrl = process.env.SITE_URL ?? "https://matchproof.arshjaved.in";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Matchproof",
    template: "%s | Matchproof",
  },
  description:
    "Fixes orders left unpaid after a successful Razorpay payment: finds the captured payment, updates the merchant order, checks both records agree.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} font-sans`}
    >
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main-content"
          className="focus-ring sr-only fixed left-4 top-4 z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only"
        >
          Skip to main content
        </a>
        <AppHeader />
        {children}
        <AppFooter />
      </body>
    </html>
  );
}
