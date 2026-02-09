# Guild Wars 2 Account Manager

A minimalist, secure account manager and launcher for Guild Wars 2.

## Feautres
- **Secure Vault**: AES-256-GCM encryption for passwords.
- **Multiple Accounts**: Manage unlimited accounts.
- **Direct Launch**: Launch the game with specific arguments (e.g., `-nopatchui`, `-email`, `-password`).
- **Minimalist UI**: Flat, dark theme designed to stay out of the way.

## Build & Run

### Install Dependencies
```bash
npm install
```

### Development Mode
```bash
npm run dev
```

### Build for Production
```bash
npm run electron:build
```
The executable will be generated in `dist` (e.g., AppImage or Setup.exe).

## Configuration
- **Master Password**: Set on first launch. If lost, delete the app data to reset (all saved accounts will be lost).
- **Game Path**: Set the path to `Gw2-64.exe` in Settings. On Linux, this can be a wrapper script for Wine.

## Troubleshooting
If launch fails, check the console output (in dev mode) or logs. Ensure the game path is correct.
