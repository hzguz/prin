/**
 * Tool catalogue: labels, icons and keyboard shortcuts.
 *
 * Kept out of the toolbar component so that consumers needing only the
 * shortcut map (the overlay's key handler) do not import a React component,
 * which would also defeat Fast Refresh for the toolbar itself.
 */

import type { Icon } from '@tabler/icons-react';
import {
  IconArrowUpRight,
  IconBlur,
  IconCircle,
  IconCircleNumber1,
  IconLine,
  IconPencil,
  IconPointer,
  IconSquare,
  IconTypography,
} from '@tabler/icons-react';
import { ToolId } from './annotations';

export interface ToolDefinition {
  id: ToolId;
  label: string;
  icon: Icon;
  shortcut: string;
}

export const TOOLS: ToolDefinition[] = [
  { id: 'select', label: 'Selecionar', icon: IconPointer, shortcut: 'V' },
  { id: 'rect', label: 'Retângulo', icon: IconSquare, shortcut: 'R' },
  { id: 'ellipse', label: 'Elipse', icon: IconCircle, shortcut: 'O' },
  { id: 'arrow', label: 'Seta', icon: IconArrowUpRight, shortcut: 'A' },
  { id: 'line', label: 'Linha', icon: IconLine, shortcut: 'L' },
  { id: 'pen', label: 'Caneta', icon: IconPencil, shortcut: 'P' },
  { id: 'text', label: 'Texto', icon: IconTypography, shortcut: 'T' },
  { id: 'counter', label: 'Numeração', icon: IconCircleNumber1, shortcut: 'N' },
  { id: 'blur', label: 'Desfoque', icon: IconBlur, shortcut: 'B' },
];

/** Maps a lowercased key to its tool, for the overlay's shortcut handler. */
export const TOOL_SHORTCUTS: Record<string, ToolId> = Object.fromEntries(
  TOOLS.map((tool) => [tool.shortcut.toLowerCase(), tool.id]),
);
