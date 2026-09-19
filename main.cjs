const { app, BrowserWindow, dialog, ipcMain, screen } = require('electron');
const path = require('node:path');

let mainWindow = null;

function isTrustedSender(event) {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      BrowserWindow.fromWebContents(event.sender) === mainWindow &&
      event.senderFrame === event.sender.mainFrame,
  );
}

function registerWindowControls() {
  ipcMain.on('window:minimize', (event) => {
    if (isTrustedSender(event)) mainWindow.minimize();
  });

  ipcMain.on('window:toggle-maximize', (event) => {
    if (!isTrustedSender(event)) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });

  ipcMain.on('window:close', (event) => {
    if (isTrustedSender(event)) mainWindow.close();
  });

  ipcMain.handle('window:is-maximized', (event) =>
    isTrustedSender(event) ? mainWindow.isMaximized() : false,
  );

  ipcMain.handle('project:choose-folder', async (event) => {
    if (!isTrustedSender(event)) return [];
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '选择项目文件夹',
      buttonLabel: '选择此文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    return selection.canceled ? [] : selection.filePaths;
  });
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(960, workArea.width),
    height: Math.min(680, workArea.height),
    minWidth: 760,
    minHeight: 680,
    show: false,
    title: 'Colleague Agent',
    frame: false,
    transparent: false,
    autoHideMenuBar: true,
    ...(process.platform === 'win32' ? { backgroundMaterial: 'acrylic' } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocalDevelopmentUrl = url.startsWith('http://127.0.0.1:5173/');
    if (!isLocalDevelopmentUrl) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl) {
    mainWindow.loadURL(`${developmentUrl}/?electron=1`);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'), { query: { electron: '1' } });
  }
}

app.whenReady().then(() => {
  registerWindowControls();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
