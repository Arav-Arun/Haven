// The hero's sky: clouds drawn in SVG (turbulence pushes soft white shapes around), so nothing loads from elsewhere.

const SPARKS: [number, number, number][] = [
  [14, 22, 0],
  [27, 9, 1.2],
  [71, 14, 0.6],
  [83, 31, 2.1],
  [62, 7, 2.8],
  [38, 18, 1.7],
  [90, 12, 3.3],
  [8, 40, 2.4],
];

export function Clouds() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {SPARKS.map(([x, y, d]) => (
        <span
          key={`${x}-${y}`}
          className="spark absolute size-1 rounded-full bg-white shadow-[0_0_10px_3px_rgb(255_255_255_/_0.7)]"
          style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` }}
        />
      ))}
      {/* On wide screens "slice" crops the top of the drawing, which would cut the blurred clouds in a straight line:
          the mask fades that edge out. */}
      <svg
        className="absolute inset-x-0 bottom-0 h-[78%] w-full mask-[linear-gradient(to_bottom,transparent,#000_35%)]"
        viewBox="0 0 1200 700"
        preserveAspectRatio="xMidYMax slice"
      >
        <defs>
          <filter id="cloud-far" x="-20%" y="-40%" width="140%" height="180%">
            <feTurbulence type="fractalNoise" baseFrequency="0.009" numOctaves="4" seed="7" />
            <feDisplacementMap in="SourceGraphic" scale="120" />
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id="cloud-near" x="-20%" y="-40%" width="140%" height="180%">
            <feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="5" seed="3" />
            <feDisplacementMap in="SourceGraphic" scale="150" />
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <linearGradient id="cloud-shade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#dfe9fb" />
          </linearGradient>
        </defs>
        <g filter="url(#cloud-far)" opacity="0.75" fill="#f4f8ff">
          <ellipse cx="120" cy="300" rx="230" ry="80" />
          <ellipse cx="1090" cy="270" rx="240" ry="90" />
          <ellipse cx="600" cy="330" rx="300" ry="60" />
        </g>
        <g filter="url(#cloud-near)" fill="url(#cloud-shade)">
          <ellipse cx="80" cy="470" rx="280" ry="130" />
          <ellipse cx="330" cy="520" rx="260" ry="110" />
          <ellipse cx="600" cy="500" rx="330" ry="120" />
          <ellipse cx="880" cy="520" rx="270" ry="115" />
          <ellipse cx="1130" cy="460" rx="270" ry="140" />
          <rect x="-100" y="560" width="1400" height="200" />
        </g>
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-b from-transparent via-white/70 to-white" />
    </div>
  );
}

/** A low bank of cloud drawn in front of the tickets, so they look like they're rising out of it. */
export function FrontClouds() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute -bottom-16 left-1/2 z-20 h-[200px] w-[1500px] max-w-none -translate-x-1/2 [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]"
      viewBox="0 0 1500 200"
      preserveAspectRatio="none"
    >
      <defs>
        <filter id="cloud-front" x="-10%" y="-60%" width="120%" height="220%">
          <feTurbulence type="fractalNoise" baseFrequency="0.016" numOctaves="5" seed="11" />
          <feDisplacementMap in="SourceGraphic" scale="90" />
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <linearGradient id="cloud-front-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#eef4fe" />
        </linearGradient>
      </defs>
      <g filter="url(#cloud-front)" fill="url(#cloud-front-shade)" opacity="0.96">
        <ellipse cx="420" cy="140" rx="230" ry="62" />
        <ellipse cx="640" cy="150" rx="210" ry="55" />
        <ellipse cx="860" cy="145" rx="220" ry="60" />
        <ellipse cx="1080" cy="140" rx="230" ry="62" />
        <ellipse cx="200" cy="165" rx="220" ry="50" />
        <ellipse cx="1300" cy="165" rx="220" ry="50" />
      </g>
    </svg>
  );
}
