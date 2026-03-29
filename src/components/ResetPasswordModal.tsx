import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const ResetPasswordModal: React.FC = () => {
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setIsPasswordRecovery } = useAuth();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });
      
      if (error) throw error;
      
      alert('Password updated successfully!');
      setIsPasswordRecovery(false); // Close modal
    } catch (err: any) {
      setError(err.message || 'Error updating password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
      <div className="bg-brand-darkGrey p-8 rounded-3xl w-full max-w-sm border-2 border-brand-orange/30 shadow-2xl relative">
        <h2 className="text-2xl font-bold text-center text-white mb-4">Set New Password</h2>
        <p className="text-sm text-brand-grey text-center mb-6">
          Enter your new password below to regain access to your account.
        </p>
        
        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-100 p-3 rounded-lg mb-4 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleReset} className="flex flex-col space-y-4">
          <input
            type="password"
            placeholder="New Password (min. 6 chars)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="bg-black/50 border-2 border-brand-grey/20 rounded-xl px-4 py-3 text-white focus:border-brand-orange focus:outline-none transition-colors"
            required
          />
          
          <button
            type="submit"
            disabled={loading}
            className="bg-brand-orange hover:bg-brand-lightOrange text-black font-bold text-lg py-3 rounded-xl mt-4 transition-colors disabled:opacity-50"
          >
            {loading ? 'Updating...' : 'UPDATE PASSWORD'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPasswordModal;
