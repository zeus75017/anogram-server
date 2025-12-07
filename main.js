const { app, BrowserWindow, ipcMain, Notification, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const https = require('https');
const http = require('http');

let mainWindow;

// ==================== AUTO UPDATER ====================
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function setupAutoUpdater() {
  // Vérifier les mises à jour au démarrage
  autoUpdater.checkForUpdates().catch(err => {
    console.log('Erreur vérification mise à jour:', err.message);
  });

  // Vérifier les mises à jour toutes les 30 minutes
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.log('Erreur vérification mise à jour:', err.message);
    });
  }, 30 * 60 * 1000);

  autoUpdater.on('checking-for-update', () => {
    console.log('Vérification des mises à jour...');
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Mise à jour disponible:', info.version);
    sendUpdateStatus('available', info);

    // Notifier l'utilisateur via le renderer
    if (mainWindow) {
      mainWindow.webContents.send('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes || '',
        releaseDate: info.releaseDate
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('Application à jour');
    sendUpdateStatus('not-available');
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent);
    console.log(`Téléchargement: ${percent}%`);
    sendUpdateStatus('downloading', { percent });

    if (mainWindow) {
      mainWindow.webContents.send('update-progress', {
        percent,
        bytesPerSecond: progressObj.bytesPerSecond,
        transferred: progressObj.transferred,
        total: progressObj.total
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Mise à jour téléchargée');
    sendUpdateStatus('downloaded', info);

    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', {
        version: info.version
      });
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Erreur auto-updater:', err.message);
    sendUpdateStatus('error', { message: err.message });
  });
}

function sendUpdateStatus(status, data = {}) {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { status, ...data });
  }
}

// IPC handlers pour les mises à jour
ipcMain.on('check-for-updates', () => {
  autoUpdater.checkForUpdates().catch(err => {
    console.log('Erreur vérification:', err.message);
  });
});

ipcMain.on('download-update', () => {
  autoUpdater.downloadUpdate().catch(err => {
    console.error('Erreur téléchargement:', err.message);
  });
});

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#17212b',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false
    },
    // icon: path.join(__dirname, 'public', 'icon.png') // Commenté car pas d'icône
  });

  mainWindow.loadFile('public/index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Set app name for Windows notifications
app.setAppUserModelId('Anogram');

app.whenReady().then(() => {
  console.log('Démarrage d\'Anogram...');
  createWindow();

  // Configurer l'auto-updater après le démarrage
  setTimeout(() => {
    setupAutoUpdater();
  }, 3000); // Attendre 3 secondes avant de vérifier les mises à jour
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Window controls
ipcMain.on('minimize-window', () => {
  mainWindow.minimize();
});

ipcMain.on('maximize-window', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('close-window', () => {
  mainWindow.close();
});

// Notification handler - Amélioration pour Windows
ipcMain.on('show-notification', async (event, data) => {
  const { title, body, iconUrl, conversationId } = data;

  console.log('Notification demandée:', title, body);

  // Vérifier si les notifications sont supportées
  if (!Notification.isSupported()) {
    console.log('Notifications non supportées sur ce système');
    return;
  }

  // Ne pas afficher de notification si la fenêtre est active et au premier plan
  if (mainWindow && mainWindow.isFocused()) {
    console.log('Fenêtre active, notification ignorée');
    return;
  }

  let icon = null;

  if (iconUrl) {
    try {
      // Télécharger l'image de l'avatar
      const imageData = await downloadImage(iconUrl);
      icon = nativeImage.createFromBuffer(imageData);
      // Redimensionner pour une meilleure apparence dans les notifications
      icon = icon.resize({ width: 64, height: 64 });
    } catch (e) {
      console.log('Erreur téléchargement avatar:', e.message);
    }
  }

  try {
    const notification = new Notification({
      title: title || 'Anogram',
      body: body || 'Nouveau message',
      icon: icon,
      silent: false,
      urgency: 'normal',
      timeoutType: 'default'
    });

    notification.on('click', () => {
      console.log('Notification cliquée');
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('notification-clicked', conversationId);
      }
    });

    notification.on('show', () => {
      console.log('Notification affichée avec succès');
    });

    notification.on('failed', (event, error) => {
      console.error('Échec notification:', error);
    });

    notification.show();
    console.log('Notification envoyée');

    // Faire clignoter l'icône dans la barre des tâches
    if (mainWindow && !mainWindow.isFocused()) {
      mainWindow.flashFrame(true);
    }
  } catch (error) {
    console.error('Erreur création notification:', error);
  }
});

// Helper function to download image
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}
