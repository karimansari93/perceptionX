import { setupServer } from 'msw/node';

// No default handlers: each test installs a MockBackend (see ./supabase.ts)
// with the exact fault it wants to reproduce.
export const server = setupServer();
