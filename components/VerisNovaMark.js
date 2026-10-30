import Image from "next/image";

/* VerisNova enterprise mark, swapped by theme in CSS (globals.css) rather than
   in JS so the right variant paints on first load with no hydration flash:
   - dark theme (default): white + teal mark on its own navy tile
   - light theme: navy + teal mark on a transparent ground */
export default function VerisNovaMark({ className = "" }) {
  return (
    <span aria-hidden="true" className={`hv-brand-mark relative inline-block ${className}`.trim()}>
      <Image
        src="/verisnova-logo-dark.png"
        alt=""
        width={512}
        height={512}
        priority
        className="hv-brand-mark-dark h-full w-full object-contain"
      />
      <Image
        src="/verisnova-logo-light.png"
        alt=""
        width={512}
        height={512}
        priority
        className="hv-brand-mark-light h-full w-full object-contain"
      />
    </span>
  );
}
