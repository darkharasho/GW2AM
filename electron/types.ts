export interface Account {
    id: string;
    nickname: string;
    email: string;
    passwordEncrypted: string;
    launchArguments: string;
    playClickXPercent?: number;
    playClickYPercent?: number;
    apiKey?: string;
    apiAccountName?: string;
    apiCreatedAt?: string;
}

export interface LaunchState {
    accountId: string;
    phase: 'idle' | 'launch_requested' | 'launcher_started' | 'credentials_waiting' | 'credentials_submitted' | 'process_detected' | 'running' | 'stopping' | 'stopped' | 'errored';
    certainty: 'verified' | 'inferred';
    updatedAt: number;
    note?: string;
}

export interface AppSettings {
    gw2Path: string;
    masterPasswordPrompt: 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never';
    themeId: string;
    bypassLinuxPortalPrompt?: boolean;
    linuxInputAuthorizationPrewarmAttempted?: boolean;
}

export type IpcEvents = {
    'save-account': (account: Omit<Account, 'id'>) => Promise<boolean>;
    'update-account': (id: string, account: Omit<Account, 'id'>) => Promise<boolean>;
    'get-accounts': () => Promise<Account[]>;
    'delete-account': (id: string) => Promise<boolean>;
    'launch-account': (id: string) => Promise<boolean>;
    'get-active-account-processes': () => Promise<Array<{ accountId: string; pid: number; mumbleName: string }>>;
    'stop-account-process': (id: string) => Promise<boolean>;
    'is-gw2-running': () => Promise<boolean>;
    'stop-gw2-process': () => Promise<boolean>;
    'get-launch-states': () => Promise<LaunchState[]>;

    'resolve-account-profile': (apiKey: string) => Promise<{ name: string; created: string }>;
    'set-account-api-profile': (id: string, profile: { name?: string; created?: string }) => Promise<boolean>;
    'save-settings': (settings: AppSettings) => Promise<void>;
    'get-settings': () => Promise<AppSettings | null>;
    'get-runtime-flags': () => Promise<{ isDevShowcase: boolean }>;
    'verify-master-password': (password: string) => Promise<boolean>;
    'set-master-password': (password: string) => Promise<boolean>;
    'has-master-password': () => Promise<boolean>;
    'should-prompt-master-password': () => Promise<boolean>;
    'get-app-version': () => Promise<string>;
    'get-whats-new': () => Promise<{ version: string; releaseNotes: string }>;
    'should-show-whats-new': () => Promise<{ version: string; shouldShow: boolean }>;
    'set-last-seen-version': (version: string) => Promise<boolean>;
    'open-external': (url: string) => Promise<boolean>;
    'reset-app': () => void;
    'configure-portal-permissions': () => Promise<{ success: boolean; message: string }>;
    'check-portal-permissions': () => Promise<{ configured: boolean; message: string }>;
    'prewarm-linux-input-authorization': () => Promise<{ success: boolean; message: string }>;
}
