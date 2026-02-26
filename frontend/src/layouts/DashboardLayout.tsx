import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Video, 
  Calendar, 
  User, 
  Settings, 
  LogOut,
  PlusCircle,
  Menu,
  X
} from 'lucide-react';
import { UserButton } from '@clerk/clerk-react';
import { motion, AnimatePresence } from 'framer-motion';

const SidebarLink = ({ to, icon: Icon, label, active }: { to: string, icon: any, label: string, active: boolean }) => (
  <Link 
    to={to} 
    className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
      active 
        ? 'bg-brand text-white shadow-lg shadow-brand/30' 
        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
    }`}
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </Link>
);

export const DashboardLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const location = useLocation();

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/interviews', icon: Video, label: 'Interviews' },
    { to: '/schedule', icon: Calendar, label: 'Schedule' },
    { to: '/profile', icon: User, label: 'Profile' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 bg-white border-r border-slate-200 lg:block z-50">
        <div className="flex flex-col h-full p-6">
          <div className="flex items-center gap-2 px-2 mb-10">
            <div className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center text-white shadow-lg">
              <Video size={24} />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-brand to-purple-600 bg-clip-text text-transparent">
              TalentIQ
            </span>
          </div>

          <nav className="flex-1 space-y-2">
            {navItems.map((item) => (
              <SidebarLink 
                key={item.to}
                {...item}
                active={location.pathname === item.to}
              />
            ))}
          </nav>

          <div className="pt-6 mt-10 border-t border-slate-100">
            <button className="flex w-full items-center gap-3 px-4 py-3 text-slate-500 hover:bg-red-50 hover:text-red-600 rounded-xl transition-colors">
              <LogOut size={20} />
              <span className="font-medium">Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="fixed top-0 inset-x-0 h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 lg:hidden flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center text-white shadow-md">
            <Video size={18} />
          </div>
          <span className="font-bold text-lg">TalentIQ</span>
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </header>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, x: -100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -100 }}
            className="fixed inset-0 bg-white z-[60] lg:hidden p-6"
          >
            <div className="flex justify-between items-center mb-10">
              <span className="text-xl font-bold">Menu</span>
              <button 
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                <X size={24} />
              </button>
            </div>
            <nav className="space-y-4">
              {navItems.map((item) => (
                <div key={item.to} onClick={() => setIsMobileMenuOpen(false)}>
                  <SidebarLink 
                    {...item}
                    active={location.pathname === item.to}
                  />
                </div>
              ))}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 lg:ml-64 pt-16 lg:pt-0">
        {/* Topbar */}
        <div className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 hidden lg:flex items-center justify-between px-8 sticky top-0 z-30">
          <h1 className="text-lg font-semibold text-slate-800">
            {navItems.find(item => item.to === location.pathname)?.label || 'Dashboard'}
          </h1>
          <div className="flex items-center gap-4">
            <Link to="/new" className="flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-lg hover:bg-brand-hover transition-colors shadow-md shadow-brand/20">
              <PlusCircle size={18} />
              <span>New Interview</span>
            </Link>
            <div className="w-px h-6 bg-slate-200 mx-2" />
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>

        <div className="p-4 lg:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};
