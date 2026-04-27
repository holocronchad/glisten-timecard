// Cloud backdrop matching the Prisma reference: a looping mp4 of soft
// drifting cloud atmospherics, with a fractal-noise overlay (mix-blend
// overlay) and a vignette so the frosted PIN keys read on top.

export default function CloudBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden bg-ink"
    >
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-cover"
        src="/clouds.mp4"
      />

      {/* Subtle gradient pulling top + bottom toward black so headlines + footer read */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(10,10,10,0.45) 0%, rgba(10,10,10,0.0) 25%, rgba(10,10,10,0.0) 70%, rgba(10,10,10,0.65) 100%)',
        }}
      />

      {/* Fractal-noise overlay — same SVG as the global noise utility but stronger */}
      <div
        className="absolute inset-0 opacity-[0.55] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.7 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
        }}
      />
    </div>
  );
}
