import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';

export function getAppPaths() {
  const isPackaged = process.resourcesPath !== undefined && !process.defaultApp;

  // Find pdfcraft-cli.exe candidates across dev and production setups
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'pdfcraft-cli.exe') : '',
    path.join(__dirname, '..', 'bin', 'pdfcraft-cli.exe'),
    path.join(__dirname, 'bin', 'pdfcraft-cli.exe'),
    path.join(process.cwd(), 'resources', 'bin', 'pdfcraft-cli.exe'),
    path.join(process.cwd(), 'bin', 'pdfcraft-cli.exe'),
    'C:\\Dev\\Experiments\\MagicPDF\\bin\\pdfcraft-cli.exe'
  ].filter(Boolean);

  let cliPath = candidates.find(c => fs.existsSync(c)) || candidates[0];

  let tempDir: string;
  let uploadsDir: string;

  if (isPackaged) {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    tempDir = path.join(appData, 'MagicPDF', 'temp');
    uploadsDir = path.join(appData, 'MagicPDF', 'uploads');
  } else {
    tempDir = path.resolve(__dirname, '..', 'storage', 'temp');
    uploadsDir = path.resolve(__dirname, '..', 'storage', 'uploads');
  }

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  return { cliPath, tempDir, uploadsDir };
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

export interface LineInfo {
  line: number;
  text: string;
  box: [number, number, number, number]; // [x1, y1, x2, y2]
  font?: string;
  size?: number;
}

export interface ImageInfo {
  image: number;
  box: [number, number, number, number]; // [x1, y1, x2, y2]
  pixels?: [number, number];
  name?: string;
}

export interface DocInfo {
  doc?: number;
  pages: number;
  name: string;
  path: string;
  size: number;
}

/**
 * Execute a multi-step JSON script in pdfcraft-cli
 */
export async function runScript(steps: Array<{ tool: string; args: Record<string, any>; out?: string }>): Promise<any[]> {
  const { cliPath, tempDir } = getAppPaths();
  const scriptId = `script_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.json`;
  const scriptPath = path.join(tempDir, scriptId);
  fs.writeFileSync(scriptPath, JSON.stringify(steps, null, 2), 'utf-8');

  return new Promise((resolve, reject) => {
    execFile(cliPath, ['run', '--script', scriptPath], { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      try { fs.unlinkSync(scriptPath); } catch {}

      if (error && !stdout) {
        return reject(new Error(stderr || error.message));
      }

      const results: any[] = [];
      const jsonBlocks = stdout.trim().split(/(?<=\})\s*(?=\{)/g);
      for (const block of jsonBlocks) {
        try {
          const parsed = JSON.parse(block.trim());
          results.push(parsed);
        } catch {}
      }
      resolve(results);
    });
  });
}

/**
 * Get basic document metadata
 */
export async function getPdfInfo(pdfPath: string): Promise<DocInfo> {
  const stats = fs.statSync(pdfPath);
  const steps = [
    { tool: 'doc_open', args: { path: pdfPath } },
    { tool: 'doc_close', args: { doc: 1 } }
  ];
  const results = await runScript(steps);
  const docData = results[0];

  return {
    doc: docData.doc,
    pages: docData.pages || 1,
    name: path.basename(pdfPath),
    path: pdfPath,
    size: stats.size
  };
}

/**
 * Render a page to PNG image
 */
export async function renderPage(pdfPath: string, pageNumber: number, dpi = 120): Promise<string> {
  const { cliPath, tempDir } = getAppPaths();
  const outName = `render_${path.basename(pdfPath, '.pdf')}_p${pageNumber}_${Date.now()}.png`;
  const outPath = path.join(tempDir, outName);

  return new Promise((resolve, reject) => {
    execFile(cliPath, ['render', pdfPath, '--page', pageNumber.toString(), '--dpi', dpi.toString(), '--out', outPath], (err, _stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message));
      }
      resolve(outPath);
    });
  });
}

/**
 * Get all editable text paragraphs for a specific page
 */
export async function getPageParagraphs(pdfPath: string, pageNumber: number): Promise<ParagraphInfo[]> {
  const steps = [
    { tool: 'doc_open', args: { path: pdfPath } },
    { tool: 'text_paragraphs', args: { doc: 1, page: pageNumber } },
    { tool: 'doc_close', args: { doc: 1 } }
  ];
  const results = await runScript(steps);
  const paragraphResult = results.find(r => r.paragraphs !== undefined);
  return paragraphResult?.paragraphs || [];
}

/**
 * Get all individual text lines for a specific page (for precise text selection & highlighting)
 */
