import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Video, CheckCircle2, Clock,
  MoreVertical, Play, ArrowUpRight,
  CalendarCheck, Radio, XCircle, Loader2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';

// ── Types ──────────────────────────────────────────────────

interface Stats {
  total: number;
  completed: number;
  live: number;
  scheduled: number;
  cancelled: number;
  avgDuration: number;
  totalUsers: number;
}

interface ActivityItem {
  id: string;
  candidateName: string;
  role: string;
  status: 'scheduled' | 'live' | 'completed' | 'cancelled';
  interviewType: string;
  interviewerName: string;
  scheduledAt: string;
  updatedAt: string;
}

interface Interview {
  _id: string;
  candidateName: string;
  role: string;
  scheduledAt: string;
  status: string;
  interviewType: string;
  duration: number;
}

// ── Helpers ────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  'technical':        'Technical Screen',
  'coding-challenge': 'Coding Challenge',
  'system-design':    'System Design',
  'behavioral':       'Behavioral',
};

const activityMessage = (item: ActivityItem): string => {
  switch (item.status) {
    case 'live':      return `Live session in progress — ${item.candidateName}`;
    case 'completed': return `Interview completed — ${item.candidateName} (${item.role})`;
    case 'cancelled': return `Interview cancelled — ${item.candidateName}`;
    default:          return `Interview scheduled — ${item.candidateName} for ${item.role}`;
  }
};

const activityIcon = (status: string) => {
  switch (status) {
    case 'live':      return <Radio size={14} className="text-green-600" />;
    case 'completed': return <CheckCircle2 size={14} className="text-brand" />;
    case 'cancelled': return <XCircle size={14} className="text-red-400" />;
    default:          return <CalendarCheck size={14} className="text-violet-500" />;
  }
};

const timeAgo = (dateStr: string): string => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

// ── Sub-components ─────────────────────────────────────────

