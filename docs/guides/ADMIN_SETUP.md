# Admin Panel Security Setup

## Option 1: Service Role Key (Recommended)

The most secure approach is to use the **service role key** for admin operations, which bypasses RLS entirely.

### Setup Steps:

1. **Get your service role key** from your Supabase dashboard:
   - Go to Settings → API
   - Copy the `service_role` key (not the `anon` key)

2. **Add to your environment variables**:
   ```bash
   # In your .env file
   VITE_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
   ```

3. **The admin panel will now use the service role** for all database operations, bypassing RLS policies.

### Benefits:
- ✅ **Most secure** - No hardcoded emails in policies
- ✅ **Bypasses RLS** - Can access all data regardless of user permissions
- ✅ **Server-side security** - Service role key should only be used server-side
- ✅ **No circular dependencies** - Doesn't rely on RLS policies to check admin status

### Security Considerations:
- ⚠️ **Never expose service role key** in client-side code in production
- ⚠️ **Use environment variables** to keep the key secure
- ⚠️ **Consider using a backend API** for admin operations in production

## Option 2: Admin Role System (Alternative)

If you prefer to keep using RLS policies, you can create a proper admin role system:

1. **Create an admin roles table**:
   ```sql
   CREATE TABLE admin_roles (
     id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
     user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('admin', 'super_admin')),
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```

2. **Update the is_admin() function**:
   ```sql
   CREATE OR REPLACE FUNCTION is_admin()
   RETURNS BOOLEAN AS $$
   BEGIN
     RETURN EXISTS (
       SELECT 1 FROM admin_roles 
       WHERE user_id = auth.uid() 
       AND role IN ('admin', 'super_admin')
     );
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;
   ```

3. **Add admin users**:
   ```sql
   INSERT INTO admin_roles (user_id, role) 
   VALUES ('your-user-id', 'admin');
   ```

## Current Implementation

The admin panel now uses the service role key approach, which is the most secure and reliable method for admin operations.
















