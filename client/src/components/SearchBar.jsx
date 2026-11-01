import { useState, useEffect, useRef } from 'react';
import { Search, Filter, Calendar } from 'lucide-react';

export default function SearchBar({
  onSearch,
  onCategoryChange,
  onDateChange,
  categories = ['HR', 'Legal', 'Finance', 'Engineering', 'Marketing', 'Other'],
  showDateFilter = true,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [category, setCategory] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearch?.(searchTerm);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchTerm, onSearch]);

  const handleCategoryChange = (val) => {
    setCategory(val);
    onCategoryChange?.(val);
  };

  const handleDateChange = (from, to) => {
    setDateFrom(from);
    setDateTo(to);
    onDateChange?.(from, to);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search documents by name, category, or owner..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-sm transition-all outline-none"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
            showFilters || category || dateFrom || dateTo
              ? 'bg-blue-50 border-blue-300 text-blue-700'
              : 'border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Filter className="w-4 h-4" />
          Filters
          {(category || dateFrom || dateTo) && (
            <span className="w-2 h-2 bg-blue-600 rounded-full" />
          )}
        </button>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-3 p-4 bg-white rounded-lg border border-slate-200">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Category</label>
            <select
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {showDateFilter && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">From</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => handleDateChange(e.target.value, dateTo)}
                    className="pl-10 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">To</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => handleDateChange(dateFrom, e.target.value)}
                    className="pl-10 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
                  />
                </div>
              </div>
            </>
          )}

          {(category || dateFrom || dateTo) && (
            <div className="flex items-end">
              <button
                onClick={() => {
                  handleCategoryChange('');
                  handleDateChange('', '');
                }}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium px-3 py-2"
              >
                Clear Filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
