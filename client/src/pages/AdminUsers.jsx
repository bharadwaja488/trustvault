import { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Loader2,
  Mail,
  Lock,
  KeyRound
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { format } from 'date-fns';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [isCreating, setIsCreating] = useState(false);

  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { addToast } = useToast();

  const fetchUsers = async () => {
    try {
      const res = await apiClient.get('/api/admin/users');
      setUsers(res.data.users || []);
    } catch (err) {
      console.error('Failed to load users:', err);
      addToast('Failed to load user directory.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleToggleActive = async (targetUser) => {
    if (targetUser.id === currentUser?.id) {
      addToast('Cannot deactivate your own administrator account.', 'error');
      return;
    }

    const nextState = targetUser.is_active ? 0 : 1;
    try {
      await apiClient.put(`/api/admin/users/${targetUser.id}`, {
        is_active: nextState
      });
      addToast(`Account for ${targetUser.email} has been ${nextState ? 'activated' : 'deactivated'}.`, 'success');
      fetchUsers();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to update user status.', 'error');
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      await apiClient.post('/api/auth/register', {
        full_name: newFullName.trim(),
        email: newEmail.trim(),
        password: newPassword,
        role: newRole
      });
      addToast(`User ${newEmail} created successfully.`, 'success');
      setShowCreateModal(false);
      setNewFullName('');
      setNewEmail('');
      setNewPassword('');
      fetchUsers();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to register new account.', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
        <p className="text-sm text-slate-500">Loading directory...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-4 space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/admin')}
          className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Security Dashboard
        </button>

        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition shadow-sm"
        >
          <UserPlus className="w-4 h-4 mr-2" /> Add New User
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">User Directory & IAM Management</h1>
            <p className="text-xs text-slate-500 mt-0.5">Manage employee personas, active states, and platform roles.</p>
          </div>
          <span className="text-xs bg-slate-100 text-slate-600 font-medium px-2.5 py-1 rounded-full">
            {users.length} registered accounts
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-slate-200 bg-slate-50/50 text-slate-500 font-medium">
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Documents Owned</th>
                <th className="py-3 px-4">Active Grants</th>
                <th className="py-3 px-4">Created Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-semibold flex items-center justify-center text-xs">
                        {u.full_name?.charAt(0) || u.email?.charAt(0)}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">{u.full_name}</p>
                        <p className="text-slate-500 text-[11px]">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wider ${
                      u.role === 'admin'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-blue-50 text-blue-700'
                    }`}>
                      {u.role === 'admin' && <Shield className="w-3 h-3 mr-1" />}
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {u.is_active ? (
                      <span className="inline-flex items-center text-emerald-700 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-red-600 font-medium">
                        <XCircle className="w-3.5 h-3.5 mr-1" /> Disabled
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700">{u.documents_owned}</td>
                  <td className="py-3 px-4 font-mono text-slate-700">{u.active_grants}</td>
                  <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                    {format(new Date(u.created_at), 'yyyy-MM-dd')}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {u.id !== currentUser?.id ? (
                      <button
                        onClick={() => handleToggleActive(u)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-lg transition ${
                          u.is_active
                            ? 'text-red-600 hover:bg-red-50 border border-red-200'
                            : 'text-emerald-700 hover:bg-emerald-50 border border-emerald-300'
                        }`}
                      >
                        {u.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    ) : (
                      <span className="text-slate-400 italic text-[11px]">Current Session</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Provision New Identity</h3>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="e.g. Elena Rostova"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="elena@trustvault.com"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Platform Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="user">User (Standard Document Owner / Viewer)</option>
                  <option value="admin">Admin (System Auditor & User Manager)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition flex items-center"
                >
                  {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                  Provision Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
