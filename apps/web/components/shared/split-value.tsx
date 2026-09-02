/* A fintech figure (advise 25): the whole-number part carries the
   magnitude, the fractional part renders smaller and quieter beside it —
   "99.6%" reads as 99 with a .6 tail, not one undifferentiated string.
   Splits a formatted figure at its decimal separator; anything without a
   decimal tail (integers, "None yet") renders untouched. A figure below
   one ("0.85") also passes through whole: its integer part is a constant
   zero, so splitting would print the noise large and demote every digit
   that carries the value. */
export function SplitValue({ value }: { value: string }) {
  // Group 1: everything up to the last digit before the decimal point
  // (keeps currency symbols and Indian grouping commas with the whole
  // part — a grouping comma is never a decimal, so only "." splits);
  // group 2: the decimal tail; group 3: trailing non-digits such as "%".
  const match = value.match(/^(.*\d)(\.\d+)(\D*)$/);
  if (!match) return <>{value}</>;
  const [, whole, fraction, suffix] = match;
  // The split earns its keep only when the whole part has magnitude: a
  // single "0" (or "-0") means the fraction is the entire signal.
  if (/^-?0$/.test(whole)) return <>{value}</>;
  return (
    <>
      {whole}
      <span className="figure-fraction">
        {fraction}
        {suffix}
      </span>
    </>
  );
}
