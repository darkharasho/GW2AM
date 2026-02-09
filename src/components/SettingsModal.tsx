import React, { useState, useEffect } from 'react';
import { AppSettings } from '../types';
import { X, FolderOpen } from 'lucide-react';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [gw2Path, setGw2Path] = useState('');

    useEffect(() => {
        if (isOpen) {
            window.api.getSettings().then((settings) => {
                if (settings) {
                    setGw2Path(settings.gw2Path || '');
                }
            });
        }
    }, [isOpen]);

    const handleSave = async () => {
        await window.api.saveSettings({ gw2Path });
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-white">Settings</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Guild Wars 2 Path</label>
                        <div className="flex space-x-2">
                            <input
                                type="text"
                                value={gw2Path}
                                onChange={(e) => setGw2Path(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors text-sm"
                                placeholder="/path/to/Gw2-64.exe"
                            />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Full path to the executable (e.g. C:\Games\Guild Wars 2\Gw2-64.exe or /usr/bin/gw2)</p>
                    </div>

                    <div className="flex justify-end space-x-3 mt-6">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg text-gray-300 hover:bg-gray-700 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
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
