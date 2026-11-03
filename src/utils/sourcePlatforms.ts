// The one rule for grouping cited sources into platforms and for deciding
// what a client owns. The code lives with the edge functions, which build the
// quarterly email and the Ask AI and MCP tools from it; the dashboard imports
// it from here so no surface keeps a rule of its own. Pure TypeScript with no
// imports, so Vite and Deno both read it. Read the header of the file for the
// rule itself.
export * from '../../supabase/functions/_shared/source-platforms';
