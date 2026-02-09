import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import store from './store.js';
import { deriveKey, encrypt, decrypt, generateSalt } from './crypto.js';
import { exec } from 'child_process';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let masterKey: Buffer | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    frame: false,
    // titleBarStyle: 'hidden', 
    resizable: true, // Allow resize but keep default small
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

app.on('ready', () => {
  console.log("User Data Path:", app.getPath('userData'));
  createWindow();
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

// Window Controls
ipcMain.on('minimize-window', () => {
  console.log('Main: minimize-window received');
  mainWindow?.minimize();
});
ipcMain.on('maximize-window', () => {
  console.log('Main: maximize-window received');
  if (mainWindow?.isMaximized()) mainWindow?.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('close-window', () => {
  console.log('Main: close-window received');
  mainWindow?.close();
});

// Security & Account Management
ipcMain.handle('has-master-password', async () => {
  return !!store.get('security_v2.salt');
});

ipcMain.handle('set-master-password', async (_, password) => {
  const salt = generateSalt();
  const key = deriveKey(password, Buffer.from(salt, 'hex'));
  const validationHash = crypto.createHash('sha256').update(key).digest('hex');

  store.set('security_v2.salt', salt);
  store.set('security_v2.validationHash', validationHash);
  masterKey = key;
  return true;
});

ipcMain.handle('verify-master-password', async (_, password) => {
  const salt = store.get('security_v2.salt');
  const storedHash = store.get('security_v2.validationHash');

  if (!salt || !storedHash) return false;

  // Cast salt to string because electron-store types might be inferred loosely
  const saltBuffer = Buffer.from(salt as string, 'hex');
  const key = deriveKey(password, saltBuffer);
  const hash = crypto.createHash('sha256').update(key).digest('hex');

  if (hash === storedHash) {
    masterKey = key;
    return true;
  }
  return false;
});

ipcMain.handle('save-account', async (_, accountData) => {
  if (!masterKey) throw new Error('Master key not set');

  // accountData contains raw password in 'passwordEncrypted' field momentarily from frontend?
  // Or we expect frontend to pass `password` and we map it.
  // The type in 'types.ts' for IPC argument was Omit<Account, 'id'> which includes passwordEncrypted.
  // Let's assume frontend passes `{ ...data, password: 'raw' }` and we ignore the type mismatch or fix it.
  // For safety, let's cast.

  // We'll treat the input 'passwordEncrypted' as the RAW password to be encrypted.
  const rawPassword = accountData.passwordEncrypted;
  const encryptedPassword = encrypt(rawPassword, masterKey);

  const id = crypto.randomUUID();
  const newAccount = {
    id,
    nickname: accountData.nickname,
    email: accountData.email,
    passwordEncrypted: encryptedPassword,
    launchArguments: accountData.launchArguments
  };

  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  store.set('accounts', [...accounts, newAccount]);
  return true;
});

ipcMain.handle('get-accounts', async () => {
  if (!masterKey) throw new Error('Master key not set');
  return store.get('accounts') || [];
});

ipcMain.handle('delete-account', async (_, id) => {
  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const newAccounts = accounts.filter((a: any) => a.id !== id);
  store.set('accounts', newAccounts);
  return true;
});

ipcMain.handle('launch-account', async (_, id) => {
  if (!masterKey) throw new Error('Master key not set');

  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const account = accounts.find((a: any) => a.id === id);
  if (!account) return;

  const password = decrypt(account.passwordEncrypted, masterKey);
  // @ts-ignore
  const settings = store.get('settings') as { gw2Path: string };
  const gw2Path = settings?.gw2Path;

  if (!gw2Path) {
    console.error("GW2 Path not set");
    return;
  }

  const command = `"${gw2Path}" -email "${account.email}" -password "${password}" ${account.launchArguments}`;
  console.log("Launching:", command.replace(password, '******'));

  exec(command, (error) => {
    if (error) console.error(`Exec error: ${error}`);
  });
});

ipcMain.handle('save-settings', async (_, settings) => {
  store.set('settings', settings);
});

ipcMain.handle('get-settings', async () => {
  return store.get('settings');
});
