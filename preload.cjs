const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktopWindow', Object.freeze({
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  chooseProjectSource: () => ipcRenderer.invoke('project:choose-source'),
  getFilePath: (file) => webUtils.getPathForFile(file),
}));
