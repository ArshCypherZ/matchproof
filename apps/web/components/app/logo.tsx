export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="24 144 462 232"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* The agreed entry: two ledger rules that match… */}
      <rect
        className="fill-foreground"
        x="32"
        y="152"
        width="192"
        height="72"
      />
      <rect
        className="fill-foreground"
        x="32"
        y="296"
        width="192"
        height="72"
      />
      {/* …and the controller's tick that proves it. The one red node. */}
      <path
        className="stroke-brand-red"
        d="M296 252 L352 328 L444 190"
        strokeWidth="68"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
