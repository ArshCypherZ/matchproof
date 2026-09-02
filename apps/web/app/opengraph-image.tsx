import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt =
  "Matchproof: orders left unpaid after a successful payment, found, fixed, and proven.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* The mark in fixed ink-on-paper palette (printed artifact): the
   accountant's double rule that closes a settled total, with the
   controller's red proof tick between. */
const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="232" height="232"><line x1="2.5" y1="4.5" x2="29.5" y2="4.5" stroke="#181715" stroke-width="3.4" stroke-linecap="round"/><line x1="2.5" y1="27.5" x2="29.5" y2="27.5" stroke="#181715" stroke-width="3.4" stroke-linecap="round"/><path d="M10 16.7 L14.8 21.5 L22.8 11.5" stroke="#e74432" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
const markSrc = `data:image/svg+xml;base64,${Buffer.from(markSvg).toString("base64")}`;

const fonts = Promise.all([
  readFile(join(process.cwd(), "assets/fonts/Geist-400.ttf")),
  readFile(join(process.cwd(), "assets/fonts/Geist-600.ttf")),
  readFile(join(process.cwd(), "assets/fonts/GeistMono-500.ttf")),
  readFile(join(process.cwd(), "assets/fonts/InstrumentSerif-400.ttf")),
]).then(([geist400, geist600, geistMono500, instrumentSerif400]) => [
  {
    name: "Geist",
    data: geist400,
    style: "normal" as const,
    weight: 400 as const,
  },
  {
    name: "Geist",
    data: geist600,
    style: "normal" as const,
    weight: 600 as const,
  },
  {
    name: "GeistMono",
    data: geistMono500,
    style: "normal" as const,
    weight: 500 as const,
  },
  {
    name: "InstrumentSerif",
    data: instrumentSerif400,
    style: "normal" as const,
    weight: 400 as const,
  },
]);

export default async function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#f2eee5",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        padding: 72,
      }}
    >
      {/* Lockup: label, mark, wordmark, the ledger's double rule, the pitch. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          width: 720,
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: "GeistMono",
            fontSize: 20,
            fontWeight: 500,
            letterSpacing: 5,
            color: "#625f59",
            whiteSpace: "nowrap",
          }}
        >
          RAZORPAY BUILATHON · AI FINANCE CONTROLLER
        </div>

        <img
          src={markSrc}
          alt=""
          width={116}
          height={116}
          style={{ marginTop: 36 }}
        />

        <div
          style={{
            display: "flex",
            fontFamily: "Geist",
            fontWeight: 600,
            fontSize: 100,
            letterSpacing: -3,
            color: "#181715",
            marginTop: 28,
          }}
        >
          Matchproof
        </div>

        {/* The accountant's double rule that closes a settled total. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 560,
            marginTop: 24,
          }}
        >
          <div style={{ height: 3, background: "#181715" }} />
          <div style={{ height: 9 }} />
          <div style={{ height: 3, background: "#181715" }} />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontFamily: "Geist",
            fontSize: 26,
            color: "#625f59",
            maxWidth: 640,
            marginTop: 24,
            lineHeight: 1.55,
          }}
        >
          Orders left unpaid after a successful payment: found, fixed, and
          proven.
        </div>
      </div>

      {/* The terminal-state stamp: dried-ink red, pressed slightly askew. */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flex: 1,
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: "InstrumentSerif",
            fontSize: 38,
            letterSpacing: 8,
            color: "#b8301f",
            border: "3px solid #b8301f",
            borderRadius: 4,
            paddingTop: 12,
            paddingBottom: 16,
            paddingLeft: 22,
            paddingRight: 30,
            whiteSpace: "nowrap",
            transform: "rotate(-3deg)",
          }}
        >
          VERIFIED
        </div>
      </div>
    </div>,
    { ...size, fonts: await fonts },
  );
}
