import React from 'react';
import { cn } from '../../lib/utils';

export interface OrbitalLoadingRingProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
  speed?: number;
  variant?: 'default' | 'dense' | 'minimal';
  label?: string;
}

export const OrbitalLoadingRing: React.FC<OrbitalLoadingRingProps> = ({
  size = 72,
  speed = 1,
  variant = 'default',
  label = 'Loading',
  className,
  style,
  ...props
}) => {
  const durationOuter = `${2.4 / speed}s`;
  const durationInner = `${1.6 / speed}s`;
  const durationCenter = `${1.2 / speed}s`;

  return (
    <div
      role="status"
      aria-label={label}
      className={cn('relative inline-flex items-center justify-center text-foreground select-none', className)}
      style={{ width: size, height: size, ...style }}
      {...props}
    >
      <style>{`
        @keyframes easyui-orbit-cw {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes easyui-orbit-ccw {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        @keyframes easyui-orbit-glow-pulse {
          0%, 100% { opacity: 0.6; transform: scale(0.96); }
          50% { opacity: 1; transform: scale(1.04); }
        }
        @media (prefers-reduced-motion: reduce) {
          .easyui-orbit-spin-cw,
          .easyui-orbit-spin-ccw,
          .easyui-orbit-core-pulse { animation: none !important; }
        }
      `}</style>
      <span className="sr-only">{label}</span>

      {/* Static Subdued Background Tracks */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="50" cy="50" r="44" stroke="#282828" strokeWidth="1.5" strokeDasharray="3 3" />
        <circle cx="50" cy="50" r="30" stroke="#333333" strokeWidth="1.5" />
      </svg>

      {/* Outer Orbit Track & Glowing Satellite */}
      <div
        className="easyui-orbit-spin-cw pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{ animation: `easyui-orbit-cw ${durationOuter} linear infinite` }}
      >
        <span
          className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-[#5865F2] shadow-[0_0_10px_2px_rgba(88,101,242,0.45)]"
        />
        {variant !== 'minimal' && (
          <span
            className="absolute -bottom-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white/40"
          />
        )}
      </div>

      {/* Inner Counter-Rotating Orbit */}
      <div
        className="easyui-orbit-spin-ccw pointer-events-none absolute inset-[18%] flex items-center justify-center"
        style={{ animation: `easyui-orbit-ccw ${durationInner} cubic-bezier(0.4, 0, 0.2, 1) infinite` }}
      >
        <span
          className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-zinc-300 shadow-[0_0_8px_rgba(255,255,255,0.4)]"
        />
        {variant === 'dense' && (
          <span
            className="absolute top-1/2 -right-1 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-zinc-400/50"
          />
        )}
      </div>

      {/* Central Pulsing Core */}
      <div
        className="easyui-orbit-core-pulse h-3 w-3 rounded-full bg-[#5865F2] shadow-[0_0_12px_rgba(88,101,242,0.45)]"
        style={{ animation: `easyui-orbit-glow-pulse ${durationCenter} ease-in-out infinite` }}
      />
    </div>
  );
};

