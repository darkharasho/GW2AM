/// <reference types="vite/client" />
import { Account, AppSettings } from './types';

interface Api {
    hasMasterPassword: () => Promise<boolean>;
    setMasterPassword: (password: string) => Promise<boolean>;
    verifyMasterPassword: (password: string) => Promise<boolean>;

    saveAccount: (account: Omit<Account, 'id'>) => Promise<boolean>;
    getAccounts: () => Promise<Account[]>;
    deleteAccount: (id: string) => Promise<boolean>;
    launchAccount: (id: string) => Promise<void>;

    saveSettings: (settings: AppSettings) => Promise<void>;
    getSettings: () => Promise<AppSettings | null>;

    minimizeWindow: () => void;
    maximizeWindow: () => void;
    closeWindow: () => void;
}

declare global {
    interface Window {
        api: Api;
    }
}
