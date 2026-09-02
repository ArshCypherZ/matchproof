export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* The accountant's double rule that closes a settled total… */}
      <line
        x1="2.5"
        y1="4.5"
        x2="29.5"
        y2="4.5"
        className="stroke-foreground"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <line
        x1="2.5"
        y1="27.5"
        x2="29.5"
        y2="27.5"
        className="stroke-foreground"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      {/* …and the controller's tick between them: the proof that the
          entry settled. The one red node. */}
      <path
        className="stroke-brand-red"
        d="M10 16.7 L14.8 21.5 L22.8 11.5"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
