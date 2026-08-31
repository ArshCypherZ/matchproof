import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { cn } from "@/lib/utils";
import { AppHeader } from "@/components/app/app-header";
import { AppFooter } from "@/components/app/app-footer";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  weight: "400",
});

const themeScript = `(function(){try{var root=document.documentElement;var stored=localStorage.getItem("app-theme");var theme=stored==="dark"||stored==="light"?stored:window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";root.classList.remove("light","dark");root.classList.add(theme)}catch(error){}})()`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
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
      suppressHydrationWarning
      className={cn(
        "light font-sans",
        geist.variable,
        geistMono.variable,
        instrumentSerif.variable,
      )}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
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
