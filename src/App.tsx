import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import OnboardingGuard from "@/components/OnboardingGuard";
import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Prompts from "./pages/Prompts";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Auth />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <OnboardingGuard requireOnboarding={true}>
                  <Dashboard />
                </OnboardingGuard>
              </ProtectedRoute>
            } />
            <Route path="/prompts" element={
              <ProtectedRoute>
                <Prompts />
              </ProtectedRoute>
            } />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
