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
