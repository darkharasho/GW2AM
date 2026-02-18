import Store from 'electron-store';
import { Account, AppSettings } from './types.js';

interface StoreSchema {
    accounts: Account[];
    settings: AppSettings;
    windowState: {
        x?: number;
        y?: number;
        width: number;
        height: number;
        isMaximized: boolean;
    };
    security_v2: {
        salt: string;
        validationHash: string;
        lastUnlockAt: number;
        cachedMasterKey: string;
    };
}

const store = new Store<StoreSchema>({
    defaults: {
        accounts: [],
        settings: {
            gw2Path: '',
            masterPasswordPrompt: 'every_time',
            themeId: 'blood_legion',
            linuxInputAuthorizationPrewarmAttempted: false,
            gw2AutoUpdateBeforeLaunch: false,
            gw2AutoUpdateBackground: false,
            gw2AutoUpdateVisible: false,
        },
        windowState: {
            width: 400,
            height: 600,
            isMaximized: false,
        },
        security_v2: {
            salt: '',
            validationHash: '',
            lastUnlockAt: 0,
            cachedMasterKey: '',
        },
    },
});

export default store;
