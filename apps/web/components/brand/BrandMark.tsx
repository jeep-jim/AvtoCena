type BrandMarkProps = {
  className?: string;
};

export function BrandMark({ className = "h-10 w-10" }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={`ac-brand-mark ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="avtocena-mark-clip">
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>

      <g clipPath="url(#avtocena-mark-clip)">
        <rect x="0" y="0" width="32" height="32" fill="var(--ac-mark-panel, #FFFFFF)" />
        <rect x="32" y="0" width="32" height="32" fill="var(--ac-mark-panel, #FFFFFF)" />
        <rect x="0" y="32" width="32" height="32" fill="var(--ac-mark-panel, #FFFFFF)" />
        <rect x="32" y="32" width="32" height="32" fill="#F2363F" />

        <line x1="32" y1="0" x2="32" y2="64" stroke="var(--ac-mark-divider, #111111)" strokeWidth="1" />
        <line x1="0" y1="32" x2="64" y2="32" stroke="var(--ac-mark-divider, #111111)" strokeWidth="1" />

        <rect x="10" y="14" width="14" height="4" rx="1" fill="var(--ac-mark-symbol, #202020)" />
        <rect x="15" y="9" width="4" height="14" rx="1" fill="var(--ac-mark-symbol, #202020)" />
        <rect x="42" y="14" width="14" height="4" rx="1" fill="var(--ac-mark-symbol, #202020)" />
        <rect x="10" y="43" width="14" height="4" rx="1" fill="var(--ac-mark-symbol, #202020)" />
        <rect x="10" y="51" width="14" height="4" rx="1" fill="var(--ac-mark-symbol, #202020)" />
      </g>
    </svg>
  );
}
