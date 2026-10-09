const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenPdf: (callback) => {
    ipcRenderer.on('open-pdf-file', (_event, filePath) => callback(filePath));
  },
  getInitialFile: () => ipcRenderer.invoke('get-initial-file')
});
