import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { GW2_THEMES } from '../themes/themes';
import { applyTheme } from '../themes/applyTheme';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [gw2Path, setGw2Path] = useState('');
    const [masterPasswordPrompt, setMasterPasswordPrompt] = useState<'every_time' | 'daily' | 'weekly' | 'monthly' | 'never'>('every_time');
    const [themeId, setThemeId] = useState('blood_legion');

    useEffect(() => {
        if (!isOpen) return;
        window.api.getSettings().then((settings) => {
            if (settings) {
                setGw2Path(settings.gw2Path || '');
                setMasterPasswordPrompt(settings.masterPasswordPrompt ?? 'every_time');
                setThemeId(settings.themeId || 'blood_legion');
            }
        });
    }, [isOpen]);

    const handleSave = async () => {
        await window.api.saveSettings({ gw2Path, masterPasswordPrompt, themeId });
        applyTheme(themeId);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50">
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
