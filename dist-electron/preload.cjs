"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
console.log('Preload script loaded!');
electron_1.contextBridge.exposeInMainWorld('api', {
    hasMasterPassword: () => electron_1.ipcRenderer.invoke('has-master-password'),
    shouldPromptMasterPassword: () => electron_1.ipcRenderer.invoke('should-prompt-master-password'),
    setMasterPassword: (password) => electron_1.ipcRenderer.invoke('set-master-password', password),
    verifyMasterPassword: (password) => electron_1.ipcRenderer.invoke('verify-master-password', password),
    saveAccount: (account) => electron_1.ipcRenderer.invoke('save-account', account),
    updateAccount: (id, account) => electron_1.ipcRenderer.invoke('update-account', id, account),
    getAccounts: () => electron_1.ipcRenderer.invoke('get-accounts'),
    deleteAccount: (id) => electron_1.ipcRenderer.invoke('delete-account', id),
    launchAccount: (id) => electron_1.ipcRenderer.invoke('launch-account', id),
    getActiveAccountProcesses: () => electron_1.ipcRenderer.invoke('get-active-account-processes'),
    stopAccountProcess: (id) => electron_1.ipcRenderer.invoke('stop-account-process', id),
    isGw2Running: () => electron_1.ipcRenderer.invoke('is-gw2-running'),
    stopGw2Process: () => electron_1.ipcRenderer.invoke('stop-gw2-process'),
    getLaunchStates: () => electron_1.ipcRenderer.invoke('get-launch-states'),
    resolveAccountProfile: (apiKey) => electron_1.ipcRenderer.invoke('resolve-account-profile', apiKey),
    setAccountApiProfile: (id, profile) => electron_1.ipcRenderer.invoke('set-account-api-profile', id, profile),
    saveSettings: (settings) => electron_1.ipcRenderer.invoke('save-settings', settings),
    getSettings: () => electron_1.ipcRenderer.invoke('get-settings'),
    minimizeWindow: () => electron_1.ipcRenderer.send('minimize-window'),
    maximizeWindow: () => electron_1.ipcRenderer.send('maximize-window'),
    closeWindow: () => electron_1.ipcRenderer.send('close-window'),
    resetApp: () => electron_1.ipcRenderer.send('reset-app'),
});
