import { format } from 'date-fns';
import { CheckCircle, XCircle, Activity, ChevronLeft, ChevronRight } from 'lucide-react';

export default function AuditLog({ logs = [], total = 0, page = 1, totalPages = 1, onPageChange }) {
  if (!logs.length) {
    return (
      <div className="text-center py-8 text-slate-500">
        <Activity className="w-10 h-10 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No audit log entries found.</p>
      </div>
    );
  }

  const actionLabels = {
    DOCUMENT_UPLOAD: 'Document Upload',
    DOCUMENT_VIEW: 'Document View',
    DOCUMENT_DOWNLOAD: 'Document Download',
    DOCUMENT_UPDATE: 'Document Update',
    DOCUMENT_DELETE: 'Document Delete',
    PERMISSION_GRANT: 'Permission Grant',
    PERMISSION_REVOKE: 'Permission Revoke',
    ACCESS_DENIED: 'Access Denied',
    USER_LOGIN: 'User Login',
    USER_REGISTER: 'User Register',
    USER_UPDATE: 'User Update',
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-slate-200">
              <th className="pb-2 pr-4 text-slate-500 font-medium">Timestamp</th>
              <th className="pb-2 pr-4 text-slate-500 font-medium">Actor</th>
              <th className="pb-2 pr-4 text-slate-500 font-medium">Action</th>
              <th className="pb-2 pr-4 text-slate-500 font-medium">Status</th>
              <th className="pb-2 text-slate-500 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((log) => (
              <tr key={log.id || log._id} className="hover:bg-slate-50">
                <td className="py-2.5 pr-4 text-slate-600 whitespace-nowrap">
                  {format(new Date(log.timestamp || log.createdAt), 'MMM d, yyyy HH:mm:ss')}
                </td>
                <td className="py-2.5 pr-4">
                  <div>
                    <p className="text-slate-900 font-medium">{log.actorName || log.actor?.name || 'System'}</p>
                    <p className="text-xs text-slate-500">{log.actorEmail || log.actor?.email || ''}</p>
                  </div>
                </td>
                <td className="py-2.5 pr-4">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                    {actionLabels[log.action] || log.action}
                  </span>
                </td>
                <td className="py-2.5 pr-4">
                  {log.status === 'SUCCESS' ? (
                    <span className="inline-flex items-center gap-1 text-green-700">
                      <CheckCircle className="w-4 h-4" />
                      <span className="text-xs font-medium">Success</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-600">
                      <XCircle className="w-4 h-4" />
                      <span className="text-xs font-medium">Denied</span>
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-slate-600 text-xs max-w-xs truncate">
                  {log.details || log.resourceType || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3 border-t border-slate-200">
          <p className="text-sm text-slate-500">
            Page {page} of {totalPages} ({total} entries)
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => onPageChange?.(page - 1)}
              disabled={page <= 1}
              className="p-2 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => onPageChange?.(page + 1)}
              disabled={page >= totalPages}
              className="p-2 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
