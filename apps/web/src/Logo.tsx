/**
 * Logo Sorak: tangan terangkat (bersorak) dan wordmark "sorak". Warna tangan dan manset mengikuti tema
 * lewat token --logo-tangan dan --logo-manset (kapur di papan, tinta di kertas).
 * Versi tebal untuk ukuran 28 px ke bawah ada di public/favicon.svg.
 * `animate`: tangan terangkat dan garis sorak muncul lalu memudar, sekali (jawaban benar, podium).
 */
export function Logo({ animate = false }: { animate?: boolean }) {
  return (
    <span className={animate ? "logo logo-animate" : "logo"}>
      <svg className="logo-mark" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <g transform="rotate(-8 64 64)">
          <g className="logo-hand" fill="currentColor">
            <rect x="36" y="22" width="13" height="50" rx="6.5" />
            <rect x="52" y="10" width="13" height="62" rx="6.5" />
            <rect x="68" y="14" width="13" height="58" rx="6.5" />
            <rect x="84" y="26" width="13" height="46" rx="6.5" />
            <path d="M36 56 H97 V80 C97 92 89 99 78 99 H55 C44 99 36 92 36 81 Z" />
            <line x1="42" y1="80" x2="23" y2="58" stroke="currentColor" strokeWidth="13" strokeLinecap="round" />
            <rect className="logo-manset" x="47" y="103" width="40" height="15" rx="4" />
          </g>
        </g>
        {animate && (
          <g className="logo-cheer" strokeWidth="5" strokeLinecap="round">
            <line x1="102" y1="16" x2="110" y2="6" />
            <line x1="106" y1="32" x2="118" y2="28" />
            <line x1="90" y1="6" x2="92" y2="-4" />
          </g>
        )}
      </svg>
      <span className="logo-wordmark">sorak</span>
    </span>
  );
}
