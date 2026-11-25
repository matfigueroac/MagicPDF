import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { WorkCopies } from './work-copies.js';
const { savePdf, cleanSaveStages } = require('../electron/atomic-save.cjs');
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'fs';
import { addHighlight } from './annotations.js';
import {writeDrawing,writeDrawings,setDrawingLock,orderDrawings,setLayerProperties,readerScene} from './drawings.js';
import { transactionMiddleware, historyStatus, restoreHistory, withDocumentLock } from './history.js';
import { readForms, writeForms, addTextBox } from './pro.js';
import { recognizePdf } from './ocr.js';
import {
  getPdfInfo,
  renderPage,
  getRenderStatus,
  getPageParagraphs,
  editParagraph,
  addTextToPage,
  addImageToPage,
  combinePdfs,
  splitPdf,
  reorganizePages,
  protectPdf,
  redactArea,
  compressPdf,
  watermarkPdf,
  exportText,
  getPageLines,
  getPageImages,
  editImage,
  getAppPaths
} from './pdfcraft.js';

const { uploadsDir: UPLOADS_DIR, tempDir: TEMP_DIR } = getAppPaths();
const copies = new WorkCopies(UPLOADS_DIR);

const app = express();
const localOrigins: string[] = process.versions.electron && !process.defaultApp
  ? [] : ['http://localhost:5174', 'http://127.0.0.1:5174'];

