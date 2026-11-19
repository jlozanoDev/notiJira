const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  testConnection: (config) => ipcRenderer.invoke('jira:test', config),
  getNotifications: (config) => ipcRenderer.invoke('jira:notifications', config),
  getGitlabProjects: (config) => ipcRenderer.invoke('gitlab:projects', config),
  getGitlabBranches: (config, projectId) =>
    ipcRenderer.invoke('gitlab:branches', { config, projectId }),
  searchIssues: (config, query) =>
    ipcRenderer.invoke('jira:searchIssues', { config, query }),
  getIssueCopyData: (config, issueKey) =>
    ipcRenderer.invoke('jira:issueCopyData', { config, issueKey }),
  copyIssue: (config, payload) =>
    ipcRenderer.invoke('copy:issue', { config, ...payload }),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  notify: (payload) => ipcRenderer.invoke('notify', payload),
});
