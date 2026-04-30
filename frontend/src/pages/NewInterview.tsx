import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Video, Calendar, User, Mail, Briefcase, PlusCircle, ArrowLeft, Clock, CheckCircle, Copy, Check, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';

const INTERVIEW_TYPES = [
  { value: 'technical',        label: 'Technical Screen' },
  { value: 'coding-challenge', label: 'Coding Challenge' },
  { value: 'system-design',    label: 'System Design' },
  { value: 'behavioral',       label: 'Behavioral' },
];

const DURATIONS = [
  { value: 30,  label: '30 minutes' },
  { value: 45,  label: '45 minutes' },
  { value: 60,  label: '1 hour' },
  { value: 90,  label: '1.5 hours' },
  { value: 120, label: '2 hours' },
];

interface CreatedInterview {
  _id: string;
  candidateName: string;
  role: string;
  scheduledAt: string;
  duration: number;
  interviewType: string;
}

const NewInterview: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInterview | null>(null);
  const [copied, setCopied] = useState(false);
  const [formData, setFormData] = useState({
    candidateName: '',
    candidateEmail: '',
    role: '',
    date: '',
    time: '',
    duration: 60,
    interviewType: 'technical',
    notes: '',
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const scheduledAt = new Date(`${formData.date}T${formData.time}`);

    try {
      const response = await fetch('http://localhost:3000/api/interviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateName: formData.candidateName,
          candidateEmail: formData.candidateEmail,
          role: formData.role,
          scheduledAt,
          duration: formData.duration,
          interviewType: formData.interviewType,
          notes: formData.notes,
          interviewerId: user?.id ?? 'demo',
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setCreated(data);
      } else {
        setError(data.message || 'Failed to schedule interview.');
      }
    } catch {
      setError('Network error. Please make sure the backend is running.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const roomLink = created
    ? `${window.location.origin}/interview/${created._id}`
    : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(roomLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const typeLabelMap: Record<string, string> = Object.fromEntries(
    INTERVIEW_TYPES.map((t) => [t.value, t.label])
  );

  if (created) {
    const scheduledDate = new Date(created.scheduledAt);
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-2xl mx-auto"
      >
        <div className="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden">
          <div className="bg-emerald-500 p-8 text-white text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', delay: 0.1 }}
              className="flex justify-center mb-4"
            >
              <div className="p-4 bg-white/20 rounded-full">
                <CheckCircle size={48} />
              </div>
            </motion.div>
            <h1 className="text-3xl font-bold mb-1">Interview Scheduled!</h1>
            <p className="text-white/80">
              {created.candidateName} · {typeLabelMap[created.interviewType]} · {created.duration} min
            </p>
          </div>

          <div className="p-8 space-y-6">
            <div className="bg-slate-50 rounded-2xl p-5 space-y-3">
              <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Interview Details</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-slate-400">Candidate</p>
                  <p className="font-semibold text-slate-800">{created.candidateName}</p>
                </div>
                <div>
                  <p className="text-slate-400">Role</p>
                  <p className="font-semibold text-slate-800">{created.role}</p>
                </div>
                <div>
                  <p className="text-slate-400">Date & Time</p>
                  <p className="font-semibold text-slate-800">
                    {scheduledDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
                    at {scheduledDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">Duration</p>
                  <p className="font-semibold text-slate-800">{created.duration} minutes</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-700">Share room link with candidate</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-slate-100 rounded-xl px-4 py-3 text-sm text-slate-600 font-mono truncate">
                  {roomLink}
                </div>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-hover transition-all shrink-0"
                >
                  <AnimatePresence mode="wait">
                    {copied ? (
                      <motion.span key="check" initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex items-center gap-1">
                        <Check size={16} /> Copied!
                      </motion.span>
                    ) : (
                      <motion.span key="copy" initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex items-center gap-1">
                        <Copy size={16} /> Copy
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => navigate('/')}
                className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 transition-all"
              >
                Back to Dashboard
              </button>
              <button
                onClick={() => {
                  setCreated(null);
                  setFormData({ candidateName: '', candidateEmail: '', role: '', date: '', time: '', duration: 60, interviewType: 'technical', notes: '' });
                }}
                className="flex-1 py-3 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover transition-all"
              >
                Schedule Another
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto"
    >
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-8 transition-colors"
      >
        <ArrowLeft size={20} />
        <span className="font-medium">Back to Dashboard</span>
      </button>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden">
        <div className="bg-brand p-8 text-white">
          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 bg-white/20 rounded-xl">
              <PlusCircle size={32} />
            </div>
            <h1 className="text-3xl font-bold">Schedule New Interview</h1>
          </div>
          <p className="text-white/80">Fill in the details to invite a candidate to a coding session.</p>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
              {error}
            </div>
          )}

          {/* Candidate info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <User size={16} className="text-brand" />
                Candidate Name
              </label>
              <input
                required
                type="text"
                disabled={isSubmitting}
                value={formData.candidateName}
                onChange={(e) => setFormData({ ...formData, candidateName: e.target.value })}
                placeholder="e.g. Sarah Johnson"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Mail size={16} className="text-brand" />
                Candidate Email
              </label>
              <input
                required
                type="email"
                disabled={isSubmitting}
                value={formData.candidateEmail}
                onChange={(e) => setFormData({ ...formData, candidateEmail: e.target.value })}
                placeholder="sarah@example.com"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50"
              />
            </div>
          </div>

          {/* Role */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Briefcase size={16} className="text-brand" />
              Role
            </label>
            <input
              required
              type="text"
              disabled={isSubmitting}
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              placeholder="e.g. Senior Frontend Developer"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50"
            />
          </div>

          {/* Interview type + duration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Video size={16} className="text-brand" />
                Interview Type
              </label>
              <select
                disabled={isSubmitting}
                value={formData.interviewType}
                onChange={(e) => setFormData({ ...formData, interviewType: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50 bg-white"
              >
                {INTERVIEW_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Clock size={16} className="text-brand" />
                Duration
              </label>
              <select
                disabled={isSubmitting}
                value={formData.duration}
                onChange={(e) => setFormData({ ...formData, duration: Number(e.target.value) })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50 bg-white"
              >
                {DURATIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Date + time */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Calendar size={16} className="text-brand" />
                Date
              </label>
              <input
                required
                type="date"
                disabled={isSubmitting}
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Clock size={16} className="text-brand" />
                Time
              </label>
              <input
                required
                type="time"
                disabled={isSubmitting}
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <FileText size={16} className="text-brand" />
              Notes <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              rows={3}
              disabled={isSubmitting}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Preparation notes, topics to cover, special instructions..."
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50 resize-none"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-brand hover:bg-brand-hover text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-brand/20 transition-all flex items-center justify-center gap-3 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Scheduling...
                </>
              ) : (
                <>
                  <Video size={20} />
                  Schedule Interview
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </motion.div>
  );
};

export default NewInterview;
