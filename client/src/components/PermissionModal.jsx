import { useState, useEffect } from 'react';
import { X, UserPlus, Loader2 } from 'lucide-react';
import apiClient from '../api/client';
import { useToast } from '../context/ToastContext';

export default function PermissionModal({ documentId, existingPermissions = [], onClose, onGranted }) {
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [permission, setPermission] = useState('read');
  const [loading, setLoading] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const { addToast } = useToast();

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const { data } = await apiClient.get('/api/auth/users');
        const usersList = data.users || data;
        const existingIds = new Set(existingPermissions.map((p) => p.userId || p.user?.id || p.user?._id));
        const available = usersList.filter(
          (u) => !existingIds.has(u.id || u._id) && u.role !== 'admin'
        );
        setUsers(available);
      } catch {
        // If non-admin, try to use the endpoint still — or show empty
        setUsers([]);
      } finally {
        setLoadingUsers(false);
      }
    };
    fetchUsers();
  }, [existingPermissions]);

  const handleGrant = async () => {
    if (!selectedUserId) {
      addToast('Please select a user', 'error');
      return;
    }
    setLoading(true);
    try {
      await apiClient.post(`/api/documents/${documentId}/permissions`, {
        userId: selectedUserId,
        permission,
      });
      addToast('Access granted successfully', 'success');
      onGranted?.();
      onClose();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to grant access', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-slate-900">Grant Access</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {existingPermissions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500 mb-2">Current Access</p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {existingPermissions.map((p) => (
                  <div
                    key={p.id || p._id}
                    className="flex items-center justify-between px-3 py-1.5 bg-slate-50 rounded text-sm"
                  >
                    <span className="text-slate-700">{p.userName || p.user?.name || p.user?.email || 'User'}</span>
                    <span className="text-xs font-medium text-slate-500 capitalize">{p.permission}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Select User</label>
            {loadingUsers ? (
              <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading users...
              </div>
            ) : users.length === 0 ? (
              <p className="text-sm text-slate-500 py-2">No available users to add.</p>
            ) : (
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
              >
                <option value="">Choose a user...</option>
                {users.map((u) => (
                  <option key={u.id || u._id} value={u.id || u._id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Permission Level</label>
            <select
              value={permission}
              onChange={(e) => setPermission(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
            >
              <option value="read">Read — View and download only</option>
              <option value="edit">Edit — View, download, and edit metadata</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGrant}
            disabled={loading || !selectedUserId}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Grant Access
          </button>
        </div>
      </div>
    </div>
  );
}
