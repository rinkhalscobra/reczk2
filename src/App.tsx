import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { LanguageProvider } from "@/contexts/LanguageContext";
import Auth from "./pages/Auth";
import RoleRoute from "./components/auth/RoleRoute";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { RouteStatus } from "./components/RouteStatus";
import { CustomerDataProvider } from "./hooks/useCustomerData";
import PermissionSync from './components/auth/PermissionSync';

const RecoveryFundsPage = lazy(() => import('./pages/dashboard/funds'));
const WatchlistNew = lazy(() => import('./pages/WatchlistNew'));
const Admin = lazy(() => import('./pages/Admin'));
const GroupAdmin = lazy(() => import('./pages/GroupAdmin'));
const GroupDetail = lazy(() => import('./pages/GroupDetail'));
const Supervisor = lazy(() => import('./pages/Supervisor'));
const Agent = lazy(() => import('./pages/Agent'));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'));
const DashboardIndex = lazy(() => import('./pages/dashboard/index'));
const WalletPage = lazy(() => import('./pages/dashboard/wallet'));
const TransactionsPage = lazy(() => import('./pages/dashboard/transactions'));
const CasePage = lazy(() => import('./pages/dashboard/case'));
const DepositPage = lazy(() => import('./pages/dashboard/deposit'));
const WithdrawPage = lazy(() => import('./pages/dashboard/withdraw'));
const NotificationsPage = lazy(() => import('./pages/dashboard/notifications'));
const MessagesPage = lazy(() => import('./pages/dashboard/messages'));

/**
 * All routes share the neutral charcoal palette. Surface and interface attributes
 * retain the layout and interaction rules for public, client, and CRM pages.
 */
const SurfaceTheme = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const isCrm = /^(\/admin|\/group-admin|\/supervisor|\/agent|\/customer(?:\/|$))/.test(pathname);
    const isClient = /^(\/dashboard(?:\/|$)|\/watchlist(?:\/|$))/.test(pathname);
    document.body.dataset.surface = isCrm ? "crm" : "brand";
    document.body.dataset.interface = isCrm ? "crm" : isClient ? "client" : "public";
    return () => {
      delete document.body.dataset.surface;
      delete document.body.dataset.interface;
    };
  }, [pathname]);

  return null;
};

const App = () => (
  <LanguageProvider>
    <AuthProvider>
      <TooltipProvider>
        <PermissionSync />
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <SurfaceTheme />
          <AppErrorBoundary>
          <CustomerDataProvider>
          <Suspense fallback={<RouteStatus />}>
          <Routes>
            <Route path="/" element={<Navigate to="/auth" replace />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard/funds" element={<RoleRoute allowedRoles={["user"]}><RecoveryFundsPage /></RoleRoute>} />
            <Route path="/watchlist" element={<WatchlistNew />} />
            <Route path="/admin" element={<RoleRoute allowedRoles={["admin"]}><Admin /></RoleRoute>} />
            <Route path="/admin/groups/:groupId" element={<RoleRoute allowedRoles={["admin", "group_admin"]}><GroupDetail /></RoleRoute>} />
            <Route path="/group-admin" element={<RoleRoute allowedRoles={["group_admin"]}><GroupAdmin /></RoleRoute>} />
            <Route path="/supervisor" element={<RoleRoute allowedRoles={["supervisor"]}><Supervisor /></RoleRoute>} />
            <Route path="/agent" element={<RoleRoute allowedRoles={["agent"]}><Agent /></RoleRoute>} />
            <Route
              path="/customer/:customerId"
              element={(
                <RoleRoute allowedRoles={["admin", "group_admin", "supervisor", "agent"]}>
                  <CustomerDetail />
                </RoleRoute>
              )}
            />
            
            {/* Dashboard Routes */}
            <Route path="/dashboard" element={<RoleRoute allowedRoles={["user"]}><DashboardIndex /></RoleRoute>} />
            <Route path="/dashboard/wallet" element={<RoleRoute allowedRoles={["user"]}><WalletPage /></RoleRoute>} />
            <Route path="/dashboard/transactions" element={<RoleRoute allowedRoles={["user"]}><TransactionsPage /></RoleRoute>} />
            <Route path="/dashboard/case" element={<RoleRoute allowedRoles={["user"]}><CasePage /></RoleRoute>} />
            <Route path="/dashboard/deposit" element={<RoleRoute allowedRoles={["user"]}><DepositPage /></RoleRoute>} />
            <Route path="/dashboard/withdraw" element={<RoleRoute allowedRoles={["user"]}><WithdrawPage /></RoleRoute>} />
            <Route path="/dashboard/notifications" element={<RoleRoute allowedRoles={["user"]}><NotificationsPage /></RoleRoute>} />
            <Route path="/dashboard/messages" element={<RoleRoute allowedRoles={["user"]}><MessagesPage /></RoleRoute>} />
            
            <Route path="*" element={<Navigate to="/auth" replace />} />
          </Routes>
          </Suspense>
          </CustomerDataProvider>
          </AppErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </LanguageProvider>
);

export default App;
