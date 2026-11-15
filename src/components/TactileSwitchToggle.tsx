import React from 'react';

export type TactileToggleAccent = 'mint' | 'amber' | 'coral';

interface TactileSwitchToggleProps {
  checked: boolean;
  onToggle: () => void;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  accent?: TactileToggleAccent;
  title?: string;
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
}

const ACCENT_STYLES: Record<
  TactileToggleAccent,
  {
    activeContainer: string;
    activeText: string;
    activeTrack: string;
    activeThumb: string;
    hoverBorder: string;
  }
> = {
  mint: {
    activeContainer:
      'bg-[var(--bg-panel)] border-[var(--accent-mint)] text-[var(--text-primary)]',
    activeText: 'text-[var(--accent-mint)]',
    activeTrack: 'border-[var(--accent-mint)] bg-[var(--bg-obsidian)]',
    activeThumb: 'bg-[var(--accent-mint)]',
    hoverBorder: 'hover:border-[var(--accent-mint)]',
  },
  amber: {
    activeContainer:
      'bg-[var(--bg-panel)] border-[var(--accent-amber)] text-[var(--text-primary)]',
    activeText: 'text-[var(--accent-amber)]',
    activeTrack: 'border-[var(--accent-amber)] bg-[var(--bg-obsidian)]',
    activeThumb: 'bg-[var(--accent-amber)]',
    hoverBorder: 'hover:border-[var(--accent-amber)]',
  },
  coral: {
    activeContainer:
      'bg-[var(--bg-panel)] border-[var(--accent-coral)] text-[var(--text-primary)]',
    activeText: 'text-[var(--accent-coral)]',
    activeTrack: 'border-[var(--accent-coral)] bg-[var(--bg-obsidian)]',
    activeThumb: 'bg-[var(--accent-coral)]',
    hoverBorder: 'hover:border-[var(--accent-coral)]',
  },
};

export const TactileSwitchToggle: React.FC<TactileSwitchToggleProps> = ({
  checked,
  onToggle,
  label,
  icon,
  shortcut,
  accent = 'mint',
  title,
  compact = false,
  className = '',
  ariaLabel,
}) => {
  const palette = ACCENT_STYLES[accent];

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      aria-label={ariaLabel ?? `${label}: ${checked ? 'ON' : 'OFF'}`}
      title={title}
      className={`min-w-0 border font-mono-tabular flex items-center justify-between gap-2 cursor-pointer whitespace-nowrap transition-colors ${
        compact ? 'min-h-[30px] px-2.5 py-1 text-[11px]' : 'min-h-[34px] px-2.5 py-1.5 text-xs'
      } ${
        checked
          ? `${palette.activeContainer} font-semibold`
          : `bg-[var(--bg-control)] border-[var(--border-strong)] text-[var(--text-primary)] ${palette.hoverBorder}`
      } ${className}`}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        {icon && (
          <span
            className={`shrink-0 flex items-center ${
              checked ? palette.activeText : 'text-[var(--text-muted)]'
            }`}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
        {shortcut && (
          <span className="text-[10px] text-[var(--text-muted)] font-normal shrink-0">
            [{shortcut}]
          </span>
        )}
      </span>

      <span className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
        <span
          className={`w-6 h-3.5 border p-[2px] flex items-center transition-colors ${
            checked
              ? `${palette.activeTrack} justify-end`
              : 'border-[var(--border-strong)] bg-[var(--bg-obsidian)] justify-start'
          }`}
        >
          <span
            className={`w-2 h-2 block ${
              checked ? palette.activeThumb : 'bg-[var(--text-muted)]'
            }`}
          />
        </span>
        <span
          className={`text-[10px] tracking-wider font-bold min-w-[20px] text-right ${
            checked ? palette.activeText : 'text-[var(--text-muted)]'
          }`}
        >
          {checked ? 'ON' : 'OFF'}
        </span>
      </span>
    </button>
  );
};
