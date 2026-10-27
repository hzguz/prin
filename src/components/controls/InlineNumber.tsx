/**
 * Numeric stepper with a preset dropdown, for the toolbar's property row.
 *
 * The value is editable three ways — steppers, direct typing, and presets —
 * because font size in particular is something users both nudge and set
 * exactly.
 */

import { useEffect, useRef, useState } from 'react';
import { IconChevronDown, IconMinus, IconPlus } from '@tabler/icons-react';
import { useI18n } from '../../i18n';

interface InlineNumberProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  presets?: readonly number[];
  onChange: (value: number) => void;
}

export function InlineNumber({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  presets,
  onChange,
}: InlineNumberProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useI18n((state) => state.t);

  // External changes — selecting another shape — must refresh the field.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  const commitDraft = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onChange(clamp(parsed));
    else setDraft(String(value));
  };

  return (
    <div ref={containerRef} className="relative flex shrink-0 items-center gap-1.5">
      <span className="text-[10px] tracking-wide whitespace-nowrap text-content-muted uppercase">
        {label}
      </span>

      <div className="flex items-center overflow-hidden rounded-md bg-surface-700">
        <button
          type="button"
          onClick={() => onChange(clamp(value - step))}
          disabled={value <= min}
          title={t.toolbar.decrease}
          className="flex h-6 w-5 items-center justify-center text-content-secondary transition hover:bg-surface-600 hover:text-content-primary disabled:cursor-not-allowed disabled:text-content-muted/40"
        >
          <IconMinus size={12} stroke={2} />
        </button>

        <div className="relative flex items-center">
          <input
            type="text"
            inputMode="numeric"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              // Contained so the overlay's own handlers do not also act on
              // keys typed into this field.
              event.stopPropagation();

              if (event.key === 'Enter') {
                commitDraft();
                event.currentTarget.blur();
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                onChange(clamp(value + step));
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                onChange(clamp(value - step));
              }
            }}
            // Width fits three digits plus the suffix, so the row does not
            // reflow as the number grows.
            className={`h-6 bg-transparent text-center font-mono text-[11px] text-content-primary outline-none tabular-nums ${
              suffix ? 'w-10 pr-3.5' : 'w-9'
            }`}
          />
          {suffix && (
            <span className="pointer-events-none absolute right-1 text-[9px] text-content-muted">
              {suffix}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onChange(clamp(value + step))}
          disabled={value >= max}
          title={t.toolbar.increase}
          className="flex h-6 w-5 items-center justify-center text-content-secondary transition hover:bg-surface-600 hover:text-content-primary disabled:cursor-not-allowed disabled:text-content-muted/40"
        >
          <IconPlus size={12} stroke={2} />
        </button>

        {presets && (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            title={t.toolbar.presets}
            className={`flex h-6 w-5 items-center justify-center border-l border-surface-600 transition hover:bg-surface-600 ${
              open ? 'bg-surface-600 text-content-primary' : 'text-content-secondary'
            }`}
          >
            <IconChevronDown size={12} stroke={2} />
          </button>
        )}
      </div>

      {presets && open && (
        <div className="animate-slide-up absolute right-0 bottom-full z-40 mb-2 grid w-40 grid-cols-4 gap-1 rounded-xl border border-surface-600 bg-surface-800 p-2 shadow-2xl">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                onChange(clamp(preset));
                setOpen(false);
              }}
              className={`rounded-md py-1 font-mono text-[11px] transition tabular-nums ${
                preset === value
                  ? 'bg-accent text-white'
                  : 'text-content-secondary hover:bg-surface-600 hover:text-content-primary'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
