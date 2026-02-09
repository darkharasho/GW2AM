import React, { useState, useEffect } from 'react';
import { Account } from '../types';
import { X } from 'lucide-react';

interface AddAccountModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (account: Omit<Account, 'id'>) => void;
    initialData?: Account;
}

const AddAccountModal: React.FC<AddAccountModalProps> = ({ isOpen, onClose, onSave, initialData }) => {
    const [nickname, setNickname] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [launchArguments, setLaunchArguments] = useState('-nopatchui -email "EMAIL" -password "PASSWORD"');

    useEffect(() => {
        if (isOpen && initialData) {
            setNickname(initialData.nickname);
            setEmail(initialData.email);
            setPassword(''); // Don't show existing password for security? Or show placeholder
            setLaunchArguments(initialData.launchArguments);
        } else if (isOpen) {
            // Reset form
            setNickname('');
            setEmail('');
            setPassword('');
            setLaunchArguments('-nopatchui -email "EMAIL" -password "PASSWORD"');
        }
    }, [isOpen, initialData]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            nickname,
            email,
            passwordEncrypted: password, // Send raw, backend will encrypt. Variable name matches backend expectation.
            launchArguments
        });
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-white">{initialData ? 'Edit Account' : 'Add Account'}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Nickname</label>
                        <input
                            type="text"
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                            placeholder="Main Account"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                            placeholder="example@arena.net"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                            placeholder={initialData ? 'Unchanged' : 'Password'}
                            required={!initialData}
                        />
                        {initialData && <p className="text-xs text-gray-500 mt-1">Leave empty to keep existing password.</p>}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Launch Arguments</label>
                        <input
                            type="text"
                            value={launchArguments}
                            onChange={(e) => setLaunchArguments(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors font-mono text-xs"
                        />
                        <p className="text-xs text-gray-500 mt-1">Use "EMAIL" and "PASSWORD" as placeholders.</p>
                    </div>

                    <div className="flex justify-end space-x-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg text-gray-300 hover:bg-gray-700 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
                        >
                            Save Account
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddAccountModal;
