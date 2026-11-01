import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import SearchBar from '../components/SearchBar';
import {
  FileText,
  Upload,
  Loader2,
  FolderOpen,
  Calendar,
  User,
  Eye,
  Edit,
  Crown,
} from 'lucide-react';
import { format } from 'date-fns';

export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 12 };
      if (search) params.search = search;
      if (category) params.category = category;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const { data } = await apiClient.get('/api/documents', { params });
      setDocuments(data.documents || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch {
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, category, dateFrom, dateTo]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleSearch = useCallback((term) => {
    setSearch(term);
    setPage(1);
  }, []);

  const handleCategoryChange = useCallback((cat) => {
    setCategory(cat);
    setPage(1);
  }, []);

  const handleDateChange = useCallback((from, to) => {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  }, []);

  const getPermissionBadge = (doc) => {
    const userId = user?.id || user?._id;
    if (doc.ownerId === userId || doc.owner?.id === userId || doc.owner?._id === userId) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
          <Crown className="w-3 h-3" />
          Owner
        </span>
      );
    }
    if (doc.permission === 'edit') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          <Edit className="w-3 h-3" />
          Edit
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <Eye className="w-3 h-3" />
        View
      </span>
    );
  };

  const categoryColors = {
    HR: 'bg-purple-100 text-purple-700',
    Legal: 'bg-indigo-100 text-indigo-700',
    Finance: 'bg-emerald-100 text-emerald-700',
    Engineering: 'bg-orange-100 text-orange-700',
    Marketing: 'bg-pink-100 text-pink-700',
    Other: 'bg-slate-100 text-slate-700',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isAdmin ? 'All Documents' : 'My Documents'}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {total} document{total !== 1 ? 's' : ''} available
          </p>
        </div>
        {!isAdmin && (
          <button
            onClick={() => navigate('/upload')}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <Upload className="w-4 h-4" />
            Upload Document
          </button>
        )}
      </div>

      {/* Search & Filters */}
      <SearchBar
        onSearch={handleSearch}
        onCategoryChange={handleCategoryChange}
        onDateChange={handleDateChange}
      />

      {/* Document Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-20">
          <FolderOpen className="w-16 h-16 mx-auto text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-900">No documents found</h3>
          <p className="text-slate-500 text-sm mt-1">
            {search || category || dateFrom || dateTo
              ? 'Try adjusting your search or filters.'
              : "Upload your first document to get started."}
          </p>
          {!isAdmin && !search && !category && (
            <button
              onClick={() => navigate('/upload')}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Upload className="w-4 h-4" />
              Upload Document
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {documents.map((doc) => (
              <Link
                key={doc.id || doc._id}
                to={`/documents/${doc.id || doc._id}`}
                className="bg-white rounded-lg shadow-md hover:shadow-lg border border-slate-200 p-5 transition-all hover:-translate-y-0.5 group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                    <FileText className="w-5 h-5" />
                  </div>
                  {getPermissionBadge(doc)}
                </div>
                <h3 className="font-semibold text-slate-900 mb-1 truncate group-hover:text-blue-600 transition-colors">
                  {doc.title}
                </h3>
                <p className="text-xs text-slate-500 mb-3 line-clamp-2">
                  {doc.description || 'No description'}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className={`px-2 py-0.5 rounded-full font-medium ${categoryColors[doc.category] || categoryColors.Other}`}>
                    {doc.category}
                  </span>
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {doc.ownerName || doc.owner?.name || 'Unknown'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {format(new Date(doc.createdAt || doc.uploadDate), 'MMM d, yyyy')}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm disabled:opacity-40 hover:bg-slate-50"
              >
                Previous
              </button>
              <span className="px-3 py-2 text-sm text-slate-600">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm disabled:opacity-40 hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
