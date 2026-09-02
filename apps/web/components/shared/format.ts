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

// Metric-band formatters are built once: the measured counts on the
// metrics page can reach the thousands, and every band formats at least
// one number.
const countFormat = new Intl.NumberFormat("en-IN");
const percentRound = new Intl.NumberFormat("en-IN", {
  style: "percent",
  maximumFractionDigits: 0,
});
const percentPrecise = new Intl.NumberFormat("en-IN", {
  style: "percent",
  maximumFractionDigits: 1,
});

/* A whole-percent format turns 99.6% into "100%" and 0.4% into "0%" — a
   rounding lie on the exact numbers an operator audits. At either boundary
   keep one decimal, and never round across it: a near-perfect rate floors
   to its last honest tenth (99.96% renders "99.9%") so only a true 100%
   can claim "100%", and a barely-nonzero rate ceils to its first honest
   tenth (0.04% renders "0.1%") so only a true zero reads "0%". A missing
   metric renders "None yet", never "NaN%": the placeholder is a two-word
   state so it wraps at the space at KPI size instead of breaking mid-word
   like a single long token would. */
export function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "None yet";
  const rounded = Math.round(value * 100);
  if (rounded === 100 && value < 1)
    return percentPrecise.format(Math.floor(value * 1000) / 1000);
  if (rounded === 0 && value > 0)
    return percentPrecise.format(Math.ceil(value * 1000) / 1000);
  return rounded === 0 || rounded === 100
    ? percentPrecise.format(value)
    : percentRound.format(value);
}

export function formatCount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "None yet";
  return countFormat.format(value);
}

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
  // A record timestamped slightly in the future (clock skew between the
  // pipeline and the operator's browser) must not read as a negative age.
  const age = Math.max(0, seconds);
  if (age < 60) return `${age}s`;
  if (age < 3600) return `${Math.floor(age / 60)}m`;
  const hours = Math.floor(age / 3600);
  if (hours < 24) return `${hours}h ${Math.floor((age % 3600) / 60)}m`;
  // Past a day the day count is the operator's number; leftover hours keep
  // the age honest at a glance ("2d 3h", never "51h 0m").
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return dateFormatter.format(date);
}
