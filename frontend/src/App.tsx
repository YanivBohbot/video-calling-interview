import { useState } from "react";
import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { DashboardLayout } from "./layouts/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import { InterviewRoom } from "./pages/InterviewRoom";
import NewInterview from "./pages/NewInterview";
import Interviews from "./pages/Interviews";

function App() {
  const [isDemo, setIsDemo] = useState(false);

  // Helper to render the protected content
  const ProtectedRoutes = () => (
    <Routes>
      <Route path="/interview/:id" element={<InterviewRoom />} />
      <Route
        path="/*"
        element={
          <DashboardLayout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/new" element={<NewInterview />} />
              <Route path="/interviews" element={<Interviews />} />
              <Route path="/schedule" element={<div className="p-8 text-2xl font-bold">Schedule Page (Coming Soon)</div>} />
              <Route path="/profile" element={<div className="p-8 text-2xl font-bold">Profile Page (Coming Soon)</div>} />
              <Route path="/settings" element={<div className="p-8 text-2xl font-bold">Settings Page (Coming Soon)</div>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </DashboardLayout>
        }
      />
    </Routes>
  );

  return (
    <Router>
      <Routes>
        {/* Public Routes */}
        <Route
          path="/sign-in/*"
          element={
            isDemo ? <Navigate to="/" replace /> :
            <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 relative overflow-hidden p-4">
               {/* Decorative background elements */}
              <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-[600px] h-[600px] bg-brand/5 rounded-full blur-3xl" />
              <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-brand/5 rounded-full blur-3xl" />

              <div className="mb-8 text-center animate-in fade-in slide-in-from-top duration-700">
                <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 mb-2">
                  Talent<span className="text-brand">IQ</span>
                </h1>
                <p className="text-slate-500 font-medium">Elevating the interview experience</p>
              </div>

              <SignIn 
                routing="path" 
                path="/sign-in" 
                appearance={{
                  elements: {
                    rootBox: "mx-auto w-full max-w-md",
                    card: "shadow-2xl border border-slate-100 rounded-[2rem] bg-white/80 backdrop-blur-xl",
                    headerTitle: "text-2xl font-bold text-slate-900",
                    headerSubtitle: "text-slate-500",
                    socialButtonsBlockButton: "border-slate-100 hover:bg-slate-50 transition-all rounded-xl",
                    formButtonPrimary: "bg-brand hover:bg-brand-hover transition-all text-white py-3.5 rounded-xl font-bold text-base shadow-lg shadow-brand/20",
                    formFieldInput: "rounded-xl border-slate-200 focus:ring-brand/20 py-3",
                    footerActionLink: "text-brand hover:underline font-semibold",
                    dividerText: "text-slate-400 text-[10px] uppercase font-bold tracking-widest",
                    identityPreviewText: "text-slate-900 font-semibold",
                  },
                  layout: {
                    socialButtonsPlacement: "bottom",
                    showOptionalFields: false,
                    helpPageUrl: "#",
                  }
                }}
              />

              {/* Developer Bypass */}
              <button 
                onClick={() => setIsDemo(true)}
                className="mt-8 text-slate-400 hover:text-slate-900 text-sm font-medium transition-colors underline underline-offset-4"
              >
                Continue as Guest (Demo Mode)
              </button>
            </div>
          }
        />

        {/* Protected Dashboard Routes */}
        <Route
          path="/*"
          element={
            isDemo ? (
              <ProtectedRoutes />
            ) : (
              <>
                <SignedIn>
                  <ProtectedRoutes />
                </SignedIn>
                <SignedOut>
                  <div className="min-h-screen flex flex-col items-center justify-center bg-white p-4">
                    <div className="max-w-md w-full text-center space-y-8">
                      <div className="space-y-4">
                        <h1 className="text-5xl font-extrabold tracking-tight text-slate-900">
                          Talent<span className="text-brand">IQ</span>
                        </h1>
                        <p className="text-lg text-slate-600">
                          The next generation AI-powered interview platform for elite engineering teams.
                        </p>
                      </div>
                      <div className="flex justify-center">
                        <Navigate to="/sign-in" replace />
                      </div>
                    </div>
                  </div>
                </SignedOut>
              </>
            )
          }
        />
      </Routes>
    </Router>
  );
}

export default App;