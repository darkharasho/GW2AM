import React, { useState, useEffect } from 'react';
import { X, Github } from 'lucide-react';
import { GW2_THEMES } from '../themes/themes';
import { applyTheme } from '../themes/applyTheme';
import { showToast } from './Toast.tsx';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [gw2Path, setGw2Path] = useState('');
    const [masterPasswordPrompt, setMasterPasswordPrompt] = useState<'every_time' | 'daily' | 'weekly' | 'monthly' | 'never'>('every_time');
    const [themeId, setThemeId] = useState('blood_legion');
    const [bypassLinuxPortalPrompt, setBypassLinuxPortalPrompt] = useState(false);
    const [portalConfigStatus, setPortalConfigStatus] = useState<{ configured: boolean; message: string } | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        window.api.getSettings().then((settings) => {
            if (settings) {
                setGw2Path(settings.gw2Path || '');
                setMasterPasswordPrompt(settings.masterPasswordPrompt ?? 'every_time');
                setThemeId(settings.themeId || 'blood_legion');
                setBypassLinuxPortalPrompt(settings.bypassLinuxPortalPrompt ?? false);
            }
        });
        // Check portal configuration status
        window.api.checkPortalPermissions().then((status) => {
            setPortalConfigStatus(status);
        });
    }, [isOpen]);

    const handleSave = async () => {
        try {
            await window.api.saveSettings({ gw2Path, masterPasswordPrompt, themeId, bypassLinuxPortalPrompt });
            applyTheme(themeId);
            onClose();
        } catch {
            showToast('Failed to save settings.');
        }
    };

    const handleConfigurePortal = async () => {
        try {
            const result = await window.api.configurePortalPermissions();
            if (result.success) {
                showToast(result.message);
                setPortalConfigStatus({ configured: true, message: result.message });
            } else {
                showToast(`Failed: ${result.message}`);
            }
        } catch {
            showToast('Failed to configure portal permissions.');
        }
    };

    if (!isOpen) return null;

    const DiscordIcon = () => (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.249.077.077 0 0 0-.079-.037 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.077.077 0 0 0-.042-.106 13.11 13.11 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.1.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.062.062 0 0 0-.031-.03ZM8.02 15.331c-1.182 0-2.156-1.085-2.156-2.419 0-1.333.955-2.418 2.156-2.418 1.21 0 2.174 1.095 2.156 2.418 0 1.334-.955 2.419-2.156 2.419Zm7.975 0c-1.182 0-2.156-1.085-2.156-2.419 0-1.333.955-2.418 2.156-2.418 1.21 0 2.174 1.095 2.156 2.418 0 1.334-.946 2.419-2.156 2.419Z" />
        </svg>
    );

    return (
        <div className="fixed left-0 right-0 bottom-0 top-9 z-50 border-t border-[var(--theme-border)]">
            <button className="absolute inset-0 bg-[var(--theme-overlay)] backdrop-blur-[1px]" onClick={onClose} aria-label="Close Settings Pane" />
            <div className="absolute right-0 top-0 h-full w-full max-w-md bg-[var(--theme-surface)] border-l border-[var(--theme-border)] shadow-2xl p-6 overflow-y-auto">
                <div className="flex justify-between items-center mb-6 sticky top-0 bg-[var(--theme-surface)] py-1">
                    <h2 className="text-xl font-bold text-white">Settings</h2>
                    <button onClick={onClose} className="text-[var(--theme-text-muted)] hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">Guild Wars 2 Path</label>
                        <div className="flex space-x-2">
                            <input
                                type="text"
                                value={gw2Path}
                                onChange={(e) => setGw2Path(e.target.value)}
                                className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors text-sm select-text"
                                placeholder="/path/to/Gw2-64.exe"
                            />
                        </div>
                        <p className="text-xs text-[var(--theme-text-dim)] mt-1">Full path to the executable (e.g. C:\Games\Guild Wars 2\Gw2-64.exe or /usr/bin/gw2)</p>
                        <p className="text-xs text-[var(--theme-text-dim)] mt-1">If this is a Steam install, keep it pointed at your GW2 executable; launch still goes through Steam.</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">Master Password Prompt</label>
                        <select
                            value={masterPasswordPrompt}
                            onChange={(e) => setMasterPasswordPrompt(e.target.value as 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never')}
                            className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors text-sm select-text"
                        >
                            <option value="every_time">Every time</option>
                            <option value="daily">Once a day</option>
                            <option value="weekly">Once a week</option>
                            <option value="monthly">Once a month</option>
                            <option value="never">Never</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">Theme</label>
                        <select
                            value={themeId}
                            onChange={(e) => {
                                setThemeId(e.target.value);
                                applyTheme(e.target.value);
                            }}
                            className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--theme-gold)] transition-colors text-sm select-text"
                        >
                            {GW2_THEMES.map((theme) => (
                                <option key={theme.id} value={theme.id}>
                                    {theme.name}
                                </option>
                            ))}
                        </select>
                        <p className="text-xs text-[var(--theme-text-dim)] mt-1">
                            {GW2_THEMES.find((theme) => theme.id === themeId)?.description}
                        </p>
                    </div>

                    {portalConfigStatus && portalConfigStatus.message !== 'Only available on Linux' && (
                        <div>
                            <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-2">Linux Automation (xdotool)</label>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-[var(--theme-text)]">Bypass remote control prompt</span>
                                    <input
                                        type="checkbox"
                                        checked={bypassLinuxPortalPrompt}
                                        onChange={(e) => setBypassLinuxPortalPrompt(e.target.checked)}
                                        className="w-4 h-4 rounded"
                                    />
                                </div>
                                {portalConfigStatus && (
                                    <p className="text-xs text-[var(--theme-text-dim)]">
                                        Status: {portalConfigStatus.configured ? '✓ Configured' : '✗ Not configured'}
                                    </p>
                                )}
                                <button
                                    onClick={handleConfigurePortal}
                                    className="w-full px-3 py-2 rounded-lg bg-[var(--theme-control-bg)] hover:bg-[var(--theme-control-hover)] text-[var(--theme-text)] transition-colors text-sm"
                                >
                                    Configure Portal Permissions
                                </button>
                                <p className="text-xs text-[var(--theme-text-dim)]">
                                    This configures xdg-desktop-portal to automatically allow GW2AM to control input without prompting.
                                </p>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-2">Community</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => { void window.api.openExternal('https://discord.gg/UjzMXMGXEg'); }}
                                className="px-3 py-2 rounded-lg bg-[var(--theme-control-bg)] hover:bg-[var(--theme-control-hover)] text-[var(--theme-text)] transition-colors text-sm inline-flex items-center justify-center gap-2"
                                title="Open Discord"
                            >
                                <DiscordIcon />
                                Discord
                            </button>
                            <button
                                onClick={() => { void window.api.openExternal('https://github.com/darkharasho/GW2AM'); }}
                                className="px-3 py-2 rounded-lg bg-[var(--theme-control-bg)] hover:bg-[var(--theme-control-hover)] text-[var(--theme-text)] transition-colors text-sm inline-flex items-center justify-center gap-2"
                                title="Open GitHub"
                            >
                                <Github size={15} />
                                GitHub
                            </button>
                        </div>
                    </div>

                    <div className="flex justify-end space-x-3 mt-6">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg text-[var(--theme-text)] hover:bg-[var(--theme-control-bg)] transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-strong)] text-white rounded-lg transition-colors font-medium"
                        >
                            Save Settings
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
