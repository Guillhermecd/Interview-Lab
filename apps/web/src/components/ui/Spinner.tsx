interface SpinnerProps {
  label: string;
}

// The ring alone, for places that already say what is happening.
export function SpinnerRing() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-[11px] w-[11px] shrink-0 animate-spin rounded-full border-[1.6px] border-line-2 border-t-accent"
    />
  );
}

export function Spinner({ label }: SpinnerProps) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-[12.5px] text-text-2">
      <SpinnerRing />
      {label}
    </span>
  );
}
