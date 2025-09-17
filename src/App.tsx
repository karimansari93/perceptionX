import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import OnboardingGuard from "@/components/OnboardingGuard";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import AuthCallback from "./pages/AuthCallback";
import VerifyEmail from "./pages/VerifyEmail";
import ResetPassword from "./pages/ResetPassword";
import Usage from "./pages/Usage";
import Account from "./pages/Account";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ErrorBoundary } from "react-error-boundary";
import { usePageTracking } from "@/hooks/usePageTracking";
import { Onboarding } from "@/pages/Onboarding";
import { OnboardingLoading } from "@/pages/OnboardingLoading";
import Admin from "./pages/Admin";
import AdminRoute from "./components/AdminRoute";
import GoogleOneTapCallback from "@/components/GoogleOneTapCallback";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

// Error Fallback Component
const ErrorFallback = ({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Something went wrong</h2>
          <p className="text-gray-600 mb-4">We're sorry, but something unexpected happened.</p>
          <button
            onClick={resetErrorBoundary}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
};

// Page Tracking Component
const PageTracker = () => {
  usePageTracking();
  return null;
};

const App = () => (
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <PageTracker />
          <AuthProvider>
            <Toaster />
            <Sonner />
            <Routes>
              <Route path="/" element={<Auth />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/auth/google-onetap" element={<GoogleOneTapCallback />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              
              {/* Admin route - no onboarding guard */}
              <Route path="/admin" element={
                <ProtectedRoute>
                  <AdminRoute>
                    <Admin />
                  </AdminRoute>
                </ProtectedRoute>
              } />
              
              {/* Onboarding route */}
              <Route path="/onboarding" element={
                <ProtectedRoute>
                  <Onboarding />
                </ProtectedRoute>
              } />
              
              {/* Onboarding loading route */}
              <Route path="/onboarding/loading" element={<OnboardingLoading />} />
              
              {/* Dashboard routes */}
              <Route path="/dashboard" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Dashboard defaultGroup="dashboard" defaultSection="overview" />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              <Route path="/dashboard/sources" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Dashboard defaultGroup="dashboard" defaultSection="sources" />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              <Route path="/dashboard/competitors" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Dashboard defaultGroup="dashboard" defaultSection="competitors" />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              <Route path="/dashboard/themes" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Dashboard defaultGroup="dashboard" defaultSection="thematic" />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              
              {/* New group-based routes */}
              <Route path="/monitor" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Dashboard defaultGroup="monitor" defaultSection="prompts" />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              <Route path="/monitor/responses" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Dashboard defaultGroup="monitor" defaultSection="responses" />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              <Route path="/monitor/search" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Dashboard defaultGroup="monitor" defaultSection="search" />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              <Route path="/analyze" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Dashboard defaultGroup="analyze" defaultSection="thematic" />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              <Route path="/analyze/thematic" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Dashboard defaultGroup="analyze" defaultSection="thematic" />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              <Route path="/analyze/answer-gaps" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Dashboard defaultGroup="analyze" defaultSection="answer-gaps" />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              <Route path="/analyze/career-site" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Dashboard defaultGroup="analyze" defaultSection="career-site" />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              <Route path="/analyze/reports" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Dashboard defaultGroup="analyze" defaultSection="reports" />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              
              <Route path="/usage" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Usage />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              <Route path="/account" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Account />
                    </SidebarProvider>
                  </OnboardingGuard>
                </ProtectedRoute>
              } />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
