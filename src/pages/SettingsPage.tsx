import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, User, Edit2, X, Check } from 'lucide-react';
import BottomNavigation from '../components/BottomNavigation';
import HeaderLogo from '../components/HeaderLogo';
import { supabase } from '../lib/supabase';

const SettingsPage: React.FC = () => {
  const { user, signOut } = useAuth();
  const VOICE_ASSIST_KEY = 'voice_assistance_enabled';

  const [userName, setUserName] = useState('');
  const [profileLoading, setProfileLoading] = useState(true);
  
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voiceAssistanceEnabled, setVoiceAssistanceEnabled] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(VOICE_ASSIST_KEY);
    if (saved !== null) {
      setVoiceAssistanceEnabled(saved === 'true');
    }
  }, []);

  const handleToggleVoiceAssistance = () => {
    const next = !voiceAssistanceEnabled;
    setVoiceAssistanceEnabled(next);
    localStorage.setItem(VOICE_ASSIST_KEY, String(next));
  };

  useEffect(() => {
    if (!user) return;
    const fetchProfile = async () => {
      setProfileLoading(true);
      const { data, error } = await supabase
        .from('profili')
        .select('username')
        .eq('id_utente', user.id)
        .maybeSingle();

      if (!error && data?.username) {
        setUserName(data.username);
      } else {
        setUserName(user.email?.split('@')[0] || 'User');
      }
      setProfileLoading(false);
    };
    fetchProfile();
  }, [user]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || newName === userName) {
      setIsEditing(false);
      return;
    }
    
    // basic validation
    if (newName.length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const { error: upsertError } = await supabase
        .from('profili')
        .upsert({
          id_utente: user!.id,
          username: newName.trim(),
          mail: user?.email || `${user!.id}@local.invalid`,
          updated_at: new Date().toISOString()
        });
        
      if (upsertError) {
        if (upsertError.code === '23505') {
          throw new Error('This username is already taken. Please choose another one.');
        }
        throw upsertError;
      }
      
      setUserName(newName.trim());
      setSuccess(true);
      setIsEditing(false);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Error saving username.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col pb-24 relative">
      <HeaderLogo />

      <main className="flex-1 w-full flex flex-col items-center px-6 mt-6">
        {/* User Info Section */}
        <div className="bg-brand-darkGrey/40 w-full max-w-sm rounded-3xl p-6 flex flex-col items-center border border-brand-grey/20 relative">
          <div className="bg-brand-orange/20 p-4 rounded-full mb-4">
            <User className="text-brand-orange" size={40} />
          </div>
          
          {!isEditing ? (
            <>
              <div className="flex items-center gap-2">
                {profileLoading ? (
                  <div className="h-8 w-44 rounded-md bg-brand-grey/20 animate-pulse" />
                ) : (
                  <>
                    <h2 className="text-2xl font-bold text-white capitalize">{userName}</h2>
                    <button onClick={() => { setIsEditing(true); setNewName(userName); setError(null); }} className="text-brand-grey hover:text-white transition-colors">
                      <Edit2 size={16} />
                    </button>
                  </>
                )}
              </div>
              {profileLoading ? (
                <div className="h-4 w-52 rounded-md bg-brand-grey/20 animate-pulse mt-1" />
              ) : (
                <p className="text-sm text-brand-grey mt-1">{user?.email}</p>
              )}
            </>
          ) : (
            <form onSubmit={handleSaveName} className="w-full flex flex-col items-center">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New username"
                className="w-full bg-black/50 border-2 border-brand-orange/50 rounded-xl px-4 py-2 text-white text-center focus:border-brand-orange focus:outline-none mb-3"
                autoFocus
                maxLength={20}
              />
              {error && <p className="text-xs text-red-500 font-bold mb-3 text-center">{error}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => setIsEditing(false)} disabled={saving} className="p-2 rounded-xl bg-red-500/20 text-red-500 hover:bg-red-500/40 transition-colors">
                  <X size={20} />
                </button>
                <button type="submit" disabled={saving} className="p-2 rounded-xl bg-green-500/20 text-green-500 hover:bg-green-500/40 transition-colors disabled:opacity-50">
                  <Check size={20} />
                </button>
              </div>
            </form>
          )}

          {success && <p className="text-xs text-green-400 mt-3 absolute -bottom-6 font-bold">Username updated!</p>}
        </div>

        {/* Spazio per future impostazioni */}
        <div className="w-full max-w-sm mt-8 space-y-4">
          <div className="bg-brand-darkGrey/20 border border-brand-grey/10 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-bold text-sm">Voice Assistance</p>
                <p className="text-brand-grey/60 text-xs mt-1">Countdown and workout voice cues</p>
              </div>
              <button
                onClick={handleToggleVoiceAssistance}
                className={`relative w-12 h-7 rounded-full overflow-hidden transition-colors ${voiceAssistanceEnabled ? 'bg-brand-orange' : 'bg-brand-grey/30'}`}
                aria-label="Toggle voice assistance"
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${voiceAssistanceEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Logout Button pushed to the end */}
        <div className="mt-auto w-full max-w-sm pt-12">
          <button 
            onClick={signOut}
            className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 font-bold text-lg py-4 rounded-xl flex items-center justify-center transition-colors shadow-lg shadow-red-500/5"
          >
            <LogOut size={24} className="mr-2" />
            SIGN OUT
          </button>
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
};

export default SettingsPage;
