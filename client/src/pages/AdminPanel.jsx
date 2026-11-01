import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  FileCheck2,
  Users,
  Download,
  AlertOctagon,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  FileText,
  Loader2
} from 'lucide-react';
import apiClient from '../api/client';
import { useToast } from '../context/ToastContext';
import { format } from 'date-fns';

export default function AdminPanel() {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);
  const { addToast } = useToast();

  // Audit filter state
  const [actionFilter, setActionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);

  const fetchStats = async () => {
    try {
      const res = await apiClient.get('/api/admin/stats');
      setStats(res.data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const fetchLogs = async () => {
    try {
      const params = {
        page,
        limit: 25,
        action: actionFilter || undefined,
        status: statusFilter || undefined
      };
      const res = await apiClient.get('/api/admin/audit-logs', { params });
      setLogs(res.data.logs || []);
      setTotalPages(Math.ceil((res.data.total || 0) / 25) || 1);
      setTotalLogs(res.data.total || 0);
    } catch (err) {
      console.error('Failed to load logs:', err);
    }
  };

  const handleVerifyChain = async () => {
    setVerifying(true);
    try {
      const res = await apiClient.get('/api/admin/audit-verify');
      setVerificationResult(res.data);
      if (res.data.valid) {
        addToast(`Cryptographic chain verified across all ${res.data.totalRecords} records! Zero tampering detected.`, 'success');
      } else {
        addToast(`SECURITY ALERT: Hash chain broken at record index ${res.data.brokenAt}! Possible tampering!`, 'error');
      }
    } catch (err) {
      addToast('Failed to execute cryptographic verification.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchStats(), fetchLogs()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [actionFilter, statusFilter, page]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
        <p className="text-sm text-slate-500">Loading platform security dashboard...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-4 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-blue-600" />
            Security & Compliance Oversight
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time audit telemetry, intrusion detection, and cryptographic tamper-evidence verification.
          </p>
        </div>

        <button
          onClick={handleVerifyChain}
          disabled={verifying}
          className="inline-flex items-center px-4 py-2 bg-slate-900 hover:bg-black text-white text-sm font-medium rounded-xl transition shadow-sm disabled:opacity-50"
        >
          {verifying ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Verifying Hash Chain...
            </>
          ) : (
            <>
              <FileCheck2 className="w-4 h-4 mr-2 text-emerald-400" />
              Verify SHA-256 Hash Chain
            </>
          )}
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Users</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{stats?.totalUsers || 0}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Documents In Vault</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{stats?.totalDocuments || 0}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Downloads</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{stats?.totalDownloads || 0}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Download className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Blocked Intrusions (24h)</p>
            <p className={`text-2xl font-bold mt-1 ${stats?.denials24h > 0 ? 'text-red-600' : 'text-slate-900'}`}>
              {stats?.denials24h || 0}
            </p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
            <AlertOctagon className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Hash Chain Verification Status Banner */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Audit Integrity: Append-Only SHA-256 Hash Chain
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {stats?.totalAuditRecords || 0} cryptographic records. Database-level trigger blocks unauthorized UPDATE and DELETE.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center text-xs font-medium px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
          Status: Chain Valid & Immutable
        </span>
      </div>

      {/* Audit Log Table & Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">System Audit Trail ({totalLogs} events)</h2>
            <p className="text-xs text-slate-500 mt-0.5">Filter by action, outcome, or actor across the platform.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
            >
              <option value="">All Actions</option>
              <option value="ACCESS_DENIED">ACCESS_DENIED (Refused Attempts)</option>
              <option value="DOCUMENT_DOWNLOAD">DOCUMENT_DOWNLOAD</option>
              <option value="DOCUMENT_UPLOAD">DOCUMENT_UPLOAD</option>
              <option value="DOCUMENT_VIEW">DOCUMENT_VIEW</option>
              <option value="PERMISSION_GRANTED">PERMISSION_GRANTED</option>
              <option value="PERMISSION_REVOKED">PERMISSION_REVOKED</option>
              <option value="LOGIN">LOGIN</option>
              <option value="LOGIN_FAILED">LOGIN_FAILED</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
            >
              <option value="">All Outcomes</option>
              <option value="SUCCESS">SUCCESS only</option>
              <option value="DENIED">DENIED only</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-slate-200 bg-slate-50/50 text-slate-500 font-medium">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">IP Address</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Forensic Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    No matching audit records found.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                      {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900">
                      {log.actor_email || 'Anonymous / Unauth'}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500">
                      {log.actor_ip || '—'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`font-mono px-2 py-0.5 rounded text-[11px] ${
                        log.action === 'ACCESS_DENIED'
                          ? 'bg-red-100 text-red-800 font-bold'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {log.status === 'SUCCESS' ? (
                        <span className="inline-flex items-center text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Success
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-red-700 bg-red-50 px-2 py-0.5 rounded-full font-medium">
                          <XCircle className="w-3 h-3 mr-1" /> Refused (404)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600 max-w-sm truncate font-mono text-[11px]">
                      {log.details || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Page {page} of {totalPages}</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="px-3 py-1 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="px-3 py-1 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
