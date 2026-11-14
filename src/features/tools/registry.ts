import { Braces, Calculator, CaseSensitive, Dices, ImageDown, KeyRound, type LucideIcon, Palette, QrCode, Ruler } from 'lucide-react';
import type { ComponentType } from 'react';

export type ToolId = 'calc' | 'convert' | 'text' | 'encode' | 'color' | 'qr' | 'image' | 'password' | 'random';

export type ToolDef = {
  id: ToolId;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Extra words the search should match. */
  keywords: string;
  /** Lazy so a tool's code (e.g. the QR encoder) loads only when it's opened. */
  load: () => Promise<{ default: ComponentType }>;
};

export const TOOLS: readonly ToolDef[] = [
  {
    id: 'calc',
    title: 'Calculator',
    description: 'Keypad, history, functions & percentages',
    icon: Calculator,
    keywords: 'math arithmetic sum percent',
    load: () => import('@/features/tools/tools/CalcTool'),
  },
  {
    id: 'convert',
    title: 'Unit converter',
    description: 'Length, mass, temperature, data, time & more',
    icon: Ruler,
    keywords: 'convert units metric imperial kg lb km mile celsius',
    load: () => import('@/features/tools/tools/ConvertTool'),
  },
  {
    id: 'text',
    title: 'Text tools',
    description: 'Change case, clean up lines, count words',
    icon: CaseSensitive,
    keywords: 'uppercase lowercase camel snake kebab slug count words sort dedupe',
    load: () => import('@/features/tools/tools/TextTool'),
  },
  {
    id: 'encode',
    title: 'Encode & format',
    description: 'URL, Base64 and JSON in one place',
    icon: Braces,
    keywords: 'url base64 json format minify encode decode escape',
    load: () => import('@/features/tools/tools/EncodeTool'),
  },
  {
    id: 'color',
    title: 'Colour & contrast',
    description: 'Convert formats, check WCAG, pick from screen',
    icon: Palette,
    keywords: 'color colour hex rgb hsl oklch contrast wcag eyedropper accessibility',
    load: () => import('@/features/tools/tools/ColorTool'),
  },
  {
    id: 'qr',
    title: 'QR code',
    description: 'Links, text or Wi-Fi — download as PNG or SVG',
    icon: QrCode,
    keywords: 'qr code wifi scan barcode',
    load: () => import('@/features/tools/tools/QrTool'),
  },
  {
    id: 'image',
    title: 'Image compressor',
    description: 'Shrink photos on-device, fit under 5 MB',
    icon: ImageDown,
    keywords: 'image photo compress resize jpeg webp png optimize',
    load: () => import('@/features/tools/tools/ImageTool'),
  },
  {
    id: 'password',
    title: 'Password & IDs',
    description: 'Strong passwords, UUIDs and tokens',
    icon: KeyRound,
    keywords: 'password generator uuid token random secure',
    load: () => import('@/features/tools/tools/PasswordTool'),
  },
  {
    id: 'random',
    title: 'Dice, coin & picker',
    description: 'Roll, flip, or let fate choose',
    icon: Dices,
    keywords: 'dice coin flip random picker decide shuffle',
    load: () => import('@/features/tools/tools/RandomTool'),
  },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolDef>;
export const isToolId = (v: string | null): v is ToolId => v !== null && v in TOOL_BY_ID;
