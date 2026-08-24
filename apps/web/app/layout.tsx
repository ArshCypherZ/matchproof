import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Payment Incident Commander",
  description: "Evidence-driven payment operations controller",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en"><body>{children}</body></html>
  );
}
