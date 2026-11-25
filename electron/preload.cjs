const { contextBridge, ipcRenderer } = require('electron');

const versionArgument = '--magicpdf-app-version=';

contextBridge.exposeInMainWorld('electronAPI', {
  appVersion: process.argv.findLast(argument => argument.startsWith(versionArgument))?.slice(versionArgument.length),
  onOpenPdf: (callback) => {
    const listener = (_event, filePath) => callback(filePath);
    ipcRenderer.on('open-pdf-file', listener);
    return () => ipcRenderer.removeListener('open-pdf-file', listener);
  },
  getInitialFile: () => ipcRenderer.invoke('get-initial-file'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  onRequestClose: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('request-close', listener);
    ipcRenderer.send('close-guard-ready');
    return () => ipcRenderer.removeListener('request-close', listener);
  },
  confirmDocuments: (documents, withVersions) => ipcRenderer.invoke('confirm-documents',documents,withVersions),
  closeConfirmed: () => ipcRenderer.send('close-confirmed'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  saveFileAs: (params) => ipcRenderer.invoke('save-file-as', params),
  saveFile: (params) => ipcRenderer.invoke('save-file', params),
  printDocument: (filePath) => ipcRenderer.invoke('print-document', filePath)
});