app.use(cors({ origin: localOrigins }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !localOrigins.includes(origin)) return res.status(403).json({error:'Origen no permitido'});
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(transactionMiddleware(UPLOADS_DIR));
app.get('/api/scene/:filename',async(req,res)=>{try{res.json({annotations:(await readerScene(safeFile(req.params.filename))).annotations});}catch(e:any){res.status(400).json({error:e.message});}});
app.get('/api/reader-file/:filename',async(req,res)=>{try{const file=safeFile(req.params.filename),scene=await readerScene(file);if(scene.bytes)res.type('pdf').send(Buffer.from(scene.bytes));else res.sendFile(file);}catch(e:any){res.status(400).json({error:e.message});}});
app.post('/api/drawing',async(req,res)=>{try{const annotation=await writeDrawing(safeFile(req.body.filename),req.body.annotation,req.body.remove===true,req.body.fitText===true);res.json({success:true,annotation});}catch(e:any){res.status(400).json({error:e.message});}});
app.post('/api/drawing-batch',async(req,res)=>{try{const annotations=await writeDrawings(safeFile(req.body.filename),req.body.annotations,req.body.remove===true);res.json({success:true,annotations});}catch(e:any){res.status(400).json({error:e.message});}});
app.post('/api/annotation-lock',async(req,res)=>{try{const annotations=await setDrawingLock(safeFile(req.body.filename),req.body.ids,req.body.locked);res.json({success:true,annotations});}catch(e:any){res.status(400).json({error:e.message});}});
app.post('/api/annotation-order',async(req,res)=>{try{res.json({success:true,...await orderDrawings(safeFile(req.body.filename),req.body.ids,req.body.action)});}catch(e:any){res.status(400).json({error:e.message});}});
app.post('/api/annotation-layer',async(req,res)=>{try{res.json({success:true,...await setLayerProperties(safeFile(req.body.filename),req.body.scope,req.body.id,req.body.patch)});}catch(e:any){res.status(400).json({error:e.message});}});
function safeFile(name: unknown) {if(typeof name!=='string'||path.basename(name)!==name||/[\\/]/.test(name))throw new Error('Archivo inválido');return path.join(UPLOADS_DIR,name);}
app.get('/api/history/:filename',(req,res)=>res.json(historyStatus(req.params.filename)));
app.post('/api/history/:direction',async(req,res)=>{
  try {if(!['undo','redo'].includes(req.params.direction))throw new Error('Acción inválida');await restoreHistory(UPLOADS_DIR,req.body.filename,req.params.direction as 'undo'|'redo');const info=await getPdfInfo(safeFile(req.body.filename));res.json({success:true,info,...historyStatus(req.body.filename)});}
  catch(e:any){res.status(400).json({error:e.message});}
});
app.get('/api/forms/:filename',async(req,res)=>{try{res.json({fields:await readForms(safeFile(req.params.filename))});}catch(e:any){res.status(400).json({error:e.message});}});
app.post('/api/forms',async(req,res)=>{try{await writeForms(safeFile(req.body.filename),req.body.values);res.json({success:true});}catch(e:any){res.status(400).json({error:e.message});}});
app.post('/api/layout',async(req,res)=>{try{await addTextBox(safeFile(req.body.filename),req.body);res.json({success:true});}catch(e:any){res.status(400).json({error:e.message});}});
const ocrProgress=new Map<string,string>();
app.get('/api/ocr-status/:filename',(req,res)=>res.json({message:ocrProgress.get(req.params.filename)||''}));
app.post('/api/ocr',async(req,res)=>{
  const {filename,pages,language}=req.body;
  try{const results=await recognizePdf(safeFile(filename),pages,language,message=>ocrProgress.set(filename,message));res.json({success:true,results});}
  catch(e:any){res.status(400).json({error:e.message});}
  finally{ocrProgress.delete(filename);}
});
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/temp', express.static(TEMP_DIR));
const annotationWrites = new Set<string>();
app.post('/api/highlight', async (req, res) => {
  const {filename, page, rects, color, text, kind} = req.body;
  if (typeof filename !== 'string' || path.basename(filename) !== filename || /[\\/]/.test(filename)) return res.status(400).json({error:'Archivo inválido'});
  if (!Array.isArray(rects) || rects.some(r => !Array.isArray(r)) || typeof color !== 'string' || typeof text !== 'string') return res.status(400).json({error:'Selección inválida'});
  if (annotationWrites.has(filename)) return res.status(409).json({error:'Espera a que termine el guardado actual'});
  annotationWrites.add(filename);
  try { const annotation=await addHighlight(path.join(UPLOADS_DIR,filename),page,rects,color,text,kind); res.json({success:true,annotation}); }
  catch(error: any) { res.status(400).json({error:error.message}); }
  finally { annotationWrites.delete(filename); }
});

// Health check endpoint
app.get('/api/info/__health', (_req, res) => {
  res.json({ ok: true, status: 'ready', timestamp: Date.now(), renders:getRenderStatus() });
});

// Configure file uploads
async function discardFailedCopy(file: string, keepFile = false) {
  try {
    await copies.abort(path.basename(file), keepFile);
  } catch (error) {
    console.warn('No se pudo limpiar la copia de apertura', error);
  }
}

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    copies.begin(file.originalname).then(name => cb(null, name), error => cb(error, ''));
  }
});
const storage: multer.StorageEngine = {
  _handleFile: diskStorage._handleFile.bind(diskStorage),
  _removeFile(req, file, done) {
    const filename = file.filename || path.basename(file.path);
    diskStorage._removeFile(req, file, error => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ENOENT') return done(error);
      copies.abort(filename, true).then(() => done(null), done);
    });
  },
};
const upload = multer({ storage, defParamCharset: 'utf8' }).array('files', 20);

/**
 * 1. Upload one or more PDFs
 */
