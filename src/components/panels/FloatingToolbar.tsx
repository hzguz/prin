/**
 * Toolbar anchored to the selection.
 *
 * Two rows: tools on top, contextual properties for the active tool below.
 * The properties row is derived from TOOL_PROPERTIES rather than hardcoded,
 * so adding a property to a tool needs no change here.
 */

import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowNarrowRight,
  IconArrowsHorizontal,
  IconBold,
  IconCopy,
  IconFocus2,
  IconItalic,
  IconGripHorizontal,
  IconLineDashed,
  IconMinus,
  IconShadow,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useI18n } from '../../i18n';
import { primaryModifierLabel } from '../../lib/platform';
import { useEditorStore } from '../../store/editorStore';
import {
  ArrowHead,
  COLOR_SWATCHES,
  FONT_SIZE_PRESETS,
  FontStyle,
  FontWeight,
  LineStyle,
  STROKE_WIDTH_PRESETS,
  StyleProperty,
  TOOL_PROPERTIES,
  TextAlign,
  ToolId,
} from '../../types/annotations';
import { TOOLS } from '../../types/tools';
import { InlineColors } from '../controls/InlineColors';
import { InlineNumber } from '../controls/InlineNumber';

interface FloatingToolbarProps {
  onCopy: () => void;
  onSave: () => void;
  onCancel: () => void;
  fullWidth?: boolean;
  onDragPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onDragPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onDragPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

export function FloatingToolbar({
  onCopy,
  onSave,
  onCancel,
  fullWidth = false,
  onDragPointerDown,
  onDragPointerMove,
  onDragPointerUp,
}: FloatingToolbarProps) {
  const activeTool = useEditorStore((state) => state.activeTool);
  const setActiveTool = useEditorStore((state) => state.setActiveTool);
  const annotations = useEditorStore((state) => state.annotations);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const draftStyle = useEditorStore((state) => state.draftStyle);
  const applyStyle = useEditorStore((state) => state.applyStyle);
  const applyStyleTransient = useEditorStore((state) => state.applyStyleTransient);
  const beginTransient = useEditorStore((state) => state.beginTransient);
  const commitTransient = useEditorStore((state) => state.commitTransient);
  const removeSelected = useEditorStore((state) => state.removeSelected);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const past = useEditorStore((state) => state.past);
  const future = useEditorStore((state) => state.future);
  const t = useI18n((state) => state.t);
  const mod = primaryModifierLabel();

  const selected = annotations.filter((item) => selectedIds.includes(item.id));

  // A selection dictates which controls are relevant; otherwise the active
  // tool does. Mixed selections fall back to the shared 'select' set.
  const contextTool: ToolId =
    selected.length === 1 ? selected[0].type : selected.length > 1 ? 'select' : activeTool;

  const style = selected.length === 1 ? selected[0].style : draftStyle;
  const properties = TOOL_PROPERTIES[contextTool];
  const has = (property: StyleProperty) => properties.includes(property);

  return (
    <div
      className={`flex max-w-[min(92vw,720px)] flex-col overflow-visible rounded-xl border border-surface-600 bg-surface-800/97 shadow-2xl backdrop-blur-md ${
        fullWidth ? 'w-full' : ''
      }`}
      // The toolbar is chrome: clicks here must never reach the canvas.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-0.5 p-1.5">
        <button
          type="button"
          title={t.toolbar.dragToMove}
          aria-label={t.toolbar.moveToolbarAria}
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
          className="mr-0.5 flex h-8 w-7 shrink-0 touch-none cursor-grab items-center justify-center rounded-lg text-content-muted transition hover:bg-surface-700 hover:text-content-primary active:cursor-grabbing"
        >
          <IconGripHorizontal size={17} stroke={1.75} />
        </button>

        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const isActive = activeTool === tool.id;
          const localizedLabel = t.tools[tool.id] ?? tool.label;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => setActiveTool(tool.id)}
              title={`${localizedLabel} (${tool.shortcut})`}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
                isActive
                  ? 'bg-accent text-white shadow-md shadow-accent/25'
                  : 'text-content-secondary hover:bg-surface-700 hover:text-content-primary'
              }`}
            >
              <Icon size={17} stroke={1.75} />
            </button>
          );
        })}

        <Divider />

        <ActionButton onClick={undo} disabled={past.length === 0} title={t.toolbar.undo(mod)}>
          <IconArrowBackUp size={17} stroke={1.75} />
        </ActionButton>
        <ActionButton onClick={redo} disabled={future.length === 0} title={t.toolbar.redo(mod)}>
          <IconArrowForwardUp size={17} stroke={1.75} />
        </ActionButton>
        <ActionButton
          onClick={removeSelected}
          disabled={selected.length === 0}
          title={t.toolbar.delete}
        >
          <IconTrash size={17} stroke={1.75} />
        </ActionButton>

        {/* Pushes the terminal actions to the right, so they read as a
            separate group from the tools rather than a continuation. */}
        <div className="ml-auto flex items-center gap-1 pl-2">
          <button
            type="button"
            onClick={onCancel}
            title={t.toolbar.cancel}
            aria-label={t.toolbar.cancelAria}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-300/90 transition hover:bg-red-500/15 hover:text-red-200"
          >
            <IconX size={16} stroke={1.8} />
          </button>
          <button
            type="button"
            onClick={onCopy}
            title={t.toolbar.copy(mod)}
            aria-label={t.toolbar.copyAria}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-700 text-content-primary transition hover:bg-surface-600"
          >
            <IconCopy size={16} stroke={1.8} />
          </button>
          <button
            type="button"
            onClick={onSave}
            title={t.toolbar.save(mod)}
            className="flex h-8 shrink-0 items-center rounded-lg bg-accent px-3 text-xs font-bold text-white transition hover:bg-accent-hover"
          >
            {t.toolbar.saveButton}
          </button>
        </div>
      </div>

      {properties.length > 0 && (
        // flex-wrap is load-bearing: the text tool exposes seven controls, and
        // without wrapping they either overflow the toolbar or squeeze each
        // other down to unusable widths.
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 border-t border-surface-700 px-2 py-2">
          {has('strokeColor') && (
            <InlineColors
              label={contextTool === 'text' ? t.toolbar.textColor : t.toolbar.strokeColor}
              value={style.strokeColor}
              swatches={COLOR_SWATCHES}
              onChange={(strokeColor) => applyStyle({ strokeColor })}
            />
          )}

          {has('fillColor') && (contextTool !== 'text' || style.textBox) && (
            <InlineColors
              label={t.toolbar.fillColor}
              value={style.fillColor}
              swatches={COLOR_SWATCHES}
              allowTransparent
              onChange={(fillColor) => applyStyle({ fillColor })}
            />
          )}

          {has('fontSize') && (
            <InlineNumber
              label={t.toolbar.fontSize}
              value={style.fontSize}
              min={8}
              max={200}
              suffix="px"
              presets={FONT_SIZE_PRESETS}
              onChange={(fontSize) => applyStyle({ fontSize })}
            />
          )}

          {has('strokeWidth') && (
            <InlineNumber
              label={t.toolbar.strokeWidth}
              value={style.strokeWidth}
              min={1}
              max={64}
              suffix="px"
              presets={STROKE_WIDTH_PRESETS}
              onChange={(strokeWidth) => applyStyle({ strokeWidth })}
            />
          )}

          {(has('fontWeight') || has('fontStyle')) && (
            <InlineGroup label={t.toolbar.style}>
              {has('fontWeight') && (
                <MiniToggle
                  active={style.fontWeight === 'bold'}
                  title={t.toolbar.bold}
                  onClick={() =>
                    applyStyle({
                      fontWeight: (style.fontWeight === 'bold' ? 'normal' : 'bold') as FontWeight,
                    })
                  }
                >
                  <IconBold size={14} stroke={2} />
                </MiniToggle>
              )}
              {has('fontStyle') && (
                <MiniToggle
                  active={style.fontStyle === 'italic'}
                  title={t.toolbar.italic}
                  onClick={() =>
                    applyStyle({
                      fontStyle: (style.fontStyle === 'italic' ? 'normal' : 'italic') as FontStyle,
                    })
                  }
                >
                  <IconItalic size={14} stroke={2} />
                </MiniToggle>
              )}
            </InlineGroup>
          )}

          {has('textAlign') && (
            <InlineGroup label="">
              {(
                [
                  ['left', IconAlignLeft, t.toolbar.alignLeft],
                  ['center', IconAlignCenter, t.toolbar.alignCenter],
                  ['right', IconAlignRight, t.toolbar.alignRight],
                ] as const
              ).map(([align, Icon, title]) => (
                <MiniToggle
                  key={align}
                  active={style.textAlign === align}
                  title={title}
                  onClick={() => applyStyle({ textAlign: align as TextAlign })}
                >
                  <Icon size={14} stroke={1.75} />
                </MiniToggle>
              ))}
            </InlineGroup>
          )}

          {has('arrowHead') && (
            <InlineGroup label={t.toolbar.arrowHead}>
              {(
                [
                  ['none', IconMinus, t.toolbar.arrowNone],
                  ['end', IconArrowNarrowRight, t.toolbar.arrowEnd],
                  ['both', IconArrowsHorizontal, t.toolbar.arrowBoth],
                ] as const
              ).map(([head, Icon, title]) => (
                <MiniToggle
                  key={head}
                  active={style.arrowHead === head}
                  title={title}
                  onClick={() => applyStyle({ arrowHead: head as ArrowHead })}
                >
                  <Icon size={14} stroke={1.75} />
                </MiniToggle>
              ))}
            </InlineGroup>
          )}

          {has('lineStyle') && (
            <InlineGroup label={t.toolbar.lineStyle}>
              {(
                [
                  ['solid', IconMinus, t.toolbar.lineSolid],
                  ['dashed', IconLineDashed, t.toolbar.lineDashed],
                ] as const
              ).map(([line, Icon, title]) => (
                <MiniToggle
                  key={line}
                  active={style.lineStyle === line}
                  title={title}
                  onClick={() => applyStyle({ lineStyle: line as LineStyle })}
                >
                  <Icon size={14} stroke={1.75} />
                </MiniToggle>
              ))}
            </InlineGroup>
          )}

          {has('blurIntensity') && (
            <InlineSlider
              label={t.toolbar.blur}
              value={style.blurIntensity}
              min={2}
              max={40}
              onBegin={beginTransient}
              onChange={(blurIntensity) => applyStyleTransient({ blurIntensity })}
              onCommit={commitTransient}
            />
          )}

          {has('opacity') && (
            <InlineSlider
              label={t.toolbar.opacity}
              value={Math.round(style.opacity * 100)}
              min={5}
              max={100}
              suffix="%"
              onBegin={beginTransient}
              onChange={(value) => applyStyleTransient({ opacity: value / 100 })}
              onCommit={commitTransient}
            />
          )}

          {has('cornerRadius') && (
            <InlineGroup label="">
              {(
                [
                  [0, t.toolbar.cornerSharp],
                  [4, t.toolbar.cornerSoft],
                  [16, t.toolbar.cornerRound],
                ] as const
              ).map(([radius, title]) => (
                <MiniToggle
                  key={radius}
                  active={style.cornerRadius === radius}
                  title={title}
                  onClick={() => applyStyle({ cornerRadius: radius })}
                >
                  <CornerIcon radius={radius} />
                </MiniToggle>
              ))}
            </InlineGroup>
          )}

          {has('spotlight') && (
            <InlineGroup label={t.toolbar.spotlight}>
              <MiniToggle
                active={style.spotlight}
                title={style.spotlight ? t.toolbar.spotlightOn : t.toolbar.spotlightOff}
                onClick={() => applyStyle({ spotlight: !style.spotlight })}
              >
                <IconFocus2 size={14} stroke={1.75} />
              </MiniToggle>
            </InlineGroup>
          )}

          {has('textBox') && (
            <MiniToggle
              active={style.textBox}
              title={style.textBox ? t.toolbar.textBoxOn : t.toolbar.textBoxOff}
              onClick={() =>
                applyStyle({
                  textBox: !style.textBox,
                  ...(!style.textBox && style.fillColor === 'transparent'
                    ? { fillColor: '#111827' }
                    : {}),
                })
              }
            >
              <TextBoxIcon />
            </MiniToggle>
          )}

          {has('shadow') && (
            <MiniToggle
              active={style.shadow}
              title={style.shadow ? t.toolbar.shadowOn : t.toolbar.shadowOff}
              onClick={() => applyStyle({ shadow: !style.shadow })}
            >
              <IconShadow size={14} stroke={1.75} />
            </MiniToggle>
          )}
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px shrink-0 bg-surface-600" />;
}

interface ActionButtonProps {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}

function ActionButton({ onClick, title, children, disabled }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
        disabled
          ? 'cursor-not-allowed text-content-muted/40'
          : 'text-content-secondary hover:bg-surface-700 hover:text-content-primary'
      }`}
    >
      {children}
    </button>
  );
}