export async function getPageLines(pdfPath: string, pageNumber: number): Promise<LineInfo[]> {
  const steps = [
    { tool: 'doc_open', args: { path: pdfPath } },
    { tool: 'text_lines', args: { doc: 1, page: pageNumber } },
    { tool: 'doc_close', args: { doc: 1 } }
  ];
  const results = await runScript(steps);
  const lineResult = results.find(r => r.lines !== undefined);
  return lineResult?.lines || [];
}

/**
 * Get all recognized images drawn on a page
 */
export async function getPageImages(pdfPath: string, pageNumber: number): Promise<ImageInfo[]> {
  const steps = [
    { tool: 'doc_open', args: { path: pdfPath } },
    { tool: 'page_images', args: { doc: 1, page: pageNumber } },
    { tool: 'doc_close', args: { doc: 1 } }
  ];
  const results = await runScript(steps);
  const imgResult = results.find(r => r.images !== undefined);
  return imgResult?.images || [];
}

/**
 * Edit an image on a page (delete, rotate, replace, flip)
 */
export async function editImage(
  pdfPath: string,
  pageNumber: number,
  imageNumber: number,
  action: 'rotate' | 'delete' | 'replace' | 'flip_horizontal' | 'flip_vertical' | 'move',
  options: { path?: string; quarters?: number; rect?: [number, number, number, number] } = {}
): Promise<string> {
  const args: Record<string, any> = {
    doc: 1,
    page: pageNumber,
    image: imageNumber,
    action
  };
  if (options.path) args.path = options.path;
  if (options.quarters !== undefined) args.quarters = options.quarters;
  if (options.rect) args.rect = options.rect;

  const steps = [
    { tool: 'doc_open', args: { path: pdfPath } },
    { tool: 'image_edit', args },
    { tool: 'doc_save', args: { doc: 1, path: pdfPath } },
    { tool: 'doc_close', args: { doc: 1 } }
  ];
  await runScript(steps);
  return pdfPath;
}

/**
 * Edit/replace an existing paragraph
 */
export async function editParagraph(
  pdfPath: string,
  pageNumber: number,
  paragraphNumber: number,
  newText: string,
  options: { font?: string; size?: number; color?: string; bold?: boolean; italic?: boolean } = {}
): Promise<string> {
  const editArgs: Record<string, any> = {
    doc: 1,
    page: pageNumber,
    paragraph: paragraphNumber,
    text: newText,
    ...options
  };

  const steps = [
    { tool: 'doc_open', args: { path: pdfPath } },
    { tool: 'text_edit', args: editArgs },
    { tool: 'doc_save', args: { doc: 1, path: pdfPath } },
    { tool: 'doc_close', args: { doc: 1 } }
  ];
  await runScript(steps);
  return pdfPath;
}

/**
 * Add a new text element to a page
 */
export async function addTextToPage(
  pdfPath: string,
  pageNumber: number,
  text: string,
  at: [number, number],
  options: { font?: string; size?: number; color?: string; bold?: boolean; italic?: boolean; width?: number } = {}
): Promise<string> {
  const addArgs: Record<string, any> = {
    doc: 1,
    page: pageNumber,
    text,
    at,
    size: options.size || 14,
    font: options.font || 'helvetica',
    color: options.color || '#222226',
    bold: options.bold || false,
    italic: options.italic || false,
    width: options.width || 300
  };

  const steps = [
    { tool: 'doc_open', args: { path: pdfPath } },
    { tool: 'page_add_text', args: addArgs },
    { tool: 'doc_save', args: { doc: 1, path: pdfPath } },
    { tool: 'doc_close', args: { doc: 1 } }
  ];
  await runScript(steps);
  return pdfPath;
}

/**
 * Add an image (or stamp/signature PNG) to a page
 */
export async function addImageToPage(
  pdfPath: string,
  pageNumber: number,
  imagePath: string,
  at: [number, number],
  width?: number,
  height?: number
): Promise<string> {
  const { cliPath } = getAppPaths();
  const imgArgs: Record<string, any> = {
    doc: 1,
    page: pageNumber,
    path: imagePath,
    at
  };
  if (width) imgArgs.width = width;
  if (height) imgArgs.height = height;

  const steps = [
    { tool: 'doc_open', args: { path: pdfPath } },
    { tool: 'page_add_image', args: imgArgs },
    { tool: 'doc_save', args: { doc: 1, path: pdfPath } },
    { tool: 'doc_close', args: { doc: 1 } }
  ];
  await runScript(steps);
  return pdfPath;
}

/**
 * Combine (merge) multiple PDF files
 */
export async function combinePdfs(filePaths: string[], outputPath: string): Promise<string> {
  const { cliPath } = getAppPaths();
  return new Promise((resolve, reject) => {
    execFile(cliPath, ['combine', ...filePaths, '--out', outputPath], (err, _stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(outputPath);
    });
  });
}

/**
 * Split a PDF into parts
 */
