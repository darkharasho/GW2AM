import { contextBridge, ipcRenderer } from 'electron';
import { Account, AppSettings } from './types.js';

console.log('Preload script loaded!');

contextBridge.exposeInMainWorld('api', {
    hasMasterPassword: () => ipcRenderer.invoke('has-master-password'),
    shouldPromptMasterPassword: () => ipcRenderer.invoke('should-prompt-master-password'),
    setMasterPassword: (password: string) => ipcRenderer.invoke('set-master-password', password),
    verifyMasterPassword: (password: string) => ipcRenderer.invoke('verify-master-password', password),

    saveAccount: (account: Omit<Account, 'id'>) => ipcRenderer.invoke('save-account', account),
    updateAccount: (id: string, account: Omit<Account, 'id'>) => ipcRenderer.invoke('update-account', id, account),
    getAccounts: () => ipcRenderer.invoke('get-accounts'),
    deleteAccount: (id: string) => ipcRenderer.invoke('delete-account', id),
    launchAccount: (id: string) => ipcRenderer.invoke('launch-account', id),
    getActiveAccountProcesses: () => ipcRenderer.invoke('get-active-account-processes'),
    stopAccountProcess: (id: string) => ipcRenderer.invoke('stop-account-process', id),
    isGw2Running: () => ipcRenderer.invoke('is-gw2-running'),
    stopGw2Process: () => ipcRenderer.invoke('stop-gw2-process'),

    getLaunchStates: () => ipcRenderer.invoke('get-launch-states'),
    resolveAccountProfile: (apiKey: string) => ipcRenderer.invoke('resolve-account-profile', apiKey),
    setAccountApiProfile: (id: string, profile: { name?: string; created?: string }) => ipcRenderer.invoke('set-account-api-profile', id, profile),

    saveSettings: (settings: AppSettings) => ipcRenderer.invoke('save-settings', settings),
    getSettings: () => ipcRenderer.invoke('get-settings'),

    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),
    resetApp: () => ipcRenderer.send('reset-app'),
});
