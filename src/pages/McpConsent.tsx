import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Check, Database, Lock } from 'lucide-react';

// OAuth consent page for the PerceptionX MCP server.
//
// An MCP host (ChatGPT, Claude, …) lands the user here from the server's
// /authorize endpoint with a ?request_id. The user is already signed in to
// the app (ProtectedRoute handles the redirect if not); this page shows WHO
// is asking and lets them pick WHICH organization to connect, then calls the
// server's approve endpoint — which re-validates membership + org enablement
// server-side and returns the redirect that carries the auth code back to
// the AI assistant. This page is a convenience shell; it holds no authority.

interface ConsentInfo {
  client_name: string;
  scope: string;
  scope_description: string;
  organizations: { id: string; name: string }[];
  no_org_reason?: string;
  error?: string;
}

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp-server`;

export default function McpConsent() {
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('request_id') || '';

  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'approving' | 'done' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const authedFetch = useMemo(() => async (path: string, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Not signed in');
    return fetch(`${FN_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
    });
  }, []);

  useEffect(() => {
    if (!requestId) {
      setErrorMsg('Missing request id — start again from your AI assistant.');
      setPhase('error');
      return;
    }
    (async () => {
      try {
        const res = await authedFetch(`/authorize/info?request_id=${encodeURIComponent(requestId)}`);
        const data = await res.json();
        if (!res.ok) {
          setErrorMsg(data.error || 'This authorization request is no longer valid.');
          setPhase('error');
          return;
        }
        setInfo(data);
        if (data.organizations?.length === 1) setSelectedOrg(data.organizations[0].id);
        setPhase('ready');
      } catch (e: any) {
        setErrorMsg(e.message || 'Could not load the authorization request.');
        setPhase('error');
      }
    })();
  }, [requestId, authedFetch]);

  const approve = async () => {
    if (!selectedOrg) return;
    setPhase('approving');
    try {
      const res = await authedFetch('/authorize/approve', {
        method: 'POST',
        body: JSON.stringify({ request_id: requestId, organization_id: selectedOrg }),
      });
      const data = await res.json();
      if (!res.ok || !data.redirect_to) {
        setErrorMsg(data.error || 'Authorization failed.');
        setPhase('error');
        return;
      }
      setPhase('done');
      window.location.href = data.redirect_to;
    } catch (e: any) {
      setErrorMsg(e.message || 'Authorization failed.');
      setPhase('error');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <img
            alt="PerceptionX"
            className="w-12 h-12 object-contain rounded-full mx-auto mb-2"
            src="/logos/PinkBadge.png"
          />
          <CardTitle>Connect to PerceptionX</CardTitle>
          {phase !== 'error' && (
            <CardDescription>
              {info ? (
                <>
                  <span className="font-medium text-gray-900">{info.client_name}</span>
                  {' '}wants to read your PerceptionX data
                </>
              ) : (
                'Loading authorization request…'
              )}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {phase === 'error' && (
            <div className="flex items-start gap-2 text-sm text-red-600">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {info && phase !== 'error' && (
            <>
              <div className="rounded-lg border bg-gray-50 p-3 space-y-2 text-sm text-gray-600">
                <div className="flex items-start gap-2">
                  <Database className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
                  <span>{info.scope_description}</span>
                </div>
                <div className="flex items-start gap-2">
                  <Lock className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
                  <span>Read-only. You can revoke access at any time by contacting PerceptionX.</span>
                </div>
              </div>

              {info.organizations.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-900">Connect which organization?</p>
                  {info.organizations.map((org) => (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => setSelectedOrg(org.id)}
                      className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                        selectedOrg === org.id
                          ? 'border-pink-500 bg-pink-50 text-gray-900'
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      <span>{org.name}</span>
                      {selectedOrg === org.id && <Check className="w-4 h-4 text-pink-600" />}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-start gap-2 text-sm text-amber-700">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{info.no_org_reason || 'No eligible organization found for your account.'}</span>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => window.history.length > 1 ? window.history.back() : window.close()}
                  disabled={phase === 'approving' || phase === 'done'}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={approve}
                  disabled={!selectedOrg || phase === 'approving' || phase === 'done'}
                >
                  {phase === 'approving' || phase === 'done' ? 'Connecting…' : 'Allow access'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