app.post('/api/upload', (req, res, next) => upload(req, res, error => {
  if (error) return res.status(400).json({error:error.message});
  next();
}), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    const docs = [];
    for (const f of files) {
      const info = await getPdfInfo(f.path);
      await copies.ready(f.filename);
      docs.push({
        id: path.basename(f.path),
        name: f.originalname,
        filename: path.basename(f.path),
        path: f.path,
        pages: info.pages,
        size: f.size
      });
    }

    res.json({ success: true, documents: docs });
  } catch (error: any) {
    await Promise.all((req.files as Express.Multer.File[] || []).map(file => discardFailedCopy(file.path)));
    console.error('Error in /api/upload:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 1b. Open a PDF directly from local disk path (for Windows file association)
 */
app.post('/api/open-file-path', async (req, res) => {
  let failedCopy: string | undefined;
  try {
    const { targetPath } = req.body;
    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const filename = await copies.begin(path.basename(targetPath), path.resolve(targetPath));
    const destPath = path.join(UPLOADS_DIR, filename);
    failedCopy = destPath;
    await fs.promises.copyFile(targetPath, destPath, fs.constants.COPYFILE_EXCL);

    const info = await getPdfInfo(destPath);
    await copies.ready(filename);
    res.json({
      success: true,
      document: {
        id: filename,
        name: path.basename(targetPath),
        filename,
        path: destPath,
        originalDiskPath: targetPath,
        pages: info.pages,
        size: fs.statSync(destPath).size
      }
    });
  } catch (error: any) {
    if (failedCopy) await discardFailedCopy(failedCopy, error.code === 'EEXIST');
    console.error('Error in /api/open-file-path:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 2. Get Document info
 */
app.get('/api/info/:filename', async (req, res) => {
  try {
    const filePath = path.join(UPLOADS_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    const info = await getPdfInfo(filePath);
    res.json({ success: true, info });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 3. Render a page to high-res PNG image
 */
app.get('/api/page-image/:filename/:page', async (req, res) => {
  try {
    const filePath = path.join(UPLOADS_DIR, req.params.filename);
    const pageNum = parseInt(req.params.page, 10) || 1;
    const dpi = parseInt(req.query.dpi as string, 10) || 120;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const imagePath = await renderPage(filePath, pageNum, dpi);
    res.sendFile(imagePath);
  } catch (error: any) {
    console.error('Error in /api/page-image:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 4. Get editable paragraphs on a page
 */
app.get('/api/paragraphs/:filename/:page', async (req, res) => {
  try {
    const filePath = path.join(UPLOADS_DIR, req.params.filename);
    const pageNum = parseInt(req.params.page, 10) || 1;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const paragraphs = await getPageParagraphs(filePath, pageNum);
    res.json({ success: true, page: pageNum, paragraphs });
  } catch (error: any) {
    console.error('Error in /api/paragraphs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 4b. Get individual text lines for exact text selection & highlighting
 */
app.get('/api/lines/:filename/:page', async (req, res) => {
  try {
    const filePath = path.join(UPLOADS_DIR, req.params.filename);
    const pageNum = parseInt(req.params.page, 10) || 1;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    const lines = await getPageLines(filePath, pageNum);
    res.json({ success: true, page: pageNum, lines });
  } catch (error: any) {
    console.error('Error in /api/lines:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 4c. Get recognized images on a page
 */
app.get('/api/images/:filename/:page', async (req, res) => {
  try {
    const filePath = path.join(UPLOADS_DIR, req.params.filename);
    const pageNum = parseInt(req.params.page, 10) || 1;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    const images = await getPageImages(filePath, pageNum);
    res.json({ success: true, page: pageNum, images });
  } catch (error: any) {
    console.error('Error in /api/images:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 4d. Edit an image on a page (delete, rotate, replace)
 */
app.post('/api/image-edit', async (req, res) => {
  try {
    const { filename, page, image, action, newImagePath, quarters, rect } = req.body;
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    await editImage(filePath, page, image, action, {
      path: newImagePath,
      quarters,
      rect
    });
    res.json({ success: true, message: 'Imagen modificada exitosamente' });
  } catch (error: any) {
    console.error('Error in /api/image-edit:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 5. Edit an existing paragraph text (WYSIWYG Edit)
 */
app.post('/api/edit-text', async (req, res) => {
  try {
    const { filename, page, paragraph, text, font, size, color, bold, italic } = req.body;
    const filePath = path.join(UPLOADS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    await editParagraph(filePath, page, paragraph, text, { font, size, color, bold, italic });
    res.json({ success: true, message: 'Texto actualizado' });
  } catch (error: any) {
    console.error('Error in /api/edit-text:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 6. Add new text element
 */
app.post('/api/add-text', async (req, res) => {
  try {
    const { filename, page, text, at, font, size, color, bold, italic, width } = req.body;
    const filePath = path.join(UPLOADS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    await addTextToPage(filePath, page, text, at, { font, size, color, bold, italic, width });
    res.json({ success: true, message: 'Texto añadido exitosamente' });
  } catch (error: any) {
    console.error('Error in /api/add-text:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 7. Reorganize pages (Rotate, delete, reorder)
 */
app.post('/api/organize', async (req, res) => {
  try {
    const { filename, rotations, deletions, order } = req.body;
    const filePath = safeFile(filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    await reorganizePages(filePath, { rotations, deletions, order });
    const updatedInfo = await getPdfInfo(filePath);

    res.json({ success: true, message: 'Páginas organizadas', info: updatedInfo });
  } catch (error: any) {
    console.error('Error in /api/organize:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 8. Combine / Merge multiple PDFs
 */
app.post('/api/combine', async (req, res) => {
  try {
    const { filenames, outputName } = req.body;
    if (!filenames || filenames.length < 2) {
      return res.status(400).json({ error: 'Se necesitan al menos 2 archivos para unir' });
    }

    const filePaths = filenames.map((f: string) => path.join(UPLOADS_DIR, f));
    for (const fp of filePaths) {
      if (!fs.existsSync(fp)) {
        return res.status(404).json({ error: `Archivo no encontrado: ${path.basename(fp)}` });
      }
    }

    const outFilename = `combined_${Date.now()}_${outputName || 'merged.pdf'}`;
    const outPath = path.join(UPLOADS_DIR, outFilename);

    await combinePdfs(filePaths, outPath);
    const info = await getPdfInfo(outPath);

    res.json({ success: true, filename: outFilename, info });
  } catch (error: any) {
    console.error('Error in /api/combine:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 9. Split PDF
 */
app.post('/api/split', async (req, res) => {
  try {
    const { filename, every } = req.body;
    const filePath = path.join(UPLOADS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const splitDirName = `split_${Date.now()}_${path.basename(filename, '.pdf')}`;
    const splitDir = path.join(UPLOADS_DIR, splitDirName);

    const parts = await splitPdf(filePath, every || 1, splitDir);
    const partNames = parts.map(p => path.join(splitDirName, path.basename(p)));

    res.json({ success: true, parts: partNames });
  } catch (error: any) {
    console.error('Error in /api/split:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 10. Stamp Signature onto page
 */
app.post('/api/sign', async (req, res) => {
  try {
    const { filename, page, signatureBase64, at, width, height } = req.body;
    const filePath = path.join(UPLOADS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Save base64 image to temporary PNG
    const base64Data = signatureBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const sigPath = path.join(TEMP_DIR, `sig_${Date.now()}.png`);
    fs.writeFileSync(sigPath, buffer);

    await addImageToPage(filePath, page, sigPath, at, width || 150, height || 60);

    res.json({ success: true, message: 'Firma estampada exitosamente' });
  } catch (error: any) {
    console.error('Error in /api/sign:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 11. Redact (Censor) an area permanently
 */
app.post('/api/redact', async (req, res) => {
  try {
    const { filename, page, rect } = req.body;
    const filePath = path.join(UPLOADS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    await redactArea(filePath, page, rect);
    res.json({ success: true, message: 'Área censurada exitosamente' });
  } catch (error: any) {
    console.error('Error in /api/redact:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 12. Protect with Password
 */
app.post('/api/protect', async (req, res) => {
  try {
    const { filename, password } = req.body;
    const filePath = path.join(UPLOADS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    await protectPdf(filePath, password);
    res.json({ success: true, message: 'Documento protegido con contraseña' });
  } catch (error: any) {
    console.error('Error in /api/protect:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 13. Download PDF (fallback)
 */
app.get('/api/download/:filename', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }
  res.download(filePath, req.params.filename);
});

/**
 * 14. Compress PDF (Reduce Size)
 */
app.post('/api/compress', async (req, res) => {
  try {
    const { filename } = req.body;
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    const beforeSize = fs.statSync(filePath).size;
    await compressPdf(filePath);
    const afterSize = fs.statSync(filePath).size;
    res.json({
      success: true,
      message: 'PDF optimizado y comprimido exitosamente',
      beforeSize,
      afterSize,
      reducedPercent: Math.round(((beforeSize - afterSize) / beforeSize) * 100)
    });
  } catch (error: any) {
    console.error('Error in /api/compress:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 15. Watermark PDF
 */
app.post('/api/watermark', async (req, res) => {
  try {
    const { filename, text, opacity, color, rotation, fontSize } = req.body;
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    await watermarkPdf(filePath, text, {
      opacity: opacity ? parseFloat(opacity) : 0.3,
      color: color || '#EF4444',
      rotation: rotation ? parseFloat(rotation) : 45,
      font_size: fontSize ? parseFloat(fontSize) : 44
    });
    res.json({ success: true, message: 'Marca de agua aplicada exitosamente' });
  } catch (error: any) {
    console.error('Error in /api/watermark:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 16. Export Text from PDF
 */
app.get('/api/export-text/:filename', async (req, res) => {
  try {
    const filePath = path.join(UPLOADS_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    const text = await exportText(filePath);
    res.json({ success: true, text });
  } catch (error: any) {
    console.error('Error in /api/export-text:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 17. Save / Overwrite file to custom target path on disk
 */
app.post('/api/save-to-path', async (req, res) => {
  try {
    const { filename, targetPath } = req.body;
    const filePath = safeFile(filename);
    if (!targetPath) {
      return res.status(400).json({ error: 'Ruta de destino requerida' });
    }
    await withDocumentLock(filename, () => savePdf(filePath, targetPath, UPLOADS_DIR));
    res.json({ success: true, message: `Guardado en ${targetPath}`, path: targetPath });
  } catch (error: any) {
    console.error('Error in /api/save-to-path:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/workspace/recoveries', async (_req, res) => {
  try { res.json(await copies.recoveries()); }
  catch { res.status(500).json({error:'No se pudieron leer las copias recuperables.'}); }
});
app.get('/api/workspace/recoveries/:filename', (req, res) => {
  const entry = copies.recovery(req.params.filename);
  if (!entry) return res.sendStatus(404);
  res.download(safeFile(entry.filename), entry.name);
});
app.delete('/api/workspace/recoveries/:filename', async (req, res) => {
  try { await withDocumentLock(req.params.filename, () => copies.discard(req.params.filename)); res.sendStatus(204); }
  catch (error: any) { res.status(400).json({error:error.message}); }
});
app.post('/api/workspace/release', async (req, res) => {
  try {
    const { filename, approvedVersion } = req.body;
    await withDocumentLock(filename, () => copies.release(filename, approvedVersion));
    res.sendStatus(204);
  } catch (error: any) { res.status(500).json({error:error.message}); }
});
app.post('/api/workspace/detach', (req, res) => {
  if (!Array.isArray(req.body.filenames)) return res.sendStatus(400);
  for (const filename of req.body.filenames) copies.detach(filename);
  res.sendStatus(204);
});

// Serve static frontend in production if dist directory exists
const candidateDists = [
  path.join(__dirname, '..', 'dist'),
  path.join(__dirname, 'dist'),
  process.resourcesPath ? path.join(process.resourcesPath, 'app.asar', 'dist') : '',
  path.join(process.cwd(), 'dist')
].filter(Boolean);

const distDir = candidateDists.find(d => fs.existsSync(d) && fs.existsSync(path.join(d, 'index.html')));

if (distDir) {
  console.log(`[Server] Serving frontend build from: ${distDir}`);
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/temp')) {
      return next();
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

let starting: Promise<number> | undefined;

export function startServer(port = 3001): Promise<number> {
  if (starting) return starting;
  starting = Promise.all([copies.start(), cleanSaveStages(UPLOADS_DIR)]).then(() => new Promise<number>((resolve, reject) => {
    const server: Server = app.listen(port, '127.0.0.1', () => {
      const actualPort = (server.address() as AddressInfo).port;
      const origin = `http://127.0.0.1:${actualPort}`;
      localOrigins.push(origin);
      console.log(`MagicPDF API disponible en ${origin}`);
      resolve(actualPort);
    });
    server.once('error', reject);
  })).catch(error => {
    starting = undefined;
    throw error;
  });
  return starting;
}

// Automatically start only if executed directly as entry script (not required or in Electron)
if (!process.versions.electron && typeof process !== 'undefined') {
  const isMain = process.argv[1] && (process.argv[1].includes('index.ts') || process.argv[1].includes('index.cjs'));
  if (isMain) {
    startServer(Number(process.env.PORT) || 3001).catch(console.error);
  }
}
