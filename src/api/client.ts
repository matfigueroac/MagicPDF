import { PdfDocument, ParagraphInfo } from '../types';

const API_BASE = '/api';

export async function uploadFiles(files: File[]): Promise<PdfDocument[]> {
  const formData = new FormData();
  for (const f of files) {
    formData.append('files', f);
  }
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Error al subir archivos');
  const data = await res.json();
  return data.documents;
}

export async function openFilePath(targetPath: string): Promise<PdfDocument> {
  const res = await fetch(`${API_BASE}/open-file-path`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetPath }),
  });
  if (!res.ok) throw new Error('Error al abrir archivo');
  const data = await res.json();
  return data.document;
}

export function getPageImageUrl(filename: string, page: number, dpi = 144): string {
  return `${API_BASE}/page-image/${encodeURIComponent(filename)}/${page}?dpi=${dpi}&t=${Date.now()}`;
}

export async function getParagraphs(filename: string, page: number): Promise<ParagraphInfo[]> {
  const res = await fetch(`${API_BASE}/paragraphs/${encodeURIComponent(filename)}/${page}`);
  if (!res.ok) throw new Error('Error al obtener párrafos');
  const data = await res.json();
  return data.paragraphs;
}

export async function editText(
  filename: string,
  page: number,
  paragraph: number,
  text: string,
  options: { font?: string; size?: number; color?: string; bold?: boolean; italic?: boolean } = {}
): Promise<void> {
  const res = await fetch(`${API_BASE}/edit-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, page, paragraph, text, ...options }),
  });
  if (!res.ok) throw new Error('Error al actualizar texto');
}

export async function addText(
  filename: string,
  page: number,
  text: string,
  at: [number, number],
  options: { font?: string; size?: number; color?: string; bold?: boolean; italic?: boolean; width?: number } = {}
): Promise<void> {
  const res = await fetch(`${API_BASE}/add-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, page, text, at, ...options }),
  });
  if (!res.ok) throw new Error('Error al añadir texto');
}

export async function organizePages(
  filename: string,
  rotations: Array<{ page: number; by: number }> = [],
  deletions: number[] = []
): Promise<{ pages: number }> {
  const res = await fetch(`${API_BASE}/organize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, rotations, deletions }),
  });
  if (!res.ok) throw new Error('Error al organizar páginas');
  const data = await res.json();
  return data.info;
}

export async function combinePdfs(filenames: string[], outputName?: string): Promise<PdfDocument> {
  const res = await fetch(`${API_BASE}/combine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filenames, outputName }),
  });
  if (!res.ok) throw new Error('Error al unir documentos');
  const data = await res.json();
  return {
    id: data.filename,
    name: outputName || 'documento_unido.pdf',
    filename: data.filename,
    path: data.info.path,
    pages: data.info.pages,
    size: data.info.size
  };
}

export async function splitPdf(filename: string, every: number): Promise<string[]> {
  const res = await fetch(`${API_BASE}/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, every }),
  });
  if (!res.ok) throw new Error('Error al dividir documento');
  const data = await res.json();
  return data.parts;
}

export async function signDocument(
  filename: string,
  page: number,
  signatureBase64: string,
  at: [number, number],
  width = 160,
  height = 70
): Promise<void> {
  const res = await fetch(`${API_BASE}/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, page, signatureBase64, at, width, height }),
  });
  if (!res.ok) throw new Error('Error al estampar firma');
}

export async function protectDocument(filename: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/protect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, password }),
  });
  if (!res.ok) throw new Error('Error al proteger documento');
}

export async function redactArea(
  filename: string,
  page: number,
  rect: [number, number, number, number]
): Promise<void> {
  const res = await fetch(`${API_BASE}/redact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, page, rect }),
  });
  if (!res.ok) throw new Error('Error al censurar área');
}

export async function compressDocument(filename: string): Promise<{ beforeSize: number; afterSize: number; reducedPercent: number }> {
  const res = await fetch(`${API_BASE}/compress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  });
  if (!res.ok) throw new Error('Error al comprimir documento');
  return res.json();
}

export async function watermarkDocument(
  filename: string,
  text: string,
  options: { opacity?: number; color?: string; rotation?: number; fontSize?: number } = {}
): Promise<void> {
  const res = await fetch(`${API_BASE}/watermark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, text, ...options }),
  });
  if (!res.ok) throw new Error('Error al aplicar marca de agua');
}

export async function exportDocumentText(filename: string): Promise<string> {
  const res = await fetch(`${API_BASE}/export-text/${encodeURIComponent(filename)}`);
  if (!res.ok) throw new Error('Error al exportar texto');
  const data = await res.json();
  return data.text;
}

export async function saveToPath(filename: string, targetPath: string): Promise<void> {
  const res = await fetch(`${API_BASE}/save-to-path`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, targetPath }),
  });
  if (!res.ok) throw new Error('Error al guardar en el disco');
}

export function getDownloadUrl(filename: string): string {
  return `${API_BASE}/download/${encodeURIComponent(filename)}`;
}

