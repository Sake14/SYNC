import { useId } from "react";
import type { Track } from "@sync/shared";

// Original vector artwork; no remote images or album art downloads.
export function Cover({
  kind = "orbit",
  title,
  className = "",
}: {
  kind?: Track["cover"];
  title: string;
  className?: string;
}) {
  const id = useId();
  const color =
    kind === "bloom" ? "var(--cover-bloom)" : kind === "pulse" ? "var(--cover-pulse)" : "var(--primary)";
  return (
    <div
      className={`cover-art cover-${kind} ${className}`}
      role="img"
      aria-label={`Обложка ${title}`}
    >
      <svg viewBox="0 0 500 500" aria-hidden="true">
        <defs>
          <radialGradient id={`${id}-glow`}>
            <stop stopColor={color} stopOpacity=".65" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#fff" />
            <stop offset=".48" stopColor={color} />
            <stop offset="1" stopColor="var(--cover-ring)" />
          </linearGradient>
        </defs>
        <rect
          width="500"
          height="500"
          fill={
            kind === "bloom"
              ? "var(--cover-background-bloom)"
              : kind === "pulse"
                ? "var(--cover-background-pulse)"
                : "var(--cover-background-orbit)"
          }
        />
        <circle cx="260" cy="260" r="260" fill={`url(#${id}-glow)`} />
        {kind === "bloom" ? (
          Array.from({ length: 8 }, (_, i) => (
            <ellipse
              key={i}
              cx="250"
              cy="250"
              rx="160"
              ry="58"
              fill="none"
              stroke={`url(#${id}-ring)`}
              strokeWidth="2"
              transform={`rotate(${i * 22.5} 250 250)`}
            />
          ))
        ) : kind === "pulse" ? (
          Array.from({ length: 12 }, (_, i) => (
            <rect
              key={i}
              x={90 + i * 12}
              y={90 + i * 12}
              width={320 - i * 24}
              height={320 - i * 24}
              rx="34"
              fill="none"
              stroke={`url(#${id}-ring)`}
              strokeWidth="2"
              transform={`rotate(${i * 4} 250 250)`}
            />
          ))
        ) : (
          <g transform="rotate(-28 250 250)">
            <ellipse
              cx="250"
              cy="250"
              rx="190"
              ry="95"
              fill="none"
              stroke={`url(#${id}-ring)`}
              strokeWidth="28"
            />
            <ellipse
              cx="250"
              cy="250"
              rx="130"
              ry="175"
              fill="none"
              stroke={`url(#${id}-ring)`}
              strokeWidth="2"
            />
            <circle cx="250" cy="250" r="42" fill={color} />
          </g>
        )}
        <path
          d="M20 35H45M32 22V48M455 460H480M468 447V473"
          stroke={color}
          strokeWidth="1"
        />
      </svg>
      <span className="cover-label">
        SYNC ORIGINALS <span>VOL. 01</span>
      </span>
      <span className="cover-title">
        {title}
        <span>sound / together</span>
      </span>
    </div>
  );
}