interface InlineGroupProps {
  label: string;
  children: React.ReactNode;
}

export function InlineGroup({ label, children }: InlineGroupProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {label && (
        <span className="text-[10px] tracking-wide whitespace-nowrap text-content-muted uppercase">
          {label}
        </span>
      )}
      <div className="flex gap-0.5">{children}</div>
    </div>
  );
}

interface MiniToggleProps {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}

function MiniToggle({ active, title, onClick, children }: MiniToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition ${
        active
          ? 'bg-accent text-white'
          : 'bg-surface-700 text-content-secondary hover:bg-surface-600 hover:text-content-primary'
      }`}
    >
      {children}
    </button>
  );
}

function CornerIcon({ radius }: { radius: 0 | 4 | 16 }) {
  const path =
    radius === 0
      ? 'M3 11V3h8'
      : radius === 4
        ? 'M3 11V7a4 4 0 0 1 4-4h4'
        : 'M3 11V9a6 6 0 0 1 6-6h2';

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TextBoxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect
        x="1.5"
        y="2"
        width="11"
        height="8.5"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M4 10.5 3 12.5l3-2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 5h6M4 7.5h4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

interface InlineSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onBegin: () => void;
  onChange: (value: number) => void;
  onCommit: () => void;
}

function InlineSlider({
  label,
  value,
  min,
  max,
  suffix,
  onBegin,
  onChange,
  onCommit,
}: InlineSliderProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="text-[10px] tracking-wide whitespace-nowrap text-content-muted uppercase">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onPointerDown={onBegin}
        onPointerUp={onCommit}
        onPointerCancel={onCommit}
        onKeyDown={onBegin}
        onKeyUp={onCommit}
        onBlur={onCommit}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-14 accent-accent"
      />
      {/* Fixed width and tabular figures stop the row from reflowing as the
          number changes width while dragging. */}
      <span className="min-w-6 shrink-0 text-left font-mono text-[10px] text-content-muted tabular-nums">
        {value}
        {suffix}
      </span>
    </div>
  );
}
