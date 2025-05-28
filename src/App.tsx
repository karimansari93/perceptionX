
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import OnboardingGuard from "@/components/OnboardingGuard";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import Analysis from "./pages/Analysis";
import Prompts from "./pages/Prompts";
import Auth from "./pages/Auth";
import Demo from "./pages/Demo";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/demo" element={<Demo />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/prompts" element={
              <ProtectedRoute>
                <Prompts />
              </ProtectedRoute>
            } />
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <OnboardingGuard requireOnboarding={true}>
                  <Dashboard />
                </OnboardingGuard>
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
