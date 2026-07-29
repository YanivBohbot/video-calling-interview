import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Video, Search, Calendar, Clock, Play,
  Trash2, AlertTriangle, X, Loader2, FileText, Save,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Interview {
  _id: string;
  candidateName: string;
  candidateEmail: string;
  role: string;
  scheduledAt: string;
  status: 'scheduled' | 'live' | 'completed' | 'cancelled';
  interviewType: string;
  duration: number;
  notes: string;
}

const TYPE_LABELS: Record<string, string> = {
  'technical':        'Technical',
  'coding-challenge': 'Coding',
  'system-design':    'System Design',
  'behavioral':       'Behavioral',
};

const TYPE_COLORS: Record<string, string> = {
  'technical':        'bg-blue-100 text-blue-700',
  'coding-challenge': 'bg-violet-100 text-violet-700',
  'system-design':    'bg-amber-100 text-amber-700',
  'behavioral':       'bg-teal-100 text-teal-700',
};

const STATUS_COLORS: Record<string, string> = {
  'scheduled': 'bg-sky-100 text-sky-700',
  'live':      'bg-green-100 text-green-700',
  'completed': 'bg-slate-100 text-slate-500',
  'cancelled': 'bg-red-100 text-red-500',
};

const FILTERS = ['all', 'scheduled', 'live', 'completed', 'cancelled'] as const;
type Filter = typeof FILTERS[number];

const DeleteModal: React.FC<{
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}> = ({ name, onConfirm, onCancel, loading }) => (
  <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2.5 bg-red-100 rounded-xl">
          <AlertTriangle size={22} className="text-red-600" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">Delete Interview</h2>
      </div>
      <p className="text-slate-600 text-sm mb-6">
        Are you sure you want to delete the interview with <strong>{name}</strong>? This cannot be undone.
      </p>
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-all"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-semibold text-sm hover:bg-red-700 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          {loading ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </motion.div>
  </div>
);

