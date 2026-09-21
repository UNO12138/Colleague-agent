const { app, BrowserWindow, dialog, ipcMain, screen } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

let mainWindow = null;
let agentProcess = null;

// Hardware acceleration is the default. Set ELECTRON_SOFTWARE_RENDERING=1 only
// when diagnosing a machine whose GPU process cannot create the window.
if (process.env.ELECTRON_SOFTWARE_RENDERING === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

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

function startLocalAgent() {
  if (agentProcess && !agentProcess.killed) return;
  const envFile = path.join(__dirname, '.env.local');
  agentProcess = spawn(
    process.execPath,
    [`--env-file-if-exists=${envFile}`, path.join(__dirname, 'agent-server.cjs')],
    {
      cwd: __dirname,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  agentProcess.once('exit', () => {
    agentProcess = null;
  });
}

function stopLocalAgent() {
  if (!agentProcess || agentProcess.killed) return;
  agentProcess.kill();
  agentProcess = null;
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const designWidth = 1512;
  const designHeight = 912;
  const screenMargin = 16;
  mainWindow = new BrowserWindow({
    width: Math.min(designWidth, workArea.width - screenMargin * 2),
    height: Math.min(designHeight, workArea.height - screenMargin * 2),
    minWidth: 760,
    minHeight: 680,
    center: true,
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
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F5' || input.isAutoRepeat) return;
    event.preventDefault();
    mainWindow.webContents.reloadIgnoringCache();
  });
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
  startLocalAgent();
  registerWindowControls();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', stopLocalAgent);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
