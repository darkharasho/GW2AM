import React, { useEffect, useState } from 'react';
import { Account } from './types.js';
import AccountCard from './components/AccountCard.tsx';
import AddAccountModal from './components/AddAccountModal.tsx';
import MasterPasswordModal from './components/MasterPasswordModal.tsx';
import SettingsModal from './components/SettingsModal.tsx';
import { Plus, Settings, Minus, Square, X } from 'lucide-react';

function App() {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [isUnlocked, setIsUnlocked] = useState(false);
    const [masterPasswordMode, setMasterPasswordMode] = useState<'set' | 'verify'>('verify');
    const [isMasterPasswordModalOpen, setIsMasterPasswordModalOpen] = useState(false);
    const [masterPasswordError, setMasterPasswordError] = useState('');

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<Account | undefined>(undefined);

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    useEffect(() => {
        if (!window.api) {
            alert("FATAL: window.api is missing! IPC broken.");
            return;
        }
        checkMasterPassword();
    }, []);

    const checkMasterPassword = async () => {
        const hasPassword = await window.api.hasMasterPassword();
        if (hasPassword) {
            setMasterPasswordMode('verify');
            setIsMasterPasswordModalOpen(true);
        } else {
            setMasterPasswordMode('set');
            setIsMasterPasswordModalOpen(true);
        }
    };

    const handleMasterPasswordSubmit = async (password: string) => {
        setMasterPasswordError('');
        if (masterPasswordMode === 'set') {
            await window.api.setMasterPassword(password);
            setIsUnlocked(true);
            setIsMasterPasswordModalOpen(false);
            loadAccounts();
        } else {
            const isValid = await window.api.verifyMasterPassword(password);
            if (isValid) {
                setIsUnlocked(true);
                setIsMasterPasswordModalOpen(false);
                loadAccounts();
            } else {
                setMasterPasswordError('Invalid password');
            }
        }
    };

    const loadAccounts = async () => {
        const loadedAccounts = await window.api.getAccounts();
        setAccounts(loadedAccounts);
    };

    const handleSaveAccount = async (accountData: Omit<Account, 'id'>) => {
        if (editingAccount) {
            // Delete old, create new (simplest way since ID changes with my bad backend logic above, or fix backend to support update)
            // My backend generate new ID on save.
            // Actually, backend has `save-account` which appends.
            // I need `update-account` in backend or modify `save-account` to handle ID.
            // I'll delete the old one first if editing.
            await window.api.deleteAccount(editingAccount.id);
        }
        await window.api.saveAccount(accountData);
        loadAccounts();
        setEditingAccount(undefined);
    };

    const handleDeleteAccount = async (id: string) => {
        if (confirm('Are you sure you want to delete this account?')) {
            await window.api.deleteAccount(id);
            loadAccounts();
        }
    };

    const handleEditAccount = (account: Account) => {
        setEditingAccount(account);
        setIsAddModalOpen(true);
    };

    const handleLaunch = async (id: string) => {
        await window.api.launchAccount(id);
    };

    // Window controls
    const minimize = () => {
        console.log('Minimize clicked');
        if (window.api) window.api.minimizeWindow();
        else console.error('window.api is missing');
    };
    const maximize = () => {
        console.log('Maximize clicked');
        if (window.api) window.api.maximizeWindow();
        else console.error('window.api is missing');
    };
    const close = () => {
        console.log('Close clicked');
        if (window.api) window.api.closeWindow();
        else console.error('window.api is missing');
    };

    if (!isUnlocked) {
        return (
            <div className="h-screen w-screen bg-gray-900 text-white flex flex-col">
                {/* Custom Title Bar */}
                <div className="h-8 bg-gray-800 flex justify-between items-center px-2 select-none draggable">
                    <span className="text-xs font-bold ml-2">GW2 Account Manager</span>
                    <div className="flex space-x-2 no-drag relative z-50">
                        <button onClick={close} className="p-1 hover:bg-red-500 rounded transition-colors"><X size={12} /></button>
                    </div>
                </div>
                <MasterPasswordModal
                    mode={masterPasswordMode}
                    onSubmit={handleMasterPasswordSubmit}
                    error={masterPasswordError}
                />
            </div>
        );
    }

    return (
        <div className="h-screen w-screen bg-gray-900 text-white flex flex-col overflow-hidden border border-gray-800">
            {/* Custom Title Bar */}
            <div className="h-9 bg-gray-800 flex justify-between items-center px-3 select-none border-b border-gray-700 draggable">
                <span className="text-sm font-bold text-gray-200">GW2 Account Manager</span>
                <div className="flex space-x-1 no-drag relative z-50">
                    <button onClick={minimize} className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"><Minus size={14} /></button>
                    <button onClick={maximize} className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"><Square size={12} /></button>
                    <button onClick={close} className="p-1 hover:bg-red-600 rounded text-gray-400 hover:text-white transition-colors"><X size={14} /></button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {accounts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500">
                        <p>No accounts added yet.</p>
                        <button
                            onClick={() => { setEditingAccount(undefined); setIsAddModalOpen(true); }}
                            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center"
                        >
                            <Plus size={18} className="mr-2" /> Add Account
                        </button>
                    </div>
                ) : (
                    accounts.map(account => (
                        <AccountCard
                            key={account.id}
                            account={account}
                            onLaunch={handleLaunch}
                            onEdit={handleEditAccount}
                            onDelete={handleDeleteAccount}
                        />
                    ))
                )}
            </div>

            <div className="p-4 bg-gray-800 border-t border-gray-700 flex justify-between items-center">
                <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                    title="Settings"
                >
                    <Settings size={20} />
                </button>

                {accounts.length > 0 && (
                    <button
                        onClick={() => { setEditingAccount(undefined); setIsAddModalOpen(true); }}
                        className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg hover:shadow-blue-500/20 transition-all transform hover:scale-105"
                        title="Add Account"
                    >
                        <Plus size={24} />
                    </button>
                )}
            </div>

            <AddAccountModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSave={handleSaveAccount}
                initialData={editingAccount}
            />

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />
        </div>
    );
}

export default App;
