const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow = null;
let initialPdfPath = null;
let closeAllowed = false;
let closeGuardReady = false;
const { confirmDocuments } = require('./document-close.cjs');
const { savePdf } = require('./atomic-save.cjs');
const { createWindowsUpdates } = require('./windows-updates.cjs');
const { windowsUpdatePublisher, windowsUpdateChannel } = require('../package.json');
const appVersion = app.getVersion();
const windowsUpdates = createWindowsUpdates({
  dialog, publisher: windowsUpdatePublisher, version: appVersion, storeBuild: windowsUpdateChannel === 'store',
  enabled: process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE,
});
function uploadsDirectory() {
  return app.isPackaged ? path.join(process.env.APPDATA,'MagicPDF','uploads') : path.resolve(__dirname,'..','storage','uploads');
}

// Find PDF file passed in arguments (when opened via Windows "Abrir con" or double-click)
function findPdfInArgs(argv) {
  for (const arg of argv) {
    if (arg && arg.toLowerCase().endsWith('.pdf') && fs.existsSync(arg)) {
      return path.resolve(arg);
    }
  }
  return null;
}

initialPdfPath = findPdfInArgs(process.argv);

// Ensure single instance on Windows
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    // When a second instance is launched (e.g. user double-clicked another PDF)
    const newPdf = findPdfInArgs(commandLine);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (newPdf) mainWindow.maximize();
      mainWindow.focus();
      if (newPdf) {
        mainWindow.webContents.send('open-pdf-file', newPdf);
      }
    }
  });
}

async function workspaceUrl() {
  if (!app.isPackaged) {
    const devServerUp = await new Promise(resolve => {
      const req = http.get('http://localhost:5174', res => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(400, () => { req.destroy(); resolve(false); });
    });
    if (devServerUp) return 'http://localhost:5174';
  }
  const { startServer } = require('../dist-server/index.cjs');
  const port = await startServer(0);
  return `http://127.0.0.1:${port}`;
}

async function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'MagicPDF Pro Lite',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#20232b', symbolColor: '#d6dbe5', height: 40 },
    backgroundColor: '#0A0A0E',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [`--magicpdf-app-version=${appVersion}`],
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.maximize();
      mainWindow.show();
    }
  });

  await mainWindow.loadURL(startUrl);

  mainWindow.on('close', event => {
    if (!closeAllowed && closeGuardReady) {
      event.preventDefault();
      mainWindow.webContents.send('request-close');
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    closeAllowed = false;
    closeGuardReady = false;
  });
}

ipcMain.on('close-guard-ready', event => { if (event.sender === mainWindow?.webContents) closeGuardReady = true; });
ipcMain.handle('confirm-documents', async (event, documents, withVersions) => {
  if (event.sender !== mainWindow?.webContents || !Array.isArray(documents)) return false;
  try {
    const versions = {};
    const approved = await confirmDocuments(mainWindow, documents, dialog, uploadsDirectory(), versions);
    return approved && withVersions ? versions : approved;
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {type:'error',title:'No se pudo guardar',message:error.message,detail:'El documento permanece abierto. Guarda una copia antes de cerrar.'});
    return false;
  }
});
ipcMain.on('close-confirmed', event => {
  if (event.sender !== mainWindow?.webContents) return;
  closeAllowed = true;
  if (!windowsUpdates.installOnApprovedClose()) mainWindow.close();
});

ipcMain.handle('check-updates', async event => {
  if (event.sender === mainWindow?.webContents) await windowsUpdates.check(mainWindow);
});

ipcMain.handle('get-initial-file', () => {
  return initialPdfPath;
});

ipcMain.handle('open-file-dialog', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Abrir Documento PDF',
      filters: [{ name: 'Documentos PDF (*.pdf)', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections']
    });
    return { canceled, filePaths };
  } catch (err) {
    console.error('Error in open-file-dialog:', err);
    return { canceled: true, filePaths: [] };
  }
});

ipcMain.handle('save-file-as', async (_event, { defaultName, tempPath }) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar como...',
      defaultPath: defaultName || 'documento.pdf',
      filters: [{ name: 'Documento PDF (*.pdf)', extensions: ['pdf'] }]
    });
    if (!canceled && filePath && tempPath && fs.existsSync(tempPath)) {
      await savePdf(tempPath, filePath, uploadsDirectory());
      return { success: true, filePath };
    }
    return { success: false, canceled };
  } catch (err) {
    console.error('Error in save-file-as:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-file', async (_event, { originalPath, tempPath }) => {
  try {
    if (originalPath && tempPath && fs.existsSync(tempPath)) {
      await savePdf(tempPath, originalPath, uploadsDirectory());
      return { success: true, filePath: originalPath };
    }
    return { success: false, error: 'Ruta no válida o archivo inexistente' };
  } catch (err) {
    console.error('Error in save-file:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('print-document', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.pdf') || !fs.existsSync(filePath)) throw new Error('PDF no válido');
  const { pathToFileURL } = require('url');
  const printWindow = new BrowserWindow({ width: 1000, height: 800, title: 'Imprimir PDF — MagicPDF', webPreferences: { nodeIntegration: false, contextIsolation: true, webSecurity: true } });
  await printWindow.loadURL(pathToFileURL(filePath).href);
  // Chromium's PDF viewer supplies page range, paper size and print preview.
});

app.whenReady().then(async () => {
  const url = await workspaceUrl();
  await createWindow(url);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow(url);
    }
  });
}).catch(error => {
  dialog.showErrorBox('No se pudo iniciar MagicPDF', error.message);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
