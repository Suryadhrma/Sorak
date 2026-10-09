/**
 * Logo Sorak: tangan terangkat (bersorak) dan wordmark "sorak". Warna tangan dan manset mengikuti tema
 * lewat token --logo-tangan dan --logo-manset (kapur di papan, tinta di kertas).
 * Versi tebal untuk ukuran 28 px ke bawah ada di public/favicon.svg.
 */
export function Logo() {
  return (
    <span className="logo">
      <svg className="logo-mark" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <g transform="rotate(-8 64 64)" fill="currentColor">
          <rect x="36" y="22" width="13" height="50" rx="6.5" />
          <rect x="52" y="10" width="13" height="62" rx="6.5" />
          <rect x="68" y="14" width="13" height="58" rx="6.5" />
          <rect x="84" y="26" width="13" height="46" rx="6.5" />
          <path d="M36 56 H97 V80 C97 92 89 99 78 99 H55 C44 99 36 92 36 81 Z" />
          <line x1="42" y1="80" x2="23" y2="58" stroke="currentColor" strokeWidth="13" strokeLinecap="round" />
          <rect className="logo-manset" x="47" y="103" width="40" height="15" rx="4" />
        </g>
      </svg>
      <span className="logo-wordmark">sorak</span>
    </span>
  );
}
