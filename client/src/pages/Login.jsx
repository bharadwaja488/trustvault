import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Shield, LogIn, Loader2, AlertCircle, Eye, EyeOff, Info } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const seedCredentials = [
    { email: 'admin@trustvault.com', role: 'Admin' },
    { email: 'alice@trustvault.com', role: 'User' },
    { email: 'bob@trustvault.com', role: 'User' },
    { email: 'charlie@trustvault.com', role: 'User' },
  ];

  const fillCredential = (seedEmail) => {
    setEmail(seedEmail);
    setPassword('Password123!');
    setError('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 shadow-lg shadow-blue-600/30 mb-4">
            <Shield className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">TrustVault</h1>
          <p className="text-blue-200 mt-1">Secure Document Sharing Platform</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-6">Sign in to your account</h2>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-sm outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 pr-10 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-sm outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm transition-colors"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Seed Credentials */}
        <div className="mt-6 bg-white/10 backdrop-blur-sm rounded-xl p-5 border border-white/20">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-blue-300" />
            <h3 className="text-sm font-semibold text-blue-200">Demo Credentials</h3>
          </div>
          <p className="text-xs text-blue-300/80 mb-3">
            Password for all accounts: <code className="bg-white/10 px-1.5 py-0.5 rounded text-blue-200">Password123!</code>
          </p>
          <div className="space-y-2">
            {seedCredentials.map((cred) => (
              <button
                key={cred.email}
                onClick={() => fillCredential(cred.email)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 hover:bg-white/15 transition-colors text-left group"
              >
                <div>
                  <p className="text-sm text-white">{cred.email}</p>
                  <p className="text-xs text-blue-300/70">{cred.role}</p>
                </div>
                <span className="text-xs text-blue-300 opacity-0 group-hover:opacity-100 transition-opacity">
                  Click to fill →
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
