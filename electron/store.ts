import Store from 'electron-store';
import { Account, AppSettings } from './types.js';

interface StoreSchema {
    accounts: Account[];
    settings: AppSettings;
    security_v2: {
        salt: string;
        validationHash: string;
    };
}

const store = new Store<StoreSchema>({
    defaults: {
        accounts: [],
        settings: {
            gw2Path: '',
        },
        security_v2: {
            salt: '',
            validationHash: '',
        },
    },
});

export default store;