const StatCard = ({
  label, value, icon: Icon, color, delay, loading,
}: {
  label: string; value: string; icon: React.ElementType;
  color: string; delay: number; loading: boolean;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow"
  >
    <div className="flex justify-between items-start mb-4">
      <div className={`p-3 rounded-xl ${color} text-white`}>
        <Icon size={24} />
      </div>
      <button className="text-slate-400 hover:text-slate-600"><MoreVertical size={20} /></button>
    </div>
    <div>
      <h3 className="text-slate-500 text-sm font-medium">{label}</h3>
      {loading
        ? <div className="h-8 w-16 mt-1 rounded bg-slate-100 animate-pulse" />
        : <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>}
    </div>
  </motion.div>
);

const UpcomingItem = ({ interview, delay }: { interview: Interview; delay: number }) => {
  const navigate = useNavigate();
  const isLive = interview.status === 'live';
  const initials = interview.candidateName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  const dateStr = new Date(interview.scheduledAt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      onClick={() => navigate(`/interview/${interview._id}`)}
      className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors group"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-sm">
          {initials}
        </div>
        <div>
          <h4 className="font-semibold text-slate-800">{interview.candidateName}</h4>
          <p className="text-sm text-slate-500">
            {TYPE_LABELS[interview.interviewType] ?? interview.role} · {interview.duration}m · {dateStr}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
          isLive ? 'bg-green-100 text-green-700' : 'bg-sky-100 text-sky-700'
        }`}>
          {isLive ? 'Live' : 'Scheduled'}
        </span>
        <button className={`p-2 rounded-lg transition-all ${
          isLive ? 'bg-brand text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'
        }`}>
          {isLive ? <Play size={18} fill="currentColor" /> : <ArrowUpRight size={18} />}
        </button>
      </div>
    </motion.div>
  );
};

// ── Page ───────────────────────────────────────────────────

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useUser();

  const [stats, setStats]             = useState<Stats | null>(null);
  const [upcoming, setUpcoming]       = useState<Interview[]>([]);
  const [activity, setActivity]       = useState<ActivityItem[]>([]);
  const [statsLoading, setStatsLoad]  = useState(true);
  const [listLoading, setListLoad]    = useState(true);

  const displayName = user?.firstName ?? user?.fullName ?? 'there';

  useEffect(() => {
    Promise.all([
      fetch('http://localhost:3000/api/interviews/stats').then((r) => r.json()),
      fetch('http://localhost:3000/api/interviews/activity').then((r) => r.json()),
    ])
      .then(([s, a]) => {
        setStats(s);
        setActivity(Array.isArray(a) ? a : []);
      })
      .catch(console.error)
      .finally(() => setStatsLoad(false));

    fetch('http://localhost:3000/api/interviews')
      .then((r) => r.json())
      .then((data: Interview[]) => {
        if (!Array.isArray(data)) return;
        const active = data
          .filter((iv) => iv.status === 'scheduled' || iv.status === 'live')
          .sort((a, b) => {
            // live sessions always float to the top
            if (a.status === 'live' && b.status !== 'live') return -1;
            if (b.status === 'live' && a.status !== 'live') return 1;
            return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
          })
          .slice(0, 5);
        setUpcoming(active);
      })
      .catch(console.error)
      .finally(() => setListLoad(false));
  }, []);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold text-slate-900">
          Welcome back{displayName !== 'there' ? `, ${displayName}` : ''} 👋
        </h2>
        <p className="text-slate-500 mt-1">Here's what's happening in your interview platform today.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Total Interviews" value={String(stats?.total ?? 0)}     icon={Video}       color="bg-brand"       delay={0.1} loading={statsLoading} />
        <StatCard label="Total Users"       value={String(stats?.totalUsers ?? 0)} icon={Users}      color="bg-blue-500"    delay={0.2} loading={statsLoading} />
        <StatCard label="Completed"          value={String(stats?.completed ?? 0)} icon={CheckCircle2} color="bg-green-500" delay={0.3} loading={statsLoading} />
        <StatCard label="Avg. Duration"      value={stats?.avgDuration ? `${stats.avgDuration}m` : '—'} icon={Clock} color="bg-amber-500" delay={0.4} loading={statsLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Upcoming interviews */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-900">Upcoming Interviews</h3>
            <button onClick={() => navigate('/interviews')} className="text-brand font-medium hover:underline text-sm">
              View All
            </button>
          </div>

          {listLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : upcoming.length > 0 ? (
            <div className="space-y-3">
              {upcoming.map((iv, i) => (
                <UpcomingItem key={iv._id} interview={iv} delay={0.5 + i * 0.08} />
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 bg-white rounded-2xl border border-dashed border-slate-200">
              <Video size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="font-medium">No upcoming interviews.</p>
              <button
                onClick={() => navigate('/new')}
                className="mt-3 text-sm text-brand font-medium hover:underline"
              >
                Schedule one now
              </button>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="space-y-4">
          <h3 className="text-xl font-bold text-slate-900">Recent Activity</h3>
          <div className="bg-white rounded-2xl border border-slate-100 p-6">
            {statsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 size={24} className="animate-spin text-slate-300" />
              </div>
            ) : activity.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">No recent activity.</p>
            ) : (
              <div className="space-y-5">
                {activity.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => navigate(`/interview/${item.id}`)}
                    className="flex gap-3 cursor-pointer group"
                  >
                    <div className="mt-0.5 shrink-0">{activityIcon(item.status)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-700 text-sm leading-snug group-hover:text-brand transition-colors">
                        {activityMessage(item)}
                      </p>
                      <span className="text-xs text-slate-400">{timeAgo(item.updatedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => navigate('/schedule')}
              className="w-full mt-6 py-3 bg-slate-50 text-slate-600 rounded-xl font-medium hover:bg-slate-100 transition-colors text-sm"
            >
              View Full Schedule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
