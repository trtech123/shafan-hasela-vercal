import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Schedule from './pages/Schedule';
import Activities from './pages/Activities';
import Instructors from './pages/Instructors';
import Tasks from './pages/Tasks';
import Maintenance from './pages/Maintenance';
import Quotes from './pages/Quotes';
import Leads from './pages/Leads';
import CashRegister from './pages/CashRegister';
import DailySalesReport from './pages/DailySalesReport';
import Pricing from './pages/Pricing';
import Login from './pages/Login';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated, authError } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/activities" element={<Activities />} />
        <Route path="/instructors" element={<Instructors />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/maintenance" element={<Maintenance />} />
        <Route path="/quotes" element={<Quotes />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/cashregister" element={<CashRegister />} />
        <Route path="/sales-report" element={<DailySalesReport />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="*" element={<PageNotFound />} />
      </Route>
    </Routes>
  );
};


function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/*" element={<AuthenticatedApp />} />
          </Routes>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App