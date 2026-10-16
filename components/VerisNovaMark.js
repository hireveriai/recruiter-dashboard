/* Small-size VerisNova mark: the head-and-checkmark from the full logo with the
   circuit detail reduced to one node, drawn on a 32-unit grid with strokes that
   stay at least ~1.5px wide in the 36px navbar tile. It inherits currentColor,
   so the brand blue comes from CSS (.hv-brand-mark) and follows the theme
   without swapping images. Keep the detailed PNGs for large placements. */
export default function VerisNovaMark({ className = "" }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        strokeWidth="2"
        d="M9.6 30 L10.4 25 C6.6 23 4 19 4 14.6 C4 8.2 9.2 3.5 15.6 3.5 C21.4 3.5 26 7.6 26.2 13 L28.6 17.4 C28.8 17.9 28.6 18.3 28.1 18.4 L26.6 18.8 L26.4 21.6 C26.3 23 25.3 23.8 24 23.8 L22.4 23.8 C21.6 23.8 21 24.4 20.9 25.2 L20.4 30"
      />
      <path strokeWidth="2.6" d="M10.4 14.4 L13.9 17.8 L20 11.2" />
      <circle cx="21.2" cy="9.9" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
