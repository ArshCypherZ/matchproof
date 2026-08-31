# Font files

Static TTF instances used only by `app/opengraph-image.tsx` (the satori
renderer behind `next/og` cannot read the woff2 files `next/font/google`
caches). They were instanced from the Google Fonts latin subsets of:

- **Geist** (400, 600) — SIL Open Font License 1.1
- **Geist Mono** (500) — SIL Open Font License 1.1
- **Instrument Serif** (400) — SIL Open Font License 1.1

Licenses: https://github.com/vercel/geist-font and
https://github.com/pxlpt/Instrument-Serif (see OFL-1.1 at
https://openfontlicense.org/open-font-license-official-text/).

The app itself still loads these families through `next/font/google` in
`app/layout.tsx`; nothing here affects the running UI.
