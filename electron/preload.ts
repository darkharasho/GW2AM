import { contextBridge, ipcRenderer } from 'electron';
import { Account, AppSettings } from './types.js';

console.log('Preload script loaded!');

contextBridge.exposeInMainWorld('api', {
    hasMasterPassword: () => ipcRenderer.invoke('has-master-password'),
    setMasterPassword: (password: string) => ipcRenderer.invoke('set-master-password', password),
    verifyMasterPassword: (password: string) => ipcRenderer.invoke('verify-master-password', password),

    saveAccount: (account: Omit<Account, 'id'>) => ipcRenderer.invoke('save-account', account),
    getAccounts: () => ipcRenderer.invoke('get-accounts'),
    deleteAccount: (id: string) => ipcRenderer.invoke('delete-account', id),
    launchAccount: (id: string) => ipcRenderer.invoke('launch-account', id),

    saveSettings: (settings: AppSettings) => ipcRenderer.invoke('save-settings', settings),
    getSettings: () => ipcRenderer.invoke('get-settings'),

    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),
});
