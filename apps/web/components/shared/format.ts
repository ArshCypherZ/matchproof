// Intl constructors are slow enough to show up when a queue of records
// formats every cell on one page, so each formatter is built once and
// reused. Currencies in the data are a small closed set; a bad code is
// never cached.
const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string) {
  const cached = currencyFormatters.get(currency);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
  });
  currencyFormatters.set(currency, formatter);
  return formatter;
}

// Times render in one explicit zone so the server payload and the client
// hydration pass agree, and the operator always reads the same clock.
const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export function formatMoney(
  amountMinor: number | null | undefined,
  currency = "INR",
) {
  if (amountMinor == null || !Number.isFinite(amountMinor)) {
    return "Unavailable";
  }
  try {
    return currencyFormatter(currency).format(amountMinor / 100);
  } catch {
    // An unrecognized currency code must not take the page down; show the
    // minor-unit amount with the raw code so the record stays readable.
    return `${amountMinor} ${currency}`;
  }
}

export function formatAge(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "Unavailable";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return dateFormatter.format(date);
}
