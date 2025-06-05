declare module "https://esm.sh/@supabase/supabase-js@2" {
  export function createClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: {
      auth?: {
        persistSession?: boolean;
        autoRefreshToken?: boolean;
        detectSessionInUrl?: boolean;
      };
      global?: {
        headers?: Record<string, string>;
      };
    }
  ): any;
}

declare module "https://deno.land/std@0.177.0/http/server.ts" {
  export function serve(handler: (req: Request) => Promise<Response>): void;
} 