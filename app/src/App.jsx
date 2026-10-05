import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { safePaymentContinuation } from '@/lib/payment-continuation';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Customers from './pages/Customers';
import Vouchers from './pages/Vouchers';
import Schedule from './pages/Schedule';
import Activities from './pages/Activities';
import Instructors from './pages/Instructors';
import Clubs from './pages/Clubs';
import ClubAttendance from './pages/ClubAttendance';
import InstructorAttendance from './pages/InstructorAttendance';
import Tasks from './pages/Tasks';
import Maintenance from './pages/Maintenance';
import Quotes from './pages/Quotes';
import Leads from './pages/Leads';
import CashRegister from './pages/CashRegister';
import DailySalesReport from './pages/DailySalesReport';
import Pricing from './pages/Pricing';
import Users from './pages/Users';
import Products from './pages/Products';
import Templates from './pages/Templates';
import Login from './pages/Login';
import PaymentReturn from './pages/PaymentReturn';
import OrderPayment from './pages/OrderPayment';
import ChatbotHandoffs from './pages/ChatbotHandoffs';
import AccountingOperations from './pages/AccountingOperations';
import PelecardTransactions from './pages/PelecardTransactions';
import PrivacyPolicy from './pages/PrivacyPolicy';
import DataDeletion from './pages/DataDeletion';

const PaymentReturnRoute = () => {
  const location = useLocation();
  return new URLSearchParams(location.search).has('orderId') ? <OrderPayment /> : <PaymentReturn />;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated, authError } = useAuth();
  const location = useLocation();

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
    return <Navigate to="/login" replace state={{ paymentReturnTo: safePaymentContinuation(location.pathname + location.search) }} />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/vouchers" element={<Vouchers />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/activities" element={<Activities />} />
        <Route path="/instructors" element={<Instructors />} />
        <Route path="/clubs" element={<Clubs />} />
        <Route path="/club-attendance" element={<ClubAttendance />} />
        <Route path="/instructor-attendance" element={<InstructorAttendance />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/maintenance" element={<Maintenance />} />
        <Route path="/quotes" element={<Quotes />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/cashregister" element={<CashRegister />} />
        <Route path="/payment/order" element={<OrderPayment />} />
        <Route path="/payment/return" element={<PaymentReturnRoute />} />
        <Route path="/sales-report" element={<DailySalesReport />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/users" element={<Users />} />
        <Route path="/products" element={<Products />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/chatbot-handoffs" element={<ChatbotHandoffs />} />
        <Route path="/accounting-operations" element={<AccountingOperations />} />
        <Route path="/pelecard-transactions" element={<PelecardTransactions />} />
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
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/data-deletion" element={<DataDeletion />} />
            <Route path="/*" element={<AuthenticatedApp />} />
          </Routes>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
