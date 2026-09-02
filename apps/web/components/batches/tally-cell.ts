// A summary strip cell: one count on a tonal surface. Every cell is a
// count — the started time moved to the page header as metadata, because
// one timestamp among five counts broke the pattern the strip teaches.
// Dividers come from the strip's own grid: the container lays its cells
// on `gap-px bg-border` and each cell paints `bg-surface`, so a hairline
// emerges only between adjacent cells at every breakpoint — no
// nth-child border juggling for the 2/3/5 column steps, and no spurious
// rules when the compiled class order shifts. Shared by the batch view
// and its loading shell so the streamed page lands on the same geometry
// at every width.
export const tallyCell = "bg-surface px-4 py-4";
