export interface Account {
    id: string;
    nickname: string;
    email: string;
    passwordEncrypted: string;
    launchArguments: string;
}

export interface AppSettings {
    gw2Path: string;
}

export type IpcEvents = {
    'save-account': (account: Omit<Account, 'id'>) => Promise<boolean>;
    'get-accounts': () => Promise<Account[]>;
    'delete-account': (id: string) => Promise<boolean>;
    'launch-account': (id: string, passwordDecrypted: string) => Promise<void>;
    'save-settings': (settings: AppSettings) => Promise<void>;
    'get-settings': () => Promise<AppSettings | null>;
    'verify-master-password': (password: string) => Promise<boolean>;
    'set-master-password': (password: string) => Promise<boolean>;
    'has-master-password': () => Promise<boolean>;
}
