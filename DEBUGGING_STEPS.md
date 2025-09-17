# Debugging Industry Update Issue

## Issue
When updating industry in Account settings:
- ✅ `user_onboarding` table updates correctly
- ❌ `confirmed_prompts.prompt_text` not updating
- ❌ `talentx_pro_prompts.prompt_text` and other fields not updating

## Enhanced Debug Version

The updated code now includes comprehensive logging. Here's how to debug:

### 1. Open Browser Developer Tools
1. Go to Account & Settings page
2. Open browser Developer Tools (F12)
3. Go to Console tab
4. Clear the console

### 2. Attempt Industry Update
1. Change your industry (e.g., from "Technology" to "Healthcare")
2. Click "Save Changes"
3. Watch the console for debug output

### 3. Expected Console Output

You should see logs like:
```
Starting prompt text updates... {oldCompany: "...", newCompany: "...", oldIndustry: "Technology", newIndustry: "Healthcare", userId: "..."}
Found X confirmed prompts to update
Updating confirmed prompt abc123: {oldText: "What companies in Technology...", newText: "What companies in Healthcare...", ...}
Successfully updated confirmed prompt abc123
Updating TalentX Pro prompts for Pro user...
Found Y TalentX prompts to update
Updating TalentX prompt xyz789: {...}
Successfully updated TalentX prompt xyz789
```

### 4. Possible Issues & Solutions

#### A) No Prompts Found
**Console shows:** `No confirmed prompts found for this user`
**Solution:** Check if user has any confirmed prompts:
```sql
SELECT * FROM confirmed_prompts WHERE user_id = 'your-user-id';
```

#### B) Permission Errors
**Console shows:** `Error updating confirmed prompt: {...}`
**Possible causes:**
- RLS (Row Level Security) policies blocking updates
- User not authenticated properly
- Missing permissions

**Check RLS policies:**
```sql
-- Check confirmed_prompts policies
SELECT * FROM pg_policies WHERE tablename = 'confirmed_prompts';

-- Check talentx_pro_prompts policies  
SELECT * FROM pg_policies WHERE tablename = 'talentx_pro_prompts';
```

#### C) Pattern Matching Issues
**Console shows:** `No changes needed` for all prompts
**Possible causes:**
- Industry name doesn't match exactly in prompts
- Regex patterns not catching the format used

**Test the pattern matching:**
```javascript
// In browser console, test with your actual prompt text
import { updatePromptText } from '/src/utils/promptUtils.js';

const testPrompt = "Your actual prompt text here";
const result = updatePromptText(testPrompt, "Old Company", "New Company", "Technology", "Healthcare");
console.log("Original:", testPrompt);
console.log("Updated:", result);
console.log("Changed:", testPrompt !== result);
```

#### D) TalentX Table Missing
**Console shows:** `Error fetching TalentX prompts: {...}`
**Solution:** Ensure TalentX tables exist:
```sql
-- Check if table exists
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_name = 'talentx_pro_prompts'
);

-- If missing, run the creation script
-- See: scripts/create-talentx-tables.sql
```

### 5. Manual Verification

After the update, check the database directly:

```sql
-- Check confirmed_prompts
SELECT id, prompt_text, updated_at 
FROM confirmed_prompts 
WHERE user_id = 'your-user-id' 
ORDER BY updated_at DESC;

-- Check talentx_pro_prompts
SELECT id, prompt_text, company_name, industry, updated_at 
FROM talentx_pro_prompts 
WHERE user_id = 'your-user-id' 
ORDER BY updated_at DESC;

-- Check user_onboarding
SELECT company_name, industry, updated_at 
FROM user_onboarding 
WHERE user_id = 'your-user-id' 
ORDER BY updated_at DESC;
```

### 6. Common Fixes

#### Fix 1: RLS Policy Issues
If you see permission errors, you may need to update RLS policies:

```sql
-- For confirmed_prompts
DROP POLICY IF EXISTS "Users can update their own confirmed prompts" ON confirmed_prompts;
CREATE POLICY "Users can update their own confirmed prompts" ON confirmed_prompts
  FOR UPDATE USING (auth.uid() = user_id);

-- For talentx_pro_prompts  
DROP POLICY IF EXISTS "Users can update their own talentx pro prompts" ON talentx_pro_prompts;
CREATE POLICY "Users can update their own talentx pro prompts" ON talentx_pro_prompts
  FOR UPDATE USING (auth.uid() = user_id);
```

#### Fix 2: Missing Triggers
Ensure updated_at triggers exist:

```sql
-- For confirmed_prompts
CREATE TRIGGER update_confirmed_prompts_updated_at
    BEFORE UPDATE ON confirmed_prompts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- For talentx_pro_prompts
CREATE TRIGGER update_talentx_pro_prompts_updated_at
    BEFORE UPDATE ON talentx_pro_prompts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

### 7. Test Pattern Matching

Create a simple test in browser console:

```javascript
// Test the utility functions
const { updateIndustryInPrompt, updateCompanyInPrompt } = await import('/src/utils/promptUtils.js');

// Test with your actual prompt texts
const testPrompts = [
  "What companies in Technology are known for culture?",
  "How does Acme Corp compare to other companies in the Technology industry?",
  "What is the best company to work for in Technology?"
];

testPrompts.forEach(prompt => {
  const result = updateIndustryInPrompt(prompt, "Technology", "Healthcare");
  console.log(`Original: ${prompt}`);
  console.log(`Updated:  ${result}`);
  console.log(`Changed:  ${prompt !== result}`);
  console.log('---');
});
```

### 8. Next Steps

1. **Try the update again** with console open to see the debug output
2. **Share the console logs** if errors persist
3. **Check the database** manually to confirm what's happening
4. **Test the utility functions** in isolation to verify pattern matching

The enhanced version should provide much clearer insight into where the process is failing!
