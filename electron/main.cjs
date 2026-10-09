const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let serverProcess = null;
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

function startBackendServer() {
  const http = require('http');
  const req = http.get('http://127.0.0.1:3001/api/info/__health', (res) => {
    // Server is already alive
  });

  req.on('error', () => {
    // Server is not running, spawn it
    const serverScript = path.join(__dirname, '..', 'server', 'index.ts');
    const tsxPath = path.join(__dirname, '..', 'node_modules', '.bin', 'tsx.cmd');
    
    serverProcess = spawn(tsxPath, [serverScript], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: '3001' },
      shell: true,
      stdio: 'ignore'
    });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server:', err);
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'MagicPDF Pro',
    backgroundColor: '#0A0A0E',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  // Load app (dev server or built dist)
  const isDev = !app.isPackaged;
  const startUrl = isDev 
    ? 'http://localhost:5174' 
    : `file://${path.join(__dirname, '..', 'dist', 'index.html')}`;

  mainWindow.loadURL(startUrl);

  mainWindow.webContents.on('did-finish-load', () => {
    if (initialPdfPath) {
      mainWindow.webContents.send('open-pdf-file', initialPdfPath);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('get-initial-file', () => {
  return initialPdfPath;
});

app.whenReady().then(() => {
  startBackendServer();
  // Wait a moment for server to bind or connect directly
  setTimeout(() => {
    createWindow();
  }, 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
