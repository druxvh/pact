import {
  Braces,
  Calculator,
  CaseSensitive,
  Crop,
  Dices,
  FileStack,
  ImageDown,
  Images,
  KeyRound,
  LayoutGrid,
  type LucideIcon,
  Palette,
  PenLine,
  QrCode,
  Ruler,
  Scissors,
  Shrink,
  Stamp,
} from 'lucide-react';
import type { ComponentType } from 'react';

export type ToolId =
  | 'calc'
  | 'convert'
  | 'text'
  | 'encode'
  | 'color'
  | 'qr'
  | 'image'
  | 'password'
  | 'random'
  | 'pdf-merge'
  | 'pdf-split'
  | 'pdf-pages'
  | 'pdf-crop'
  | 'pdf-sign'
  | 'pdf-watermark'
  | 'pdf-compress'
  | 'images-pdf';

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
  {
    id: 'pdf-merge',
    title: 'Merge PDFs',
    description: 'Combine several PDFs into one, in the order you choose',
    icon: FileStack,
    keywords: 'pdf merge combine join append documents',
    load: () => import('@/features/tools/tools/PdfMergeTool'),
  },
  {
    id: 'pdf-split',
    title: 'Split PDF',
    description: 'Cut one PDF into several by page range, every N pages or page by page',
    icon: Scissors,
    keywords: 'pdf split divide cut separate extract pages range chapters zip burst',
    load: () => import('@/features/tools/tools/PdfSplitTool'),
  },
  {
    id: 'pdf-pages',
    title: 'Organize PDF pages',
    description: 'Rearrange, rotate, delete or extract pages',
    icon: LayoutGrid,
    keywords: 'pdf pages rearrange reorder rotate delete remove extract split organize',
    load: () => import('@/features/tools/tools/PdfPagesTool'),
  },
  {
    id: 'pdf-crop',
    title: 'Crop PDF',
    description: 'Trim margins off every page',
    icon: Crop,
    keywords: 'pdf crop trim margins resize pages',
    load: () => import('@/features/tools/tools/PdfCropTool'),
  },
  {
    id: 'pdf-sign',
    title: 'Sign PDF',
    description: 'Draw, type or upload a signature and place it',
    icon: PenLine,
    keywords: 'pdf sign signature esign fill form initial',
    load: () => import('@/features/tools/tools/PdfSignTool'),
  },
  {
    id: 'pdf-watermark',
    title: 'Watermark PDF',
    description: 'Stamp text like “Confidential” or “Draft” on every page',
    icon: Stamp,
    keywords: 'pdf watermark stamp text confidential draft overlay label diagonal',
    load: () => import('@/features/tools/tools/PdfWatermarkTool'),
  },
  {
    id: 'pdf-compress',
    title: 'Compress PDF',
    description: 'Make a PDF smaller — lossless clean-up, or flatten pages to pictures',
    icon: Shrink,
    keywords: 'pdf compress shrink reduce size smaller optimize email upload mb file size',
    load: () => import('@/features/tools/tools/PdfCompressTool'),
  },
  {
    id: 'images-pdf',
    title: 'Images to PDF',
    description: 'Turn photos and scans into one PDF',
    icon: Images,
    keywords: 'image photo jpg png scan convert to pdf make pdf',
    load: () => import('@/features/tools/tools/ImagesToPdfTool'),
  },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolDef>;
export const isToolId = (v: string | null): v is ToolId => v !== null && v in TOOL_BY_ID;
