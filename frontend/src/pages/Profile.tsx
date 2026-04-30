import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  User, Mail, Phone, Globe, Briefcase, FileText,
  Edit3, Save, X, Loader2, CheckCircle, Video,
  Calendar, Clock, BarChart2,
} from 'lucide-react';
import { useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';

interface UserProfile {
  _id: string;
  name: string;
  email: string;
  title: string;
  bio: string;
  phone: string;
  timezone: string;
  profileImage?: string;
  createdAt: string;
}

interface Stats {
  total: number;
  completed: number;
  scheduled: number;
  cancelled: number;
  live: number;
  avgDuration: number;
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

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo',
  'Australia/Sydney', 'Pacific/Auckland',
];

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-sky-100 text-sky-700',
  live:       'bg-green-100 text-green-700',
  completed:  'bg-slate-100 text-slate-600',
  cancelled:  'bg-red-100 text-red-600',
};

const TYPE_LABELS: Record<string, string> = {
  'technical':        'Technical',
  'coding-challenge': 'Coding',
  'system-design':    'System Design',
  'behavioral':       'Behavioral',
};

const Profile: React.FC = () => {
  const { user: clerkUser, isLoaded } = useUser();
  const navigate = useNavigate();

  const clerkId    = clerkUser?.id ?? 'demo';
  const clerkName  = clerkUser?.fullName ?? clerkUser?.firstName ?? 'Demo User';
  const clerkEmail = clerkUser?.emailAddresses?.[0]?.emailAddress ?? 'demo@talentiq.dev';
  const clerkImage = clerkUser?.imageUrl;

  const [profile, setProfile]       = useState<UserProfile | null>(null);
  const [stats, setStats]           = useState<Stats | null>(null);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading]       = useState(true);
  const [editing, setEditing]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '', title: '', bio: '', phone: '', timezone: 'UTC',
  });

  useEffect(() => {
    if (!isLoaded) return;
    loadAll();
  }, [isLoaded]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [profileRes, statsRes, ivRes] = await Promise.all([
        fetch(`http://localhost:3000/api/users/by-clerk/${clerkId}`),
        fetch(`http://localhost:3000/api/users/by-clerk/${clerkId}/stats`),
        fetch(`http://localhost:3000/api/interviews?interviewerId=${clerkId}`),
      ]);

      if (profileRes.ok) {
        const p: UserProfile = await profileRes.json();
        setProfile(p);
        setForm({ name: p.name, title: p.title, bio: p.bio, phone: p.phone, timezone: p.timezone || 'UTC' });
      } else {
        // No profile yet — seed form with Clerk data
        setForm((f) => ({ ...f, name: clerkName }));
      }

      if (statsRes.ok) setStats(await statsRes.json());

      if (ivRes.ok) {
        const data = await ivRes.json();
        setInterviews(Array.isArray(data) ? data.slice(0, 5) : []);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:3000/api/users/by-clerk/${clerkId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, email: clerkEmail }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Save failed.'); return; }
      setProfile(data);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Network error — make sure the backend is running.');
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    if (profile) setForm({ name: profile.name, title: profile.title, bio: profile.bio, phone: profile.phone, timezone: profile.timezone || 'UTC' });
    setEditing(false);
    setError(null);
  };

  const initials = (form.name || clerkName)
    .split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  if (!isLoaded || loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <Loader2 size={32} className="animate-spin" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto space-y-6">

      {/* ── Hero card ────────────────────────────────────── */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="h-24 bg-gradient-to-r from-brand to-purple-600" />
        <div className="px-8 pb-6">
          <div className="flex items-end justify-between -mt-10 mb-4">
            <div className="w-20 h-20 rounded-2xl border-4 border-white shadow-lg bg-brand text-white flex items-center justify-center text-2xl font-bold overflow-hidden">
              {clerkImage
                ? <img src={clerkImage} alt={form.name} className="w-full h-full object-cover" />
                : initials}
            </div>
            <div className="flex items-center gap-2 mb-1">
              {saved && (
                <motion.span initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-1 text-emerald-600 text-sm font-medium">
                  <CheckCircle size={16} /> Saved
                </motion.span>
              )}
              {editing ? (
                <>
                  <button onClick={cancelEdit} className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-all">
                    <X size={15} /> Cancel
                  </button>
                  <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-hover transition-all disabled:opacity-60">
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </>
              ) : (
                <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-all">
                  <Edit3 size={15} /> Edit Profile
                </button>
              )}
            </div>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-slate-900">{profile?.name ?? clerkName}</h1>
            <p className="text-slate-500 font-medium mt-0.5">{profile?.title || 'No title set'}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm text-slate-400">
              <span className="flex items-center gap-1.5"><Mail size={14} />{clerkEmail}</span>
              {profile?.phone && <span className="flex items-center gap-1.5"><Phone size={14} />{profile.phone}</span>}
              {profile?.timezone && <span className="flex items-center gap-1.5"><Globe size={14} />{profile.timezone}</span>}
              {profile?.createdAt && (
                <span className="flex items-center gap-1.5">
                  <Calendar size={14} />
                  Member since {new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
              )}
            </div>
            {profile?.bio && <p className="mt-3 text-slate-600 text-sm max-w-xl leading-relaxed">{profile.bio}</p>}
          </div>
        </div>
      </div>

      {/* ── Stats ────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Interviews', value: stats.total,       icon: <Video size={18} />,    color: 'text-brand bg-brand/10' },
            { label: 'Completed',        value: stats.completed,   icon: <CheckCircle size={18}/>, color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Upcoming',         value: stats.scheduled,   icon: <Calendar size={18} />, color: 'text-violet-600 bg-violet-50' },
            { label: 'Avg Duration',     value: stats.avgDuration ? `${stats.avgDuration}m` : '—', icon: <Clock size={18} />, color: 'text-amber-600 bg-amber-50' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex items-center gap-4">
              <div className={`p-2.5 rounded-xl ${s.color}`}>{s.icon}</div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{s.value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Edit form ────────────────────────────────────── */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8">
        <div className="flex items-center gap-2 mb-6">
          <BarChart2 size={18} className="text-brand" />
          <h2 className="text-lg font-bold text-slate-800">Profile Details</h2>
        </div>

        {error && (
          <div className="mb-5 p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field icon={<User size={15} className="text-brand" />} label="Display Name" required>
            <input
              value={form.name}
              disabled={!editing}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Your full name"
              className="field-input"
            />
          </Field>

          <Field icon={<Briefcase size={15} className="text-brand" />} label="Job Title">
            <input
              value={form.title}
              disabled={!editing}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Senior Engineer"
              className="field-input"
            />
          </Field>

          <Field icon={<Phone size={15} className="text-brand" />} label="Phone">
            <input
              type="tel"
              value={form.phone}
              disabled={!editing}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+1 (555) 000-0000"
              className="field-input"
            />
          </Field>

          <Field icon={<Globe size={15} className="text-brand" />} label="Timezone">
            <select
              value={form.timezone}
              disabled={!editing}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              className="field-input bg-white"
            >
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </Field>

          <div className="md:col-span-2">
            <Field icon={<FileText size={15} className="text-brand" />} label="Bio">
              <textarea
                rows={3}
                value={form.bio}
                disabled={!editing}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                placeholder="Tell candidates a bit about yourself…"
                className="field-input resize-none"
              />
            </Field>
          </div>
        </div>

        {!editing && (
          <p className="mt-4 text-xs text-slate-400 flex items-center gap-1.5">
            <Edit3 size={12} /> Click <strong>Edit Profile</strong> above to make changes.
          </p>
        )}
      </div>

      {/* ── Recent interviews ────────────────────────────── */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Video size={18} className="text-brand" />
            <h2 className="text-lg font-bold text-slate-800">Recent Interviews</h2>
          </div>
          <button onClick={() => navigate('/interviews')} className="text-sm text-brand font-medium hover:underline">
            View all
          </button>
        </div>

        {interviews.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <Video size={36} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No interviews yet.</p>
            <button onClick={() => navigate('/new')} className="mt-3 text-sm text-brand font-medium hover:underline">
              Schedule your first one
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {interviews.map((iv) => {
              const d = new Date(iv.scheduledAt);
              const initials2 = iv.candidateName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
              return (
                <div
                  key={iv._id}
                  onClick={() => navigate(`/interview/${iv._id}`)}
                  className="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all cursor-pointer group"
                >
                  <div className="w-10 h-10 rounded-full bg-brand/10 text-brand text-sm font-bold flex items-center justify-center shrink-0">
                    {initials2}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{iv.candidateName}</p>
                    <p className="text-sm text-slate-400 truncate">{iv.role} · {TYPE_LABELS[iv.interviewType] ?? iv.interviewType}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLORS[iv.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {iv.status}
                    </span>
                    <p className="text-xs text-slate-400 mt-1">
                      {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </motion.div>
  );
};

// Tiny helper wrapper to avoid repeating label+icon markup
const Field: React.FC<{ icon: React.ReactNode; label: string; required?: boolean; children: React.ReactNode }> = ({
  icon, label, required, children,
}) => (
  <div className="space-y-1.5">
    <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
      {icon}{label}{required && <span className="text-red-400">*</span>}
    </label>
    {children}
  </div>
);

export default Profile;
