import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  getPdfInfo,
  renderPage,
  getPageParagraphs,
  editParagraph,
  addTextToPage,
  addImageToPage,
  combinePdfs,
  splitPdf,
  reorganizePages,
  protectPdf,
  redactArea
} from './pdfcraft.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.resolve(ROOT_DIR, 'storage', 'uploads');
const TEMP_DIR = path.resolve(ROOT_DIR, 'storage', 'temp');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/temp', express.static(TEMP_DIR));

// Configure file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const cleanName = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    cb(null, cleanName);
  }
});
const upload = multer({ storage });

/**
 * 1. Upload one or more PDFs
 */
app.post('/api/upload', upload.array('files', 20), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    const docs = [];
    for (const f of files) {
      const info = await getPdfInfo(f.path);
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
    console.error('Error in /api/upload:', error);
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
    const { filename, rotations, deletions } = req.body;
    const filePath = path.join(UPLOADS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    await reorganizePages(filePath, { rotations, deletions });
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
 * 13. Download PDF
 */
app.get('/api/download/:filename', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }
  res.download(filePath, req.params.filename);
});

app.listen(PORT, () => {
  console.log(`🚀 MagicPDF API Server running at http://localhost:${PORT}`);
});