export async function splitPdf(pdfPath: string, every: number, outputDir: string): Promise<string[]> {
  const { cliPath } = getAppPaths();
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return new Promise((resolve, reject) => {
    execFile(cliPath, ['split', pdfPath, '--every', every.toString(), '--out-dir', outputDir], (err, _stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.pdf')).map(f => path.join(outputDir, f));
      resolve(files);
    });
  });
}

/**
 * Reorganize pages: rotate, delete, or reorder
 */
export async function reorganizePages(
  pdfPath: string,
  operations: {
    rotations?: Array<{ page: number; by: number }>;
    deletions?: number[];
  }
): Promise<string> {
  const steps: any[] = [{ tool: 'doc_open', args: { path: pdfPath } }];

  if (operations.rotations && operations.rotations.length > 0) {
    for (const r of operations.rotations) {
      steps.push({ tool: 'page_rotate', args: { doc: 1, page: r.page, by: r.by } });
    }
  }

  if (operations.deletions && operations.deletions.length > 0) {
    const sortedDesc = [...operations.deletions].sort((a, b) => b - a);
    for (const page of sortedDesc) {
      steps.push({ tool: 'page_delete', args: { doc: 1, page } });
    }
  }

  steps.push({ tool: 'doc_save', args: { doc: 1, path: pdfPath } });
  steps.push({ tool: 'doc_close', args: { doc: 1 } });

  await runScript(steps);
  return pdfPath;
}

/**
 * Protect PDF with user/owner password
 */
export async function protectPdf(pdfPath: string, userPassword: string, ownerPassword?: string): Promise<string> {
  const args: Record<string, any> = {
    doc: 1,
    user: userPassword
  };
  if (ownerPassword) args.owner = ownerPassword;

  const steps = [
    { tool: 'doc_open', args: { path: pdfPath } },
    { tool: 'doc_protect', args },
    { tool: 'doc_save', args: { doc: 1, path: pdfPath } },
    { tool: 'doc_close', args: { doc: 1 } }
  ];
  await runScript(steps);
  return pdfPath;
}

/**
 * Redact sensitive area
 */
export async function redactArea(pdfPath: string, pageNumber: number, rect: [number, number, number, number]): Promise<string> {
  const steps = [
    { tool: 'doc_open', args: { path: pdfPath } },
    { tool: 'redact_mark', args: { doc: 1, page: pageNumber, rect } },
    { tool: 'redact_apply', args: { doc: 1 } },
    { tool: 'doc_save', args: { doc: 1, path: pdfPath } },
    { tool: 'doc_close', args: { doc: 1 } }
  ];
  await runScript(steps);
  return pdfPath;
}

/**
 * Compress PDF (Reduce File Size using doc_reduce)
 */
export async function compressPdf(pdfPath: string): Promise<string> {
  const { tempDir } = getAppPaths();
  const outPath = path.join(tempDir, `reduced_${Date.now()}_${path.basename(pdfPath)}`);

  const steps = [
    { tool: 'doc_open', args: { path: pdfPath } },
    { tool: 'doc_reduce', args: { doc: 1, path: outPath } },
    { tool: 'doc_close', args: { doc: 1 } }
  ];

  await runScript(steps);

  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    fs.copyFileSync(outPath, pdfPath);
    try { fs.unlinkSync(outPath); } catch {}
  }
  return pdfPath;
}

/**
 * Add Watermark to PDF
 */
export async function watermarkPdf(
  pdfPath: string,
  text: string,
  options: { opacity?: number; color?: string; font_size?: number; rotation?: number } = {}
): Promise<string> {
  const steps = [
    { tool: 'doc_open', args: { path: pdfPath } },
    {
      tool: 'doc_watermark',
      args: {
        doc: 1,
        text,
        opacity: options.opacity ?? 0.35,
        color: options.color ?? '#D90429',
        rotation: options.rotation ?? 45,
        font_size: options.font_size ?? 48
      }
    },
    { tool: 'doc_save', args: { doc: 1, path: pdfPath } },
    { tool: 'doc_close', args: { doc: 1 } }
  ];

  await runScript(steps);
  return pdfPath;
}

/**
 * Export document text to plain text string
 */
export async function exportText(pdfPath: string): Promise<string> {
  const { tempDir } = getAppPaths();
  const outTxtPath = path.join(tempDir, `text_${Date.now()}.txt`);

  const steps = [
    { tool: 'doc_open', args: { path: pdfPath } },
    { tool: 'doc_export_text', args: { doc: 1, path: outTxtPath } },
    { tool: 'doc_close', args: { doc: 1 } }
  ];

  await runScript(steps);

  if (fs.existsSync(outTxtPath)) {
    const textContent = fs.readFileSync(outTxtPath, 'utf-8');
    try { fs.unlinkSync(outTxtPath); } catch {}
    return textContent;
  }
  return '';
}
