import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Download,
  Shield,
  Clock,
  User,
  Tag,
  FileText,
  Trash2,
  Edit3,
  UserPlus,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  Lock
} from 'lucide-react';
import apiClient from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import PermissionModal from '../components/PermissionModal';
import { format } from 'date-fns';

export default function DocumentView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addToast } = useToast();

  const [document, setDocument] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchDocument = async () => {
    try {
      const res = await apiClient.get(`/api/documents/${id}`);
      setDocument(res.data.document);
      setEditTitle(res.data.document.title);
      setEditDesc(res.data.document.description || '');
      setEditCategory(res.data.document.category || 'General');

      // Fetch permissions if owner or admin
      if (res.data.document.owner_id === user?.id || user?.role === 'admin') {
        fetchPermissions();
        fetchActivity();
      }
    } catch (err) {
      console.error('Failed to load document:', err);
      addToast(err.response?.data?.error || 'Document not found or access denied.', 'error');
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const fetchPermissions = async () => {
    try {
      const res = await apiClient.get(`/api/documents/${id}/permissions`);
      setPermissions(res.data.permissions || []);
    } catch (err) {
      console.warn('Could not load permissions:', err);
    }
  };

  const fetchActivity = async () => {
    try {
      const res = await apiClient.get(`/api/documents/${id}/activity`);
      setActivity(res.data.logs || []);
    } catch (err) {
      console.warn('Could not load document activity:', err);
    }
  };

  useEffect(() => {
    fetchDocument();
  }, [id]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await apiClient.get(`/api/documents/${id}/download`, {
        responseType: 'blob'
      });

      // Create download link
      const blob = new Blob([res.data], { type: res.headers['content-type'] });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = downloadUrl;
      link.download = document.original_filename || 'downloaded-file';
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      addToast('Download initiated and logged to audit trail.', 'success');
      // Refresh audit trail
      if (isOwner || user?.role === 'admin') {
        setTimeout(fetchActivity, 500);
      }
    } catch (err) {
      console.error('Download error:', err);
      addToast(err.response?.data?.error || 'Failed to download document.', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const handleRevoke = async (grantId, targetEmail) => {
    if (!window.confirm(`Revoke access from ${targetEmail}? This will immediately take effect.`)) {
      return;
    }

    try {
      await apiClient.delete(`/api/documents/${id}/permissions/${grantId}`);
      addToast(`Access revoked immediately for ${targetEmail}.`, 'success');
      fetchPermissions();
      fetchActivity();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to revoke access.', 'error');
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await apiClient.put(`/api/documents/${id}`, {
        title: editTitle,
        description: editDesc,
        category: editCategory
      });
      setDocument(res.data.document);
      setIsEditing(false);
      addToast('Document metadata updated.', 'success');
      fetchActivity();
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to update metadata.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this document? This will revoke all access immediately.')) {
      return;
    }

    try {
      await apiClient.delete(`/api/documents/${id}`);
      addToast('Document safely deleted and removed.', 'success');
      navigate('/');
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to delete document.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
        <p className="text-sm text-slate-500">Verifying authorization and loading document...</p>
      </div>
    );
  }

  if (!document) return null;

  const isOwner = document.owner_id === user?.id;
  const canEdit = isOwner || document.user_permission === 'edit';

  return (
    <div className="max-w-5xl mx-auto py-4 space-y-6">
      {/* Back button */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Documents
        </button>

        {isOwner && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
            >
              <Edit3 className="w-3.5 h-3.5 mr-1" />
              {isEditing ? 'Cancel Edit' : 'Edit Metadata'}
            </button>
            <button
              onClick={handleDelete}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Delete Document
            </button>
          </div>
        )}
      </div>

      {/* Main Header Card */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="space-y-3 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
                <Tag className="w-3 h-3 mr-1" />
                {document.category || 'General'}
              </span>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                isOwner
                  ? 'bg-amber-50 text-amber-700 border border-amber-200/60'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
              }`}>
                <Shield className="w-3 h-3 mr-1" />
                {isOwner ? 'Owner' : 'Authorized Access'}
              </span>
            </div>

            {isEditing ? (
              <form onSubmit={handleUpdate} className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Title</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
                  <textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition"
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-200 transition"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{document.title}</h1>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {document.description || 'No description provided.'}
                </p>
              </>
            )}

            <div className="flex flex-wrap items-center gap-y-2 gap-x-6 text-xs text-slate-500 pt-2">
              <span className="inline-flex items-center">
                <FileText className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                {document.original_filename} ({(document.file_size / 1024).toFixed(1)} KB)
              </span>
              <span className="inline-flex items-center">
                <User className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                Owner: <strong className="ml-1 text-slate-700">{document.owner_name}</strong>
              </span>
              <span className="inline-flex items-center">
                <Clock className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                Uploaded {format(new Date(document.created_at), 'MMM d, yyyy HH:mm')}
              </span>
            </div>
          </div>

          {/* Action Download Button */}
          <div className="shrink-0 flex flex-col gap-2">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center justify-center px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm transition shadow-sm hover:shadow disabled:opacity-50"
            >
              {downloading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Streaming Secure File...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Download Document
                </>
              )}
            </button>

            {isOwner && (
              <button
                onClick={() => setShowShareModal(true)}
                className="inline-flex items-center justify-center px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl text-sm transition border border-slate-200"
              >
                <UserPlus className="w-4 h-4 mr-2 text-slate-600" />
                Manage Access
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Permissions Grid (Visible to Owner & Admin) */}
      {isOwner && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Access Control List (ACL)</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Revoking access takes effect immediately on subsequent requests.
              </p>
            </div>
            <button
              onClick={() => setShowShareModal(true)}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
            >
              <UserPlus className="w-3.5 h-3.5 mr-1.5" />
              Grant New Access
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {permissions.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                <Lock className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                This document is strictly private. Only you can view or download it.
              </div>
            ) : (
              permissions.map((grant) => (
                <div key={grant.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-medium text-sm">
                      {grant.user_name?.charAt(0) || grant.user_email?.charAt(0) || 'U'}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{grant.user_name}</p>
                      <p className="text-xs text-slate-500">{grant.user_email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="text-xs px-2.5 py-1 rounded-md font-medium uppercase tracking-wider bg-slate-100 text-slate-700">
                      {grant.permission} Access
                    </span>
                    <button
                      onClick={() => handleRevoke(grant.id, grant.user_email)}
                      className="px-3 py-1 text-xs font-medium text-red-600 hover:text-white hover:bg-red-600 border border-red-200 rounded-lg transition"
                    >
                      Revoke Immediately
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Audit Trail for this Document */}
      {(isOwner || user?.role === 'admin') && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Document Audit Trail</h2>
              <p className="text-xs text-slate-500">Every view, download, permission change, and blocked intrusion attempt is recorded here.</p>
            </div>
            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium px-2 py-0.5 rounded-full flex items-center">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Cryptographically Chained
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-slate-200 text-slate-500 font-medium">
                  <th className="pb-2 pr-4">Timestamp (UTC)</th>
                  <th className="pb-2 pr-4">Actor</th>
                  <th className="pb-2 pr-4">Action</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Details / Forensics</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activity.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      No events logged yet.
                    </td>
                  </tr>
                ) : (
                  activity.map((event) => (
                    <tr key={event.id} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-4 text-slate-600 whitespace-nowrap">
                        {format(new Date(event.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                      </td>
                      <td className="py-2.5 pr-4 font-medium text-slate-800">
                        {event.actor_email || 'System'}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                          {event.action}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        {event.status === 'SUCCESS' ? (
                          <span className="inline-flex items-center text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Success
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-red-700 bg-red-50 px-2 py-0.5 rounded-full font-medium">
                            <XCircle className="w-3 h-3 mr-1" /> Refused (404)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-slate-500 max-w-xs truncate">
                        {event.details ? (typeof event.details === 'string' ? event.details : JSON.stringify(event.details)) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Permission Grant Modal */}
      {showShareModal && (
        <PermissionModal
          documentId={id}
          existingPermissions={permissions}
          onClose={() => setShowShareModal(false)}
          onGranted={() => {
            fetchPermissions();
            fetchActivity();
          }}
        />
      )}
    </div>
  );
}
