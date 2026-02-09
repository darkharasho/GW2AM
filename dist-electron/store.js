import Store from 'electron-store';
const store = new Store({
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
