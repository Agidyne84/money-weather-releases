const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const childProcess = require('child_process');
const net = require('net');

const { autoUpdater } = require('electron-updater');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
let serverProcess = null;
let serverPort = 3001;

// ── Find a free port ─────────────────────────────────────────────────────────
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

// ── Start the Express server as a child process ──────────────────────────────
function findServerEntry() {
  // In production, server/ is placed at resources/server/ via extraResources.
  // This is a real filesystem path, so require() and node_modules both work.
  // In dev mode, server is at electron/server/ (copied by copy-deps.ps1).
  const candidates = [
    // Production: extraResources puts it at resources/server/
    path.join(process.resourcesPath, 'server', 'dist', 'server', 'src', 'index.js'),
    // Dev mode: __dirname = electron/, server is at ./server/
    path.join(__dirname, 'server', 'dist', 'server', 'src', 'index.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    'Server entry point not found. Looked in:\n' +
      candidates.map((c) => '  ' + c).join('\n')
  );
}

async function startServer() {
  if (isDev) {
    // In dev mode, assume server is already running externally
    serverPort = 3001;
    return;
  }

  // Use fixed port for production so client (built with hardcoded 3001) can connect
  serverPort = 3001;

  // Set DB path to user data directory for production isolation
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, 'database');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Set environment before requiring the server module
  process.env.PORT = String(serverPort);
  process.env.BUDGET_DB_PATH = path.join(dbDir, 'budget.db');
  process.env.NODE_ENV = 'production';

  // Prevent process.exit from killing the Electron app on server error
  const originalExit = process.exit;
  process.exit = (code) => {
    console.error(`[Server] Server tried to exit with code ${code}, intercepted.`);
    throw new Error(`Server startup failed (exit code ${code})`);
  };

  try {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Resolve the compiled server entry point
        const serverEntry = findServerEntry();
        const serverModule = require(serverEntry);
        const startFn = serverModule?.startServer || serverModule?.default;
        if (typeof startFn === 'function') {
          await startFn();
        } else {
          // Fallback: the module auto-started (old behavior)
          console.log('[Server] Module auto-started');
        }
        break; // success
      } catch (err) {
        lastErr = err;
        const isAddrInUse = err?.message?.includes('EADDRINUSE') || err?.code === 'EADDRINUSE';
        if (isAddrInUse && attempt < 3) {
          console.log(`[Server] Port ${serverPort} in use (old process still dying), retrying in 3s... (attempt ${attempt}/3)`);
          // On first retry, try to kill any process holding the port (Windows)
          if (attempt === 1 && process.platform === 'win32') {
            try {
              const { execSync } = require('child_process');
              // Find PID using port 3001 and kill it
              const netstat = execSync(`netstat -ano | findstr :${serverPort}`, { encoding: 'utf8', windowsHide: true });
              const lines = netstat.split('\n').filter(l => l.includes('LISTENING'));
              for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && !isNaN(parseInt(pid))) {
                  console.log(`[Server] Killing old process holding port ${serverPort}: PID ${pid}`);
                  try { execSync(`taskkill /F /PID ${pid}`, { windowsHide: true }); } catch {}
                }
              }
            } catch (e) {
              // No process found or taskkill failed — continue to wait
            }
          }
          // Clear require cache so next attempt gets a fresh Express app instance
          const serverEntry = findServerEntry();
          delete require.cache[require.resolve(serverEntry)];
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        throw err;
      }
    }
  } finally {
    process.exit = originalExit;
  }

  // Wait for server to be ready (health check)
  await waitForServer(serverPort, 10000);
}

function waitForServer(port, timeout) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = net.createConnection({ port, host: '127.0.0.1' }, () => {
        req.destroy();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error('Server start timeout'));
        } else {
          setTimeout(check, 200);
        }
      });
    };
    check();
  });
}

// ── Stop the server ──────────────────────────────────────────────────────────
function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  // In inline mode, call the server's exported stopServer to close HTTP connections
  try {
    const serverEntry = findServerEntry();
    const serverModule = require(serverEntry);
    if (typeof serverModule?.stopServer === 'function') {
      serverModule.stopServer();
    }
  } catch (e) {
    // Ignore errors during shutdown
  }
}

