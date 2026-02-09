/// <reference types="vite/client" />
import { Account, AppSettings } from './types';

declare global {
    const __APP_VERSION__: string;
}

interface Api {
    hasMasterPassword: () => Promise<boolean>;
    shouldPromptMasterPassword: () => Promise<boolean>;
    setMasterPassword: (password: string) => Promise<boolean>;
    verifyMasterPassword: (password: string) => Promise<boolean>;

    saveAccount: (account: Omit<Account, 'id'>) => Promise<boolean>;
    updateAccount: (id: string, account: Omit<Account, 'id'>) => Promise<boolean>;
    getAccounts: () => Promise<Account[]>;
    deleteAccount: (id: string) => Promise<boolean>;
    launchAccount: (id: string) => Promise<boolean>;
    getActiveAccountProcesses: () => Promise<Array<{ accountId: string; pid: number; mumbleName: string }>>;
    stopAccountProcess: (id: string) => Promise<boolean>;
    isGw2Running: () => Promise<boolean>;
    stopGw2Process: () => Promise<boolean>;
    capturePlayClickCalibration: (accountId: string) => Promise<{ xPercent: number; yPercent: number } | null>;
    resetPlayClickCalibration: (accountId: string) => Promise<boolean>;
    getLaunchStates: () => Promise<Array<{
        accountId: string;
        phase: 'idle' | 'launch_requested' | 'launcher_started' | 'credentials_waiting' | 'credentials_submitted' | 'process_detected' | 'running' | 'stopping' | 'stopped' | 'errored';
        certainty: 'verified' | 'inferred';
        updatedAt: number;
        note?: string;
    }>>;
    resolveAccountProfile: (apiKey: string) => Promise<{ name: string; created: string }>;
    setAccountApiProfile: (id: string, profile: { name?: string; created?: string }) => Promise<boolean>;

    saveSettings: (settings: AppSettings) => Promise<void>;
    getSettings: () => Promise<AppSettings | null>;
    checkForUpdates: () => void;
    restartApp: () => void;
    getAppVersion: () => Promise<string>;
    getWhatsNew: () => Promise<{ version: string; releaseNotes: string }>;
    shouldShowWhatsNew: () => Promise<{ version: string; shouldShow: boolean }>;
    setLastSeenVersion: (version: string) => Promise<boolean>;
    onUpdateMessage: (callback: (value: string) => void) => () => void;
    onUpdateAvailable: (callback: (value: unknown) => void) => () => void;
    onUpdateNotAvailable: (callback: (value: unknown) => void) => () => void;
    onUpdateError: (callback: (value: { message?: string } | string) => void) => () => void;
    onDownloadProgress: (callback: (value: unknown) => void) => () => void;
    onUpdateDownloaded: (callback: (value: unknown) => void) => () => void;

    minimizeWindow: () => void;
    maximizeWindow: () => void;
    closeWindow: () => void;
    resetApp: () => void;
}

declare global {
    interface Window {
        api: Api;
    }
}

export {};
