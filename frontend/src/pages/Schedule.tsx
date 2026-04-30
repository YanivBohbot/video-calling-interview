import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, User, Briefcase, Video, ChevronRight, Loader2, Inbox } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Interview {
  _id: string;
  candidateName: string;
  candidateEmail: string;
  role: string;
  scheduledAt: string;
  status: 'scheduled' | 'live' | 'completed' | 'cancelled';
  duration: number;
  interviewType: string;
  notes?: string;
}

const TYPE_LABELS: Record<string, string> = {
  'technical':        'Technical Screen',
  'coding-challenge': 'Coding Challenge',
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
  'scheduled':  'bg-sky-100 text-sky-700',
  'live':       'bg-green-100 text-green-700',
  'completed':  'bg-slate-100 text-slate-600',
  'cancelled':  'bg-red-100 text-red-600',
};

const groupByDate = (interviews: Interview[]) => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfNextWeek = new Date(startOfToday);
  startOfNextWeek.setDate(startOfNextWeek.getDate() + 7);

  const groups: { label: string; items: Interview[] }[] = [
    { label: 'Today',     items: [] },
    { label: 'Tomorrow',  items: [] },
    { label: 'This Week', items: [] },
    { label: 'Upcoming',  items: [] },
    { label: 'Past',      items: [] },
  ];

  for (const iv of interviews) {
    const d = new Date(iv.scheduledAt);
    if (d < startOfToday) {
      groups[4].items.push(iv);
    } else if (d < startOfTomorrow) {
      groups[0].items.push(iv);
    } else if (d < new Date(startOfTomorrow.getTime() + 86400000)) {
      groups[1].items.push(iv);
    } else if (d < startOfNextWeek) {
      groups[2].items.push(iv);
    } else {
      groups[3].items.push(iv);
    }
  }

  return groups.filter((g) => g.items.length > 0);
};

const InterviewCard: React.FC<{ interview: Interview }> = ({ interview }) => {
  const navigate = useNavigate();
  const date = new Date(interview.scheduledAt);
  const initials = interview.candidateName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-slate-200 transition-all group"
    >
      {/* Time column */}
      <div className="w-16 shrink-0 text-center">
        <p className="text-sm font-bold text-slate-800 leading-tight">
          {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">{interview.duration}m</p>
      </div>

      {/* Divider */}
      <div className="w-px self-stretch bg-slate-100 shrink-0" />

      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-brand/10 text-brand font-bold text-sm flex items-center justify-center shrink-0">
        {initials}
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-slate-800 truncate">{interview.candidateName}</p>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[interview.status] ?? 'bg-slate-100 text-slate-600'}`}>
            {interview.status}
          </span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[interview.interviewType] ?? 'bg-slate-100 text-slate-600'}`}>
            {TYPE_LABELS[interview.interviewType] ?? interview.interviewType}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
          <span className="flex items-center gap-1">
            <Briefcase size={12} />
            {interview.role}
          </span>
          <span className="flex items-center gap-1">
            <User size={12} />
            {interview.candidateEmail}
          </span>
        </div>
        {interview.notes && (
          <p className="mt-1 text-xs text-slate-400 truncate">{interview.notes}</p>
        )}
      </div>

      {/* Action */}
      {(interview.status === 'scheduled' || interview.status === 'live') && (
        <button
          onClick={() => navigate(`/interview/${interview._id}`)}
          className="flex items-center gap-1 px-3 py-2 rounded-xl bg-brand text-white text-sm font-semibold shrink-0 opacity-0 group-hover:opacity-100 transition-all hover:bg-brand-hover"
        >
          <Video size={14} />
          Join
          <ChevronRight size={14} />
        </button>
      )}
    </motion.div>
  );
};

const Schedule: React.FC = () => {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('http://localhost:3000/api/interviews')
      .then((r) => r.json())
      .then((data) => setInterviews(Array.isArray(data) ? data : []))
      .catch(() => setInterviews([]))
      .finally(() => setLoading(false));
  }, []);

  const groups = groupByDate(interviews);

  const upcoming = interviews.filter((i) => {
    const d = new Date(i.scheduledAt);
    return d >= new Date() && i.status !== 'cancelled' && i.status !== 'completed';
  });
  const todayCount = groups.find((g) => g.label === 'Today')?.items.length ?? 0;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Schedule</h1>
          <p className="text-slate-500 mt-1">All your upcoming and past interviews in one place.</p>
        </div>
        <button
          onClick={() => navigate('/new')}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl font-semibold hover:bg-brand-hover transition-all shadow-md shadow-brand/20"
        >
          <Calendar size={18} />
          New Interview
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Today',    value: todayCount,        icon: <Clock size={18} />,    color: 'text-brand' },
          { label: 'Upcoming', value: upcoming.length,   icon: <Calendar size={18} />, color: 'text-violet-500' },
          { label: 'Total',    value: interviews.length, icon: <Video size={18} />,    color: 'text-emerald-500' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3">
            <div className={`${s.color} p-2 bg-slate-50 rounded-xl`}>{s.icon}</div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center items-center py-24 text-slate-400">
          <Loader2 size={32} className="animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Inbox size={48} className="text-slate-300 mb-4" />
          <p className="text-slate-500 font-medium">No interviews scheduled yet.</p>
          <button
            onClick={() => navigate('/new')}
            className="mt-4 px-5 py-2.5 bg-brand text-white rounded-xl font-semibold hover:bg-brand-hover transition-all"
          >
            Schedule your first interview
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">{group.label}</h2>
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-xs text-slate-400">{group.items.length} interview{group.items.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-2">
                {group.items.map((iv) => (
                  <InterviewCard key={iv._id} interview={iv} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
};

export default Schedule;
