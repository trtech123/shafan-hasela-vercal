import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError('אימייל או סיסמה שגויים');
      setLoading(false);
      return;
    }

    // onAuthStateChange in AuthContext will update session;
    // navigate to root after successful sign-in.
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          {/* Header */}
          <div className="bg-sidebar p-6 flex justify-center">
            <img
              src="https://media.base44.com/images/public/69ca2dc3748aeb9c23109245/a0abe07c8_.jpg"
              alt="שפן הסלע"
              className="h-16 object-contain"
            />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="text-center mb-2">
              <h1 className="text-xl font-bold text-slate-800">כניסה למערכת</h1>
              <p className="text-sm text-slate-500 mt-1">אדוונצ׳ר — מערכת ניהול פעילויות</p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">אימייל</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="name@example.com"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all"
                dir="ltr"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">סיסמה</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all"
                dir="ltr"
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-800 hover:bg-slate-700 disabled:bg-slate-400 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? 'מתחבר...' : 'כניסה'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
