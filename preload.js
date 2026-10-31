const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  testConnection: (config) => ipcRenderer.invoke('jira:test', config),
  getNotifications: (config) => ipcRenderer.invoke('jira:notifications', config),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  notify: (payload) => ipcRenderer.invoke('notify', payload),
});
