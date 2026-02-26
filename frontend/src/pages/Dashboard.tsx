import React from 'react';
import { motion } from 'framer-motion';
import { 
  Users, 
  Video, 
  CheckCircle2, 
  Clock,
  ArrowUpRight,
  MoreVertical,
  Play
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const StatCard = ({ label, value, icon: Icon, color, delay }: { label: string, value: string, icon: any, color: string, delay: number }) => (
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
      <button className="text-slate-400 hover:text-slate-600">
        <MoreVertical size={20} />
      </button>
    </div>
    <div>
      <h3 className="text-slate-500 text-sm font-medium">{label}</h3>
      <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
    </div>
  </motion.div>
);

const InterviewItem = ({ id, name, type, time, status, delay }: { id: string, name: string, type: string, time: string, status: string, delay: number }) => {
  const navigate = useNavigate();
  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      onClick={() => navigate(`/interview/${id}`)}
      className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-100 mb-3 hover:bg-slate-50 cursor-pointer transition-colors"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold">
          {name.split(' ').map(n => n[0]).join('')}
        </div>
        <div>
          <h4 className="font-semibold text-slate-800">{name}</h4>
          <p className="text-sm text-slate-500">{type} • {time}</p>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
          status === 'Live' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
        }`}>
          {status}
        </span>
        <button className={`p-2 rounded-lg ${
          status === 'Live' ? 'bg-brand text-white' : 'bg-slate-100 text-slate-400'
        }`}>
          {status === 'Live' ? <Play size={18} fill="currentColor" /> : <ArrowUpRight size={18} />}
        </button>
      </div>
    </motion.div>
  );
};

const Dashboard: React.FC = () => {
  const [interviews, setInterviews] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchInterviews = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/interviews');
        const data = await response.json();
        setInterviews(data);
      } catch (error) {
        console.error('Error fetching interviews:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchInterviews();
  }, []);

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 text-3xl">Welcome back, Interviewer 👋</h2>
          <p className="text-slate-500 mt-1">Here's what's happening today in your interview platform.</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          label="Total Interviews" 
          value={interviews.length.toString()} 
          icon={Video} 
          color="bg-brand" 
          delay={0.1}
        />
        <StatCard 
          label="Active Users" 
          value="1,240" 
          icon={Users} 
          color="bg-blue-500" 
          delay={0.2}
        />
        <StatCard 
          label="Completed" 
          value="0" 
          icon={CheckCircle2} 
          color="bg-green-500" 
          delay={0.3}
        />
        <StatCard 
          label="Avg. Duration" 
          value="45m" 
          icon={Clock} 
          color="bg-amber-500" 
          delay={0.4}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-900">Upcoming Interviews</h3>
            <button className="text-brand font-medium hover:underline">View All</button>
          </div>
          <div className="space-y-4">
            {loading ? (
              <div className="p-8 text-center text-slate-500">Loading interviews...</div>
            ) : interviews.length > 0 ? (
              interviews.map((interview, index) => (
                <InterviewItem 
                  key={interview._id}
                  id={interview._id}
                  name={interview.candidateName} 
                  type={interview.role} 
                  time={new Date(interview.scheduledAt).toLocaleString()} 
                  status={interview.status.charAt(0).toUpperCase() + interview.status.slice(1)} 
                  delay={0.5 + (index * 0.1)}
                />
              ))
            ) : (
              <div className="p-8 text-center text-slate-500 bg-white rounded-2xl border border-dashed border-slate-200">
                No upcoming interviews found.
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions / Activity */}
        <div className="space-y-4">
          <h3 className="text-xl font-bold text-slate-900">Recent Activity</h3>
          <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-4">
                <div className="w-2 h-2 rounded-full bg-brand mt-2 flex-shrink-0" />
                <div>
                  <p className="text-slate-800 text-sm">
                    <span className="font-semibold italic">Interview Report</span> for a candidate has been generated.
                  </p>
                  <span className="text-xs text-slate-400">{i * 2} hours ago</span>
                </div>
              </div>
            ))}
            <button className="w-full py-3 bg-slate-50 text-slate-600 rounded-xl font-medium hover:bg-slate-100 transition-colors">
              View All Activity
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
