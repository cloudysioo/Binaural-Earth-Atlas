import React from 'react';

interface BrandLogoProps {
  size?: number;
  className?: string;
  nightMode?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 34,
  className = '',
  nightMode = false,
}) => {
  const cStart = nightMode ? '#B91C1C' : '#38BDF8';
  const cMid = nightMode ? '#DC2626' : '#2DD4BF';
  const cEnd = nightMode ? '#FF3B30' : '#5EEAD4';
  const cBg = nightMode ? '#070102' : '#060B14';
  const cCup = nightMode ? '#100305' : '#0B1320';
  const cHighlight = nightMode ? '#FF6B4A' : '#E0F2FE';
  const cLandStroke = nightMode ? '#FF5C58' : '#BAE6FD';
  const cLandEast = nightMode ? '#FF3B30' : '#CCFBF1';
  const cGrid = nightMode ? '#DC2626' : '#7DD3FC';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id="beaLogoGrad" x1="12" y1="64" x2="116" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={cStart} />
          <stop offset="52%" stopColor={cMid} />
          <stop offset="100%" stopColor={cEnd} />
        </linearGradient>
        <radialGradient id="beaGlobeGlow" cx="42%" cy="38%" r="62%">
          <stop offset="0%" stopColor={cStart} stopOpacity={nightMode ? '0.32' : '0.48'} />
          <stop offset="55%" stopColor={cMid} stopOpacity={nightMode ? '0.16' : '0.22'} />
          <stop offset="100%" stopColor={cBg} stopOpacity="0.94" />
        </radialGradient>
        <clipPath id="beaGlobeClip">
          <circle cx="64" cy="66" r="30" />
        </clipPath>
      </defs>

      {/* Emblem Frame */}
      <rect
        x="6"
        y="6"
        width="116"
        height="116"
        rx="22"
        fill={cBg}
        stroke="url(#beaLogoGrad)"
        strokeWidth="2.5"
      />

      {/* Outer Binaural Acoustic Wave Arcs */}
      <path
        d="M 21 44 A 48 48 0 0 0 21 88"
        stroke={cStart}
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.88"
      />
      <path
        d="M 14 51 A 55 55 0 0 0 14 81"
        stroke={cStart}
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.52"
      />
      <path
        d="M 107 44 A 48 48 0 0 1 107 88"
        stroke={cEnd}
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.88"
      />
      <path
        d="M 114 51 A 55 55 0 0 1 114 81"
        stroke={cEnd}
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.52"
      />

      {/* Orbital Telemetry Track & Nodes */}
      <circle
        cx="64"
        cy="66"
        r="41"
        stroke="url(#beaLogoGrad)"
        strokeWidth="1.3"
        strokeDasharray="3 4"
        opacity="0.65"
      />
      <circle cx="64" cy="25" r="2.3" fill={cEnd} />
      <circle cx="64" cy="107" r="2.3" fill={cStart} />
      <circle cx="36" cy="36" r="2" fill={cStart} opacity="0.9" />
      <circle cx="92" cy="96" r="2" fill={cEnd} opacity="0.9" />

      {/* Headphone Headband Arc */}
      <path
        d="M 27 64 A 37 37 0 0 1 101 64"
        stroke="url(#beaLogoGrad)"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      <path
        d="M 32 54 A 34 34 0 0 1 96 54"
        stroke={cHighlight}
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.72"
      />

      {/* Left & Right Binaural Earcups */}
      <rect
        x="21"
        y="54"
        width="10"
        height="24"
        rx="4"
        fill={cCup}
        stroke={cStart}
        strokeWidth="2.4"
      />
      <rect x="29" y="58" width="4" height="16" rx="1.5" fill={cStart} opacity="0.88" />
      <rect
        x="97"
        y="54"
        width="10"
        height="24"
        rx="4"
        fill={cCup}
        stroke={cEnd}
        strokeWidth="2.4"
      />
      <rect x="95" y="58" width="4" height="16" rx="1.5" fill={cEnd} opacity="0.88" />

      {/* Central Earth Globe */}
      <circle
        cx="64"
        cy="66"
        r="30"
        fill="url(#beaGlobeGlow)"
        stroke="url(#beaLogoGrad)"
        strokeWidth="2.2"
      />

      <g clipPath="url(#beaGlobeClip)">
        <ellipse
          cx="64"
          cy="66"
          rx="15"
          ry="30"
          stroke={cGrid}
          strokeWidth="0.95"
          opacity="0.45"
        />
        <line x1="64" y1="36" x2="64" y2="96" stroke={cGrid} strokeWidth="0.95" opacity="0.45" />
        <line x1="34" y1="66" x2="94" y2="66" stroke={cGrid} strokeWidth="0.95" opacity="0.5" />
        <path
          d="M 36 52 Q 64 56 92 52"
          stroke={cGrid}
          strokeWidth="0.9"
          opacity="0.42"
          fill="none"
        />
        <path
          d="M 36 80 Q 64 76 92 80"
          stroke={cGrid}
          strokeWidth="0.9"
          opacity="0.42"
          fill="none"
        />

        {/* Americas & Afro-Eurasia Silhouettes */}
        <path
          d="M 41 42 L 52 40 L 56 46 L 52 54 L 46 57 L 43 62 L 49 67 L 54 73 L 50 85 L 44 89 L 42 78 L 40 67 L 37 56 Z"
          fill={cStart}
          fillOpacity="0.54"
          stroke={cLandStroke}
          strokeWidth="1"
        />
        <path
          d="M 67 42 L 82 40 L 89 48 L 84 55 L 74 56 L 68 51 Z"
          fill={cEnd}
          fillOpacity="0.54"
          stroke={cLandEast}
          strokeWidth="1"
        />
        <path
          d="M 69 59 L 83 59 L 90 67 L 85 78 L 78 86 L 73 79 L 70 69 Z"
          fill={cEnd}
          fillOpacity="0.56"
          stroke={cLandEast}
          strokeWidth="1"
        />

        {/* Acoustic Ping Target */}
        <circle cx="77" cy="73" r="6.5" stroke={cLandEast} strokeWidth="1" opacity="0.78" />
        <circle cx="77" cy="73" r="2.2" fill={cLandEast} />
      </g>
    </svg>
  );
};
