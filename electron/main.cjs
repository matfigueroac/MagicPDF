const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow = null;
let initialPdfPath = null;

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
      mainWindow.focus();
      if (newPdf) {
        mainWindow.webContents.send('open-pdf-file', newPdf);
      }
    }
  });
}

async function startBackendServer() {
  const candidateServerPaths = [
    path.join(__dirname, '..', 'dist-server', 'index.cjs'),
    path.join(__dirname, 'dist-server', 'index.cjs'),
    path.join(process.resourcesPath || '', 'app.asar', 'dist-server', 'index.cjs'),
  ];

  for (const sPath of candidateServerPaths) {
    if (fs.existsSync(sPath)) {
      try {
        const sModule = require(sPath);
        if (sModule && typeof sModule.startServer === 'function') {
          await sModule.startServer(3001);
          console.log('[Electron] In-process server started successfully on port 3001.');
          return;
        }
      } catch (err) {
        console.error('[Electron] Error running in-process server from', sPath, err);
      }
    }
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'MagicPDF Pro',
    backgroundColor: '#0A0A0E',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Check if Vite dev server (5174) is active, otherwise load from 3001 (Express static dist)
  let startUrl = 'http://127.0.0.1:3001';
  if (!app.isPackaged) {
    const devServerUp = await new Promise((resolve) => {
      const req = http.get('http://localhost:5174', (res) => resolve(res.statusCode < 500));
      req.on('error', () => resolve(false));
      req.setTimeout(400, () => { req.destroy(); resolve(false); });
    });
    if (devServerUp) {
      startUrl = 'http://localhost:5174';
    }
  }

  try {
    await mainWindow.loadURL(startUrl);
  } catch (err) {
    console.warn('[Electron] Could not load URL, falling back to local file:', err.message);
    const localFile = path.join(__dirname, '..', 'dist', 'index.html');
    if (fs.existsSync(localFile) && mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadFile(localFile);
    }
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (initialPdfPath) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-pdf-file', initialPdfPath);
        }
      }, 500);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('get-initial-file', () => {
  return initialPdfPath;
});

ipcMain.handle('save-file-as', async (_event, { defaultName, tempPath }) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar como...',
      defaultPath: defaultName || 'documento.pdf',
      filters: [{ name: 'Documento PDF (*.pdf)', extensions: ['pdf'] }]
    });
    if (!canceled && filePath && tempPath && fs.existsSync(tempPath)) {
      fs.copyFileSync(tempPath, filePath);
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
      fs.copyFileSync(tempPath, originalPath);
      return { success: true, filePath: originalPath };
    }
    return { success: false, error: 'Ruta no válida o archivo inexistente' };
  } catch (err) {
    console.error('Error in save-file:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('print-document', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.print();
  }
});

app.whenReady().then(async () => {
  await startBackendServer();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
