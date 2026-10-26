/** The mark: a mini treemap, same geometry as assets/favicon.svg. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ flex: "none" }} aria-hidden>
      <rect x="0" y="0" width="17" height="32" rx="3" fill="#3f86e0" />
      <rect x="19" y="0" width="13" height="18" rx="3" fill="#d9577f" />
      <rect x="19" y="20" width="7" height="12" rx="2.5" fill="#e3a12f" />
      <rect x="28" y="20" width="4" height="12" rx="1.5" fill="#33a573" />
    </svg>
  );
}
