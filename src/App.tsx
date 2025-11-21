import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { CompanyProvider } from "@/contexts/CompanyContext";
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
import OnboardingLoading from "@/pages/OnboardingLoading";
import Admin from "./pages/Admin";
import AdminRoute from "./components/AdminRoute";
import GoogleOneTapCallback from "@/components/GoogleOneTapCallback";
import { logger } from "@/lib/utils";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false, // Don't refetch when tab regains focus
      refetchOnMount: false, // Don't refetch when component mounts
      refetchOnReconnect: false, // Don't refetch when internet reconnects
    },
  },
});

// Error logging handler for ErrorBoundary
const logError = (error: Error, errorInfo: { componentStack: string }) => {
  // Log error details
  logger.error('Error Boundary caught an error:', {
    message: error.message,
    stack: error.stack,
    componentStack: errorInfo.componentStack,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: window.location.href
  });
  
  // In production, this would send to Sentry or similar service
  if (import.meta.env.PROD) {
    // TODO: Integrate with Sentry when configured
    // Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack } } });
  }
};

// Error Fallback Component
const ErrorFallback = ({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) => {
  const isDevelopment = import.meta.env.DEV;
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-lg w-full bg-white shadow-lg rounded-lg p-6">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <AlertTriangle className="w-12 h-12 text-red-500" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Something went wrong</h2>
          <p className="text-gray-600 mb-6">
            We're sorry, but something unexpected happened. Please try refreshing the page or returning to the home page.
          </p>
          
          {isDevelopment && error && (
            <details className="mb-6 text-left bg-gray-50 p-4 rounded border border-gray-200">
              <summary className="cursor-pointer font-medium text-sm text-gray-700 mb-2">
                Error Details (Development Only)
              </summary>
              <div className="text-xs text-gray-600 space-y-2 mt-2">
                <div>
                  <strong>Message:</strong>
                  <pre className="mt-1 p-2 bg-white rounded overflow-auto">{error.message}</pre>
                </div>
                {error.stack && (
                  <div>
                    <strong>Stack:</strong>
                    <pre className="mt-1 p-2 bg-white rounded overflow-auto max-h-40 text-xs">{error.stack}</pre>
                  </div>
                )}
              </div>
            </details>
          )}
          
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={resetErrorBoundary}
              className="inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
            <button
              onClick={() => window.location.href = '/'}
              className="inline-flex items-center justify-center gap-2 bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300 transition-colors"
            >
              <Home className="w-4 h-4" />
              Go to home
            </button>
          </div>
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
  <ErrorBoundary 
    FallbackComponent={ErrorFallback}
    onError={logError}
    onReset={() => {
      // Clear any error state when resetting
      window.location.href = window.location.pathname;
    }}
  >
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <PageTracker />
          <AuthProvider>
            <CompanyProvider>
              <Toaster />
              <Sonner />
              <Routes>
              <Route path="/" element={<Auth />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/auth/google-onetap" element={<GoogleOneTapCallback />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              
              {/* Admin routes - no onboarding guard */}
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
              <Route path="/monitor/career-site" element={
                <ProtectedRoute>
                  <OnboardingGuard requireOnboarding={true}>
                    <SidebarProvider>
                      <Dashboard defaultGroup="monitor" defaultSection="career-site" />
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
            </CompanyProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
