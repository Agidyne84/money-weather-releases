const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC channels to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Listen for menu-triggered export/import events
  onExportData: (callback) => ipcRenderer.on('export-data', callback),
  onImportData: (callback) => ipcRenderer.on('import-data', callback),

  // Native file dialogs
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:save', options),
  showOpenDialog: (options) => ipcRenderer.invoke('dialog:open', options),

  // File I/O (for Electron-native save/load of backup files)
  writeFile: (filePath, data) => ipcRenderer.invoke('fs:write', filePath, data),
  readFile: (filePath) => ipcRenderer.invoke('fs:read', filePath),

  // App info
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getPlatform: () => process.platform,

  // Auto-updater events
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', callback),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
});
