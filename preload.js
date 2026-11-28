const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  testConnection: (config) => ipcRenderer.invoke('jira:test', config),
  getNotifications: (config) => ipcRenderer.invoke('jira:notifications', config),
  getGitlabProjects: (config, search) =>
    ipcRenderer.invoke('gitlab:projects', { config, search }),
  getGitlabBranches: (config, projectId, search) =>
    ipcRenderer.invoke('gitlab:branches', { config, projectId, search }),
  getGithubRepos: (config, search) =>
    ipcRenderer.invoke('github:repos', { config, search }),
  getGithubBranches: (config, repo, search) =>
    ipcRenderer.invoke('github:branches', { config, repo, search }),
  searchIssues: (config, query) =>
    ipcRenderer.invoke('jira:searchIssues', { config, query }),
  getIssueCopyData: (config, issueKey) =>
    ipcRenderer.invoke('jira:issueCopyData', { config, issueKey }),
  copyIssue: (config, payload) =>
    ipcRenderer.invoke('copy:issue', { config, ...payload }),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  notify: (payload) => ipcRenderer.invoke('notify', payload),

  // Bandeja de incidencias
  listBugs: () => ipcRenderer.invoke('bugs:list'),
  createBug: (payload) => ipcRenderer.invoke('bugs:create', payload),
  updateBug: (id, changes) => ipcRenderer.invoke('bugs:update', { id, changes }),
  deleteBug: (id) => ipcRenderer.invoke('bugs:delete', { id }),
  addBugImage: (id, image) => ipcRenderer.invoke('bugs:image:add', { id, image }),
  readBugImage: (id, filename) =>
    ipcRenderer.invoke('bugs:image:read', { id, filename }),
  deleteBugImage: (id, filename) =>
    ipcRenderer.invoke('bugs:image:delete', { id, filename }),
  getBugMarkdown: (id) => ipcRenderer.invoke('bugs:markdown', { id }),
  copyBugMarkdown: (id) => ipcRenderer.invoke('bugs:copyMarkdown', { id }),
  copyBugImagePaths: (id) => ipcRenderer.invoke('bugs:copyImagePaths', { id }),
  openBugFolder: (id) => ipcRenderer.invoke('bugs:openFolder', { id }),
  openBugCapture: () => ipcRenderer.invoke('bugs:openCapture'),
  closeBugCapture: () => ipcRenderer.invoke('bugs:close'),
  getBugContext: () => ipcRenderer.invoke('bugs:context'),
  getBugDraft: () => ipcRenderer.invoke('bugs:draft:get'),
  saveBugDraft: (draft) => ipcRenderer.invoke('bugs:draft:save', draft),
  clearBugDraft: () => ipcRenderer.invoke('bugs:draft:clear'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:writeText', text),

  // Actualizador
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
});
