export interface PdfDocument {
  id: string;
  name: string;
  filename: string;
  path: string;
  originalDiskPath?: string;
  pages: number;
  size: number;
}

export interface ParagraphInfo {
  paragraph: number;
  lines?: number[];
  text: string;
  font?: string;
  size?: number;
  color?: string;
  rect: [number, number, number, number]; // [x1, y1, x2, y2]
}

export type ViewMode = 'dashboard' | 'viewer' | 'editor' | 'organize' | 'tools';
export type ToolType = 'merge' | 'split' | 'compress' | 'sign' | 'watermark' | 'protect' | 'redact';
export type ReadingMode = 'normal' | 'night' | 'sepia';
