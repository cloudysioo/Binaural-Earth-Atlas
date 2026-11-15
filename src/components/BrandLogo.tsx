import React from 'react';

interface BrandLogoProps {
  size?: number;
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 34, className = '' }) => {
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
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="52%" stopColor="#2DD4BF" />
          <stop offset="100%" stopColor="#5EEAD4" />
        </linearGradient>
        <radialGradient id="beaGlobeGlow" cx="42%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.48" />
          <stop offset="55%" stopColor="#0EA5E9" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#060B14" stopOpacity="0.92" />
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
        fill="#060B14"
        stroke="url(#beaLogoGrad)"
        strokeWidth="2.5"
      />

      {/* Outer Binaural Acoustic Wave Arcs */}
      <path
        d="M 21 44 A 48 48 0 0 0 21 88"
        stroke="#38BDF8"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.88"
      />
      <path
        d="M 14 51 A 55 55 0 0 0 14 81"
        stroke="#38BDF8"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.52"
      />
      <path
        d="M 107 44 A 48 48 0 0 1 107 88"
        stroke="#5EEAD4"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.88"
      />
      <path
        d="M 114 51 A 55 55 0 0 1 114 81"
        stroke="#5EEAD4"
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
      <circle cx="64" cy="25" r="2.3" fill="#5EEAD4" />
      <circle cx="64" cy="107" r="2.3" fill="#38BDF8" />
      <circle cx="36" cy="36" r="2" fill="#38BDF8" opacity="0.9" />
      <circle cx="92" cy="96" r="2" fill="#5EEAD4" opacity="0.9" />

      {/* Headphone Headband Arc */}
      <path
        d="M 27 64 A 37 37 0 0 1 101 64"
        stroke="url(#beaLogoGrad)"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      <path
        d="M 32 54 A 34 34 0 0 1 96 54"
        stroke="#E0F2FE"
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
        fill="#0B1320"
        stroke="#38BDF8"
        strokeWidth="2.4"
      />
      <rect x="29" y="58" width="4" height="16" rx="1.5" fill="#38BDF8" opacity="0.88" />
      <rect
        x="97"
        y="54"
        width="10"
        height="24"
        rx="4"
        fill="#0B1320"
        stroke="#5EEAD4"
        strokeWidth="2.4"
      />
      <rect x="95" y="58" width="4" height="16" rx="1.5" fill="#5EEAD4" opacity="0.88" />

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
          stroke="#7DD3FC"
          strokeWidth="0.95"
          opacity="0.45"
        />
        <line x1="64" y1="36" x2="64" y2="96" stroke="#7DD3FC" strokeWidth="0.95" opacity="0.45" />
        <line x1="34" y1="66" x2="94" y2="66" stroke="#7DD3FC" strokeWidth="0.95" opacity="0.5" />
        <path
          d="M 36 52 Q 64 56 92 52"
          stroke="#7DD3FC"
          strokeWidth="0.9"
          opacity="0.42"
          fill="none"
        />
        <path
          d="M 36 80 Q 64 76 92 80"
          stroke="#7DD3FC"
          strokeWidth="0.9"
          opacity="0.42"
          fill="none"
        />

        {/* Americas & Afro-Eurasia Silhouettes */}
        <path
          d="M 41 42 L 52 40 L 56 46 L 52 54 L 46 57 L 43 62 L 49 67 L 54 73 L 50 85 L 44 89 L 42 78 L 40 67 L 37 56 Z"
          fill="#38BDF8"
          fillOpacity="0.54"
          stroke="#BAE6FD"
          strokeWidth="1"
        />
        <path
          d="M 67 42 L 82 40 L 89 48 L 84 55 L 74 56 L 68 51 Z"
          fill="#5EEAD4"
          fillOpacity="0.54"
          stroke="#CCFBF1"
          strokeWidth="1"
        />
        <path
          d="M 69 59 L 83 59 L 90 67 L 85 78 L 78 86 L 73 79 L 70 69 Z"
          fill="#5EEAD4"
          fillOpacity="0.56"
          stroke="#CCFBF1"
          strokeWidth="1"
        />

        {/* Acoustic Ping Target */}
        <circle cx="77" cy="73" r="6.5" stroke="#CCFBF1" strokeWidth="1" opacity="0.78" />
        <circle cx="77" cy="73" r="2.2" fill="#CCFBF1" />
      </g>
    </svg>
  );
};
