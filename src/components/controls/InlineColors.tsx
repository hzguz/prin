/**
 * Colour control for the toolbar's property row.
 *
 * The swatch grid lives in a popover sized in absolute units rather than
 * letting it collapse to its content: a grid inside an auto-width flex child
 * shrinks to the smallest column, which is what made the previous version
 * unusable.
 */

import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconDropletOff } from '@tabler/icons-react';
import { useI18n } from '../../i18n';

interface InlineColorsProps {
  label: string;
  value: string;
  swatches: readonly string[];
  onChange: (value: string) => void;
  /** Adds a "no fill" option, used for shape backgrounds. */
  allowTransparent?: boolean;
}

/** Checkerboard that reads as "transparent" behind a colour chip. */
const CHECKERBOARD =
  'linear-gradient(45deg, #64708a 25%, transparent 25%, transparent 75%, #64708a 75%),' +
  'linear-gradient(45deg, #64708a 25%, transparent 25%, transparent 75%, #64708a 75%)';

export function InlineColors({
  label,
  value,
  swatches,
  onChange,
  allowTransparent = false,
}: InlineColorsProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isTransparent = value === 'transparent';
  const t = useI18n((state) => state.t);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Contained here so Escape closes the popover without also
        // cancelling the whole capture.
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

  return (
    <div ref={containerRef} className="relative flex shrink-0 items-center gap-1.5">
      <span className="text-[10px] tracking-wide whitespace-nowrap text-content-muted uppercase">
        {label}
      </span>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        title={isTransparent ? t.toolbar.noFill : t.toolbar.currentColor(value)}
        className="h-6 w-6 shrink-0 rounded-md border border-surface-500 transition hover:border-content-secondary"
        style={
          isTransparent
            ? { backgroundImage: CHECKERBOARD, backgroundSize: '8px 8px', backgroundPosition: '0 0, 4px 4px' }
            : { backgroundColor: value }
        }
      />

      {open && (
        // right-0 rather than left-0: these controls sit near the right edge
        // of the toolbar, where a left-anchored popover runs off screen.
        <div className="animate-slide-up absolute bottom-full right-0 z-40 mb-2 w-56 rounded-xl border border-surface-600 bg-surface-800 p-2.5 shadow-2xl">
          <div className="grid grid-cols-6 gap-1.5">
            {swatches.map((swatch) => (
              <button
                key={swatch}
                type="button"
                title={swatch}
                onClick={() => {
                  onChange(swatch);
                  setOpen(false);
                }}
                style={{ backgroundColor: swatch }}
                className={`flex aspect-square items-center justify-center rounded-md border transition hover:scale-110 ${
                  value === swatch
                    ? 'border-white ring-2 ring-accent'
                    : 'border-surface-500/60'
                }`}
              >
                {value === swatch && (
                  // Contrast against the swatch itself, not the panel.
                  <IconCheck
                    size={12}
                    stroke={3}
                    className={isLightColor(swatch) ? 'text-black/70' : 'text-white'}
                  />
                )}
              </button>
            ))}
          </div>

          <div className="mt-2.5 flex items-center gap-2 border-t border-surface-700 pt-2.5">
            <label className="flex flex-1 items-center gap-2">
              <input
                type="color"
                value={isTransparent ? '#000000' : value}
                onChange={(event) => onChange(event.target.value)}
                className="h-7 w-9 shrink-0 rounded-md"
                title={t.toolbar.customColor}
              />
              <input
                type="text"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                spellCheck={false}
                className="w-full min-w-0 rounded-md bg-surface-700 px-2 py-1 font-mono text-[11px] text-content-primary outline-none focus:ring-2 focus:ring-accent"
              />
            </label>

            {allowTransparent && (
              <button
                type="button"
                onClick={() => {
                  onChange('transparent');
                  setOpen(false);
                }}
                title={t.toolbar.noFill}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition ${
                  isTransparent
                    ? 'bg-accent text-white'
                    : 'bg-surface-700 text-content-secondary hover:text-content-primary'
                }`}
              >
                <IconDropletOff size={14} stroke={1.75} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Rough perceived brightness, used to pick a legible check mark. */
function isLightColor(hex: string): boolean {
  const normalised = hex.replace('#', '');
  if (normalised.length !== 6) return false;

  const r = parseInt(normalised.slice(0, 2), 16);
  const g = parseInt(normalised.slice(2, 4), 16);
  const b = parseInt(normalised.slice(4, 6), 16);

  // Rec. 601 luma: green dominates perceived brightness.
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}
