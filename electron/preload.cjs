const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenPdf: (callback) => {
    ipcRenderer.on('open-pdf-file', (_event, filePath) => callback(filePath));
  },
  getInitialFile: () => ipcRenderer.invoke('get-initial-file'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  saveFileAs: (params) => ipcRenderer.invoke('save-file-as', params),
  saveFile: (params) => ipcRenderer.invoke('save-file', params),
  printDocument: () => ipcRenderer.invoke('print-document')
});