const ReportModal: React.FC<{
  interview: Interview;
  onClose: () => void;
  onSave: (id: string, notes: string) => Promise<void>;
  saving: boolean;
}> = ({ interview, onClose, onSave, saving }) => {
  const [notes, setNotes] = useState(interview.notes || '');
  const hasChanges = notes !== (interview.notes || '');

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand/10 rounded-xl">
              <FileText size={20} className="text-brand" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Interview Report</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {interview.candidateName} &mdash; {interview.role}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {interview.status === 'completed' && !interview.notes && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
              No report was written at the end of this session.
            </p>
          )}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Write your observations, strengths, areas for improvement, final decision..."
            rows={10}
            className="w-full border border-slate-200 rounded-xl p-3 text-sm text-slate-700 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/30 transition-all"
          />
          <p className="text-xs text-slate-400 mt-1 text-right">{notes.length} characters</p>
        </div>

        {/* Footer */}
        <div className="p-6 pt-0 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(interview._id, notes)}
            disabled={saving || !hasChanges}
            className="flex-1 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const Interviews: React.FC = () => {
  const [interviews, setInterviews]         = useState<Interview[]>([]);
  const [loading, setLoading]               = useState(true);
  const [searchTerm, setSearchTerm]         = useState('');
  const [activeFilter, setActiveFilter]     = useState<Filter>('all');
  const [deletingId, setDeletingId]         = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading]   = useState(false);
  const [reportInterview, setReportInterview] = useState<Interview | null>(null);
  const [reportSaving, setReportSaving]     = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3001/api/interviews');
      const data = await res.json();
      setInterviews(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (!deletingId) return;
    setDeleteLoading(true);
    try {
      await fetch(`http://localhost:3001/api/interviews/${deletingId}`, { method: 'DELETE' });
      setInterviews((prev) => prev.filter((iv) => iv._id !== deletingId));
    } finally {
      setDeleteLoading(false);
      setDeletingId(null);
    }
  };

  const handleSaveReport = async (id: string, notes: string) => {
    setReportSaving(true);
    try {
      await fetch(`http://localhost:3001/api/interviews/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      setInterviews((prev) =>
        prev.map((iv) => (iv._id === id ? { ...iv, notes } : iv))
      );
      setReportInterview(null);
    } catch (err) {
      console.error(err);
    } finally {
      setReportSaving(false);
    }
  };

  const deletingInterview = interviews.find((iv) => iv._id === deletingId);

  const filtered = interviews.filter((iv) => {
    const matchSearch =
      iv.candidateName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      iv.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
      iv.candidateEmail?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchFilter = activeFilter === 'all' || iv.status === activeFilter;
    return matchSearch && matchFilter;
  });

  const counts: Record<Filter, number> = {
    all:       interviews.length,
    scheduled: interviews.filter((i) => i.status === 'scheduled').length,
    live:      interviews.filter((i) => i.status === 'live').length,
    completed: interviews.filter((i) => i.status === 'completed').length,
    cancelled: interviews.filter((i) => i.status === 'cancelled').length,
  };

  return (
    <div className="space-y-8">
      {deletingInterview && (
        <DeleteModal
          name={deletingInterview.candidateName}
          onConfirm={handleDelete}
          onCancel={() => setDeletingId(null)}
          loading={deleteLoading}
        />
      )}

      {reportInterview && (
        <ReportModal
          interview={reportInterview}
          onClose={() => setReportInterview(null)}
          onSave={handleSaveReport}
          saving={reportSaving}
        />
      )}

      {/* Header & search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Interviews</h1>
          <p className="text-slate-500 mt-1">
            {interviews.length} interview{interviews.length !== 1 ? 's' : ''} in total
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search by name, role, or email…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand w-72 transition-all"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${
              activeFilter === f
                ? 'bg-brand text-white shadow-md shadow-brand/20'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
              activeFilter === f ? 'bg-white/20' : 'bg-slate-100'
            }`}>
              {counts[f]}
            </span>
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {loading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="h-64 bg-slate-200/50 animate-pulse rounded-3xl" />
          ))
        ) : filtered.length > 0 ? (
          <AnimatePresence>
            {filtered.map((interview, index) => {
              const initials = interview.candidateName
                .split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
              const isActive = interview.status === 'live' || interview.status === 'scheduled';
              const hasReport = !!interview.notes?.trim();

              return (
                <motion.div
                  key={interview._id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: index * 0.04 }}
                  className="group bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:border-brand/20 transition-all p-6 flex flex-col"
                >
                  {/* Top row */}
                  <div className="flex justify-between items-start mb-5">
                    <div className="w-14 h-14 rounded-2xl bg-brand/10 text-brand flex items-center justify-center font-bold text-xl">
                      {initials}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_COLORS[interview.status]}`}>
                        {interview.status}
                      </span>
                      {/* Compte rendu button — visible on completed interviews */}
                      {interview.status === 'completed' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setReportInterview(interview); }}
                          className={`p-1.5 rounded-lg transition-all ${
                            hasReport
                              ? 'text-brand bg-brand/10 hover:bg-brand/20'
                              : 'text-slate-300 hover:text-brand hover:bg-brand/10 opacity-0 group-hover:opacity-100'
                          }`}
                          title={hasReport ? 'View report' : 'Write report'}
                        >
                          <FileText size={15} />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeletingId(interview._id); }}
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        title="Delete interview"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-slate-900 group-hover:text-brand transition-colors truncate">
                      {interview.candidateName}
                    </h3>
                    <p className="text-slate-500 text-sm font-medium mt-0.5 truncate">{interview.role}</p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${TYPE_COLORS[interview.interviewType] ?? 'bg-slate-100 text-slate-500'}`}>
                        {TYPE_LABELS[interview.interviewType] ?? interview.interviewType}
                      </span>
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 flex items-center gap-1">
                        <Clock size={11} />{interview.duration ?? 60}m
                      </span>
                      {hasReport && (
                        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-brand/10 text-brand flex items-center gap-1">
                          <FileText size={11} /> Report
                        </span>
                      )}
                    </div>

                    <div className="mt-4 space-y-2">
                      <div className="flex items-center gap-2 text-slate-500 text-sm">
                        <Calendar size={14} className="text-slate-400 shrink-0" />
                        {new Date(interview.scheduledAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </div>
                      <div className="flex items-center gap-2 text-slate-500 text-sm">
                        <Clock size={14} className="text-slate-400 shrink-0" />
                        {new Date(interview.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>

                    {/* Notes preview */}
                    {hasReport && interview.status === 'completed' && (
                      <p
                        onClick={() => setReportInterview(interview)}
                        className="mt-3 text-xs text-slate-400 line-clamp-2 italic cursor-pointer hover:text-slate-600 transition-colors"
                      >
                        "{interview.notes}"
                      </p>
                    )}
                  </div>

                  {/* Action */}
                  <div className="mt-6 pt-5 border-t border-slate-50">
                    {interview.status === 'completed' ? (
                      <button
                        onClick={() => setReportInterview(interview)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all bg-slate-50 hover:bg-brand/10 text-slate-500 hover:text-brand border border-slate-100 hover:border-brand/20"
                      >
                        <FileText size={15} />
                        {hasReport ? 'View report' : 'Write report'}
                      </button>
                    ) : (
                      <button
                        onClick={() => navigate(`/interview/${interview._id}`)}
                        disabled={!isActive}
                        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${
                          isActive
                            ? 'bg-slate-900 group-hover:bg-brand text-white shadow-lg shadow-slate-900/10 group-hover:shadow-brand/20'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        <Play size={15} fill={isActive ? 'currentColor' : 'none'} />
                        {interview.status === 'live' ? 'Join Now' : interview.status === 'scheduled' ? 'Enter Room' : 'View Room'}
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        ) : (
          <div className="col-span-full py-20 text-center">
            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
              <Video size={32} />
            </div>
            <h3 className="text-xl font-bold text-slate-900">No interviews found</h3>
            <p className="text-slate-500 mt-2">
              {searchTerm ? 'Try a different search term.' : 'Schedule a new interview to get started.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Interviews;
