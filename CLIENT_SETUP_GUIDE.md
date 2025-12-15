# Client Setup Guide: Pro Organization & Company

This guide walks you through the best way to set up a Pro organization and company for a new client.

## Overview

The system uses a hierarchical structure:
- **Organizations** → Top-level entities (agencies/teams that manage multiple clients)
- **Companies** → Belong to organizations (the actual client companies)
- **Users** → Belong to organizations with roles (owner/admin/member)
- **Subscription Types** → Free or Pro (Pro unlocks more features)

## Step-by-Step Setup Process

### Option 1: New Client (User Doesn't Exist Yet)

#### Step 1: User Registration
The client needs to sign up first:
1. Have the client go to your app and sign up with their email
2. They'll complete the onboarding flow (this creates their profile)
3. Note their email address

#### Step 2: Create Organization
1. Go to **Admin Panel** → **Organizations** tab
2. Click **"Create Organization"**
3. Enter:
   - **Organization Name**: e.g., "Client Name's Organization" or "Agency Name"
   - **Description**: (Optional) Brief description
4. Click **"Create Organization"**
5. **Save the Organization ID** (you'll need it)

#### Step 3: Add User to Organization
1. In the **Organizations** tab, find the organization you just created
2. Click **"Add User"** button
3. Select the user (by email) from the dropdown
4. Choose their **Role**:
   - **Owner**: Full control (recommended for client)
   - **Admin**: Can manage companies and members
   - **Member**: Basic access
5. Click **"Add User"**

#### Step 4: Upgrade User to Pro
1. Go to **Admin Panel** → **Users** tab
2. Find the user by email
3. Click **"Upgrade to Pro"** button
4. Wait for confirmation (this automatically generates TalentX Pro prompts)

#### Step 5: Create Company
1. Go to **Admin Panel** → **Companies** tab
2. Click **"Add Company"**
3. Fill in:
   - **Company Name**: The client's company name
   - **Industry**: Select from dropdown
   - **Organization**: Select the organization you created
4. Click **"Create Company"**

✅ **Done!** The client now has:
- A Pro subscription
- An organization they belong to
- A company linked to their organization
- Access to all Pro features

---

### Option 2: Existing User (Client Already Has Account)

If the user already exists in the system:

#### Step 1: Create Organization (if needed)
- Follow Step 2 from Option 1
- OR use an existing organization

#### Step 2: Add User to Organization
- Follow Step 3 from Option 1
- If user is already in an organization, you can add them to additional ones

#### Step 3: Upgrade to Pro (if not already Pro)
- Follow Step 4 from Option 1
- If already Pro, skip this step

#### Step 4: Create Company
- Follow Step 5 from Option 1

---

## Quick Setup Checklist

For a new client, use this checklist:

- [ ] Client has signed up and has an account
- [ ] Organization created in Admin Panel
- [ ] User added to organization (with Owner role)
- [ ] User upgraded to Pro subscription
- [ ] Company created and linked to organization
- [ ] Verify user can access their dashboard and see the company

---

## Admin Panel Navigation

The Admin Panel has these tabs:

1. **Organizations** → Create/manage organizations
2. **Users** → View users, upgrade to Pro
3. **Companies** → Create/manage companies, refresh data
4. **Data Chat** → Query system data
5. **Visibility Rankings** → Manage visibility rankings

---

## Important Notes

### Subscription Limits
- **Free users**: Up to 3 companies
- **Pro users**: Up to 10 companies
- Pro users get access to more AI models and TalentX Pro prompts

### Organization Structure
- One user can belong to multiple organizations
- One organization can have multiple companies
- Companies belong to organizations, not directly to users

### Pro Features
When a user is upgraded to Pro:
- ✅ Access to 6 AI models (vs 4 for free)
- ✅ TalentX Pro prompts are automatically generated
- ✅ Up to 10 companies (vs 3 for free)
- ✅ Advanced analytics and reporting

### Company Data Refresh
After creating a company:
1. Go to **Companies** tab
2. Click **"View Details"** on the company
3. Click **"Refresh"** to collect initial data
4. Select models and prompt types
5. Wait for data collection to complete

---

## Troubleshooting

### User can't see their company
- Check: User is added to the organization
- Check: Company is linked to the organization
- Check: User has the correct role in the organization

### Pro features not showing
- Verify: User subscription_type is 'pro' in Users tab
- Try: Re-upgrade the user (the upgrade function is idempotent)
- Check: Browser cache - have user refresh their dashboard

### Company not appearing in user's dashboard
- Verify: Company is linked to the organization via `organization_companies` table
- Check: User's default organization is set correctly
- Refresh: User's browser and dashboard

---

## SQL Verification (Optional)

If you need to verify the setup manually in Supabase SQL Editor:

```sql
-- Check user's subscription
SELECT id, email, subscription_type 
FROM profiles 
WHERE email = 'client@example.com';

-- Check user's organizations
SELECT o.name, om.role, om.is_default
FROM organizations o
JOIN organization_members om ON om.organization_id = o.id
JOIN profiles p ON p.id = om.user_id
WHERE p.email = 'client@example.com';

-- Check organization's companies
SELECT c.name, c.industry, oc.added_at
FROM companies c
JOIN organization_companies oc ON oc.company_id = c.id
JOIN organizations o ON o.id = oc.organization_id
WHERE o.name = 'Client Organization Name';

-- Check if user has Pro prompts
SELECT COUNT(*) as pro_prompt_count
FROM confirmed_prompts
WHERE user_id = (SELECT id FROM profiles WHERE email = 'client@example.com')
AND is_pro_prompt = true;
```

---

## Best Practices

1. **Organization Naming**: Use clear, descriptive names (e.g., "Acme Corp Organization")
2. **User Roles**: Give clients "Owner" role so they have full control
3. **Company Setup**: Create the company after upgrading to Pro for best experience
4. **Initial Data**: Run a refresh after company creation to populate initial data
5. **Documentation**: Keep track of organization IDs and company IDs for reference

---

## Need Help?

If you encounter issues:
1. Check the browser console for errors
2. Verify all steps were completed in order
3. Check Supabase logs for database errors
4. Review the Admin Panel for any error messages






