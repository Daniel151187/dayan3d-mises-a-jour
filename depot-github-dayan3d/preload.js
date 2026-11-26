const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  logo: () => ipcRenderer.invoke('app:logo'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  savePdf: (html, filename) => ipcRenderer.invoke('pdf:save', { html, filename }),
  printHtml: (html) => ipcRenderer.invoke('pdf:print', { html }),
  notify: (title, body, target) => ipcRenderer.invoke('app:notify', { title, body, target }),
  onNavigate: (cb) => ipcRenderer.on('app:navigate', (_e, target) => cb(target)),
  diagHttp: (req) => ipcRenderer.invoke('diag:http', req),
  appVersion: () => ipcRenderer.invoke('app:version'),
  updateConfigure: (url) => ipcRenderer.invoke('update:configure', url),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, payload) => cb(payload)),
  mailStatus: () => ipcRenderer.invoke('mail:status'),
  mailSave: (user, pass) => ipcRenderer.invoke('mail:save', { user, pass }),
  mailClear: () => ipcRenderer.invoke('mail:clear'),
  mailTest: () => ipcRenderer.invoke('mail:test'),
  sendMail: (payload) => ipcRenderer.invoke('mail:send', payload),
});
