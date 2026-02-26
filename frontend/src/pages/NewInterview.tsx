import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Video, Calendar, User, Mail, Briefcase, PlusCircle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';

const NewInterview: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    candidateName: '',
    candidateEmail: '',
    role: '',
    date: '',
    time: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setError("You must be logged in to schedule an interview.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const scheduledAt = new Date(`${formData.date}T${formData.time}`);
    
    try {
      const response = await fetch('http://localhost:3000/api/interviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          scheduledAt,
          interviewerId: user.id
        })
      });

      if (response.ok) {
        navigate('/');
      } else {
        const data = await response.json();
        setError(data.message || "Failed to schedule interview.");
      }
    } catch (error) {
      console.error('Error creating interview:', error);
      setError("Network error. Please make sure the backend is running.");
    } finally {
      setIsSubmitting(false);
    }
  };

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
                onChange={(e) => setFormData({...formData, candidateName: e.target.value})}
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
                onChange={(e) => setFormData({...formData, candidateEmail: e.target.value})}
                placeholder="sarah@example.com"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50"
              />
            </div>
          </div>

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
              onChange={(e) => setFormData({...formData, role: e.target.value})}
              placeholder="e.g. Senior Frontend Developer"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50"
            />
          </div>

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
                onChange={(e) => setFormData({...formData, date: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Video size={16} className="text-brand" />
                Time
              </label>
              <input 
                required
                type="time"
                disabled={isSubmitting}
                value={formData.time}
                onChange={(e) => setFormData({...formData, time: e.target.value})}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50"
              />
            </div>
          </div>

          <div className="pt-4">
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