// ── Create the main window ───────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
  });

  // Content Security Policy for production
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:${serverPort} http://localhost:${serverPort}; img-src 'self' data:;`
        ],
      },
    });
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, 'client', 'dist', 'index.html');
    if (!fs.existsSync(indexPath)) {
      dialog.showErrorBox('Startup Error', 'App files not found at: ' + indexPath);
      app.quit();
      return;
    }
    mainWindow.loadFile(indexPath);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    dialog.showErrorBox('Load Error', `Failed to load app: ${errorDescription} (${errorCode})`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates',
          click: () => {
            console.log('[Updater] Manual check triggered from menu');
            autoUpdater.checkForUpdates().catch((err) => {
              console.error('[Updater] Manual check failed:', err.message);
              dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Update Check Failed',
                message: 'Could not check for updates.',
                detail: err.message,
                buttons: ['OK'],
              }).catch(() => {});
            });
          },
        },
        { type: 'separator' },
        {
          label: `Version ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

// Native Save dialog
ipcMain.handle('dialog:save', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options?.title || 'Save File',
    defaultPath: options?.defaultPath || 'budget-backup',
    filters: options?.filters || [
      { name: 'Budget Backup', extensions: ['budgetbackup'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result;
});

// Native Open dialog
ipcMain.handle('dialog:open', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options?.title || 'Open File',
    filters: options?.filters || [
      { name: 'Budget Backup', extensions: ['budgetbackup', 'json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  return result;
});

// Native Open Directory dialog
ipcMain.handle('dialog:open-directory', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options?.title || 'Select Folder',
    properties: ['openDirectory'],
  });
  return result;
});

// File write
ipcMain.handle('fs:write', async (event, filePath, data) => {
  await fs.promises.writeFile(filePath, Buffer.from(data));
  return { success: true };
});

// File read
ipcMain.handle('fs:read', async (event, filePath) => {
  const buffer = await fs.promises.readFile(filePath);
  return buffer;
});

// App version
ipcMain.handle('app:version', () => {
  return app.getVersion();
});

// ── Auto-updater ─────────────────────────────────────────────────────────────
let pendingInstallOnQuit = false;

function setupAutoUpdaterHandlers() {
  // Auto-download immediately when an update is found; install on quit
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // we handle install-on-quit manually to show NSIS UI

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version, '— downloading silently');
    // Show taskbar progress bar so user knows something is happening
    if (mainWindow) mainWindow.setProgressBar(2); // indeterminate
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] App is up to date.');
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    console.log(`[Updater] Download progress: ${pct}%`);
    if (mainWindow) {
      mainWindow.setProgressBar(progress.percent / 100);
      // Send progress to renderer so UI can show a visual indicator
      mainWindow.webContents.send('update-download-progress', {
        percent: pct,
        transferred: progress.transferred,
        total: progress.total,
      });
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
    if (mainWindow) mainWindow.setProgressBar(-1);
  });

  // Check for updates shortly after launch
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.log('[Updater] Check skipped (update server not reachable):', err.message);
    });
  }, 3000);
}

// ── App lifecycle ────────────────────────────────────────────────────────────
// autoInstallOnAppQuit is set in setupAutoUpdaterHandlers.
// When the user picks "Install on Next Launch", the update installs
// automatically when they close the app — no extra startup check needed.

const VERSION_FILE = path.join(app.getPath('userData'), 'last-version.json');
const OLD_MARKER_PATH = path.join(app.getPath('userData'), 'updating-to.json');

function writeCurrentVersion() {
  try {
    fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: app.getVersion(), date: Date.now() }), 'utf8');
  } catch (e) {
    console.error('[Version] Failed to write version file:', e.message);
  }
}

function checkAndShowUpdateComplete() {
  try {
    // Clean up old marker file from previous versions
    if (fs.existsSync(OLD_MARKER_PATH)) {
      fs.unlinkSync(OLD_MARKER_PATH);
    }

    const currentVersion = app.getVersion();
    if (fs.existsSync(VERSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
      const lastVersion = data.version;

      // Only show dialog when version actually changed (successful update)
      if (lastVersion && lastVersion !== currentVersion) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Installed',
          message: `Money Weather has been updated to version ${currentVersion}.`,
          detail: `Previous version: ${lastVersion}`,
          buttons: ['OK'],
        }).catch(() => {});
      }
    }

    // Always record current version for next startup comparison
    writeCurrentVersion();
  } catch (e) {
    console.error('[Version] Failed to check version:', e.message);
    writeCurrentVersion();
  }
}

autoUpdater.on('update-downloaded', (info) => {
  console.log('[Updater] Update downloaded:', info.version);
  if (mainWindow) {
    mainWindow.setProgressBar(-1);
    mainWindow.webContents.send('update-downloaded');
  }

  // Ensure we have a valid window reference for dialog parent
  const dialogParent = mainWindow || BrowserWindow.getFocusedWindow() || undefined;

  // Notify user and offer to restart now or on next launch
  dialog.showMessageBox(dialogParent, {
    type: 'info',
    title: 'Update Ready to Install',
    message: `Money Weather ${info.version} has been downloaded.`,
    detail: 'Restart now to apply the update, or it will be installed when you close the app.',
    buttons: ['Restart Now', 'Install on Next Launch'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) {
      // Restart Now — install silently and restart immediately
      // isSilent=true runs NSIS with /S flag (no UI prompts)
      // isForceRunAfter=true ensures app restarts after install
      autoUpdater.quitAndInstall(true, true);
    } else {
      // "Install on Next Launch" — flag so we call quitAndInstall on next quit (silent)
      pendingInstallOnQuit = true;
      dialog.showMessageBox(dialogParent, {
        type: 'warning',
        title: 'Update Ready',
        message: 'The update will install silently when you close the app.',
        detail: 'Please wait for the installer to finish before reopening.',
        buttons: ['OK'],
      }).catch(() => {});
    }
  });
});

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
    setupAutoUpdaterHandlers();
    // If we just finished an update, show the user a confirmation
    setTimeout(() => checkAndShowUpdateComplete(), 1500);
  } catch (err) {
    console.error('Failed to start server:', err);
    dialog.showErrorBox('Startup Error', err?.message || String(err));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (pendingInstallOnQuit) {
    pendingInstallOnQuit = false;
    console.log('[Updater] Running silent installer on quit');
    autoUpdater.quitAndInstall(true, true);
    return;
  }
  stopServer();
});
