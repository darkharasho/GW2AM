import { contextBridge, ipcRenderer } from 'electron';
console.log('Preload script loaded!');
contextBridge.exposeInMainWorld('api', {
    hasMasterPassword: () => ipcRenderer.invoke('has-master-password'),
    setMasterPassword: (password) => ipcRenderer.invoke('set-master-password', password),
    verifyMasterPassword: (password) => ipcRenderer.invoke('verify-master-password', password),
    saveAccount: (account) => ipcRenderer.invoke('save-account', account),
    getAccounts: () => ipcRenderer.invoke('get-accounts'),
    deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),
    launchAccount: (id) => ipcRenderer.invoke('launch-account', id),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),
});
