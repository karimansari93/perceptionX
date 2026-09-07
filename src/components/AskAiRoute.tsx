import { Navigate } from 'react-router-dom';
import { useCompany } from '@/contexts/CompanyContext';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import { ASK_AI_ENABLED } from '@/lib/askAi';

interface AskAiRouteProps {
  children: React.ReactNode;
}

// Gate for /chat: any signed-in member of an organization (owner, admin or
// member) — the analyst is scoped server-side to that organization. Behind
// the platform-wide VITE_ASK_AI_ENABLED kill switch.
export default function AskAiRoute({ children }: AskAiRouteProps) {
  const { currentCompany, userCompanies, loading } = useCompany();

  if (!ASK_AI_ENABLED) return <Navigate to="/dashboard" replace />;
  if (loading) return <LoadingScreen />;

  const organizationId = currentCompany?.organization_id ?? userCompanies[0]?.organization_id;
  if (!organizationId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#13274F]">
              <AlertTriangle className="w-5 h-5" />
              No organisation yet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">
              Ask PerceptionX answers from your organisation's data. Ask your PerceptionX admin to add you to one.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
