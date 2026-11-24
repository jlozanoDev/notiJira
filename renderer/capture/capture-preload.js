const { contextBridge, ipcRenderer } = require('electron');

// Superficie minima: la ventana de captura no toca Jira ni GitLab.
contextBridge.exposeInMainWorld('api', {
  createBug: (payload) => ipcRenderer.invoke('bugs:create', payload),
  getBugContext: () => ipcRenderer.invoke('bugs:context'),
  getBugDraft: () => ipcRenderer.invoke('bugs:draft:get'),
  saveBugDraft: (draft) => ipcRenderer.invoke('bugs:draft:save', draft),
  clearBugDraft: () => ipcRenderer.invoke('bugs:draft:clear'),
  closeBugCapture: () => ipcRenderer.invoke('bugs:close'),
  onShown: (handler) => ipcRenderer.on('capture:shown', () => handler()),
});
