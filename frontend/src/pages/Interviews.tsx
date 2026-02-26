import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Video, Search, Filter, Calendar, Clock, User, ArrowUpRight, Play, MoreHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Interviews: React.FC = () => {
  const [interviews, setInterviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
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

  const filteredInterviews = interviews.filter(interview => 
    interview.candidateName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    interview.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8">
      {/* Header & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Interviews</h1>
          <p className="text-slate-500 mt-1">Manage and jump into your scheduled interview sessions.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Search candidates..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand w-64 transition-all"
            />
          </div>
          <button className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors">
            <Filter size={20} />
          </button>
        </div>
      </div>

      {/* Grid List */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {loading ? (
          [1, 2, 3].map(i => (
            <div key={i} className="h-64 bg-slate-200/50 animate-pulse rounded-3xl" />
          ))
        ) : filteredInterviews.length > 0 ? (
          filteredInterviews.map((interview, index) => (
            <motion.div
              key={interview._id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="group bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:border-brand/20 transition-all p-6 flex flex-col h-full"
            >
              <div className="flex justify-between items-start mb-6">
                <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-brand font-bold text-xl">
                  {interview.candidateName.split(' ').map((n: string) => n[0]).join('')}
                </div>
                <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  interview.status === 'live' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-600'
                }`}>
                  {interview.status}
                </div>
              </div>

              <div className="flex-1">
                <h3 className="text-xl font-bold text-slate-900 group-hover:text-brand transition-colors">
                  {interview.candidateName}
                </h3>
                <p className="text-slate-500 text-sm font-medium mt-0.5">{interview.role}</p>
                
                <div className="mt-6 space-y-3">
                  <div className="flex items-center gap-3 text-slate-600">
                    <Calendar size={16} className="text-slate-400" />
                    <span className="text-sm">{new Date(interview.scheduledAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-600">
                    <Clock size={16} className="text-slate-400" />
                    <span className="text-sm">{new Date(interview.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-50 flex items-center justify-between">
                <button 
                  onClick={() => navigate(`/interview/${interview._id}`)}
                  className="flex items-center gap-2 bg-slate-900 group-hover:bg-brand text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-slate-900/10 group-hover:shadow-brand/20"
                >
                  <Play size={16} fill="currentColor" />
                  Join Room
                </button>
                <button className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-all">
                  <MoreHorizontal size={20} />
                </button>
              </div>
            </motion.div>
          ))
        ) : (
          <div className="col-span-full py-20 text-center">
             <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
               <Video size={32} />
             </div>
             <h3 className="text-xl font-bold text-slate-900">No interviews found</h3>
             <p className="text-slate-500 mt-2">Try adjusting your search or schedule a new interview.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Interviews;
