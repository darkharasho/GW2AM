import Store from 'electron-store';
const store = new Store({
    defaults: {
        accounts: [],
        settings: {
            gw2Path: '',
            masterPasswordPrompt: 'every_time',
            themeId: 'blood_legion',
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
