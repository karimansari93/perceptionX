# Admin Panel - Refresh Functionality Guide

## Where to Find the Refresh Features

The admin panel now has **refresh functionality in BOTH views**:

### 1. Organizations View (Default View)
**Location:** Admin Panel → Default tab you see when you open it

**What you can do:**
- Click the **"Refresh" button** next to each company
- This opens a modal where you can select:
  - ✅ Which LLM models to use (3 for Free, 6 for Pro users)
  - ✅ Which prompt types to process (sentiment, competitive, visibility, etc.)
  - ✅ See total operations count before confirming

**How it works:**
1. Find the organization you want to refresh
2. Click the **"Refresh"** button next to any company in that organization
3. Select which LLM models you want to refresh
4. Select which prompt types you want to process
5. Click **"Start Refresh"**
6. A progress modal shows the current status

### 2. Users View
**Location:** Admin Panel → Click "Users" at the top (next to "Organizations")

**What you can do:**
- Click **"Refresh All Models"** or **"Refresh Models"** for each user
- Same modal experience as the Organizations view
- Refreshes ALL companies for that user

**How it works:**
1. Switch to the "Users" tab at the top
2. Find the user you want to refresh
3. Click the **"Refresh All Models"** button (or "Refresh Models" for free users)
4. Select LLM models and prompt types
5. Click **"Start Refresh"**
6. Progress modal shows status

## LLM Models Available

### Free Plan (3 models)
- ✅ OpenAI (ChatGPT)
- ✅ Perplexity
- ✅ Google AI Overviews

### Pro Plan (6 models)
- ✅ OpenAI (ChatGPT)
- ✅ Perplexity
- ✅ Gemini
- ✅ DeepSeek
- ✅ Google AI Overviews
- ✅ Claude

## Prompt Types You Can Select

- **sentiment** - Sentiment analysis prompts
- **competitive** - Competitive positioning prompts
- **visibility** - Brand visibility prompts
- **talentx_sentiment** - TalentX sentiment prompts (Pro only)
- **talentx_competitive** - TalentX competitive prompts (Pro only)
- **talentx_visibility** - TalentX visibility prompts (Pro only)

## The Refresh Modal

When you click refresh, you'll see:

```
┌─────────────────────────────────────┐
│ Confirm Refresh                      │
├─────────────────────────────────────┤
│ User: user@example.com               │
│ Plan: Pro (6 models available)       │
│                                      │
│ Select Models:                       │
│ ☑ OpenAI                             │
│ ☑ Perplexity                         │
│ ☑ Gemini                             │
│ ☑ DeepSeek                           │
│ ☑ Google AI Overviews                │
│ ☑ Claude                             │
│                                      │
│ Select Prompt Types:                 │
│ ☑ sentiment                          │
│ ☑ competitive                        │
│ ☑ visibility                         │
│ ☑ talentx_sentiment                  │
│ ☑ talentx_competitive                │
│ ☑ talentx_visibility                 │
│                                      │
│ Total Operations: 36                 │
│ (6 prompts × 6 models)               │
│                                      │
│ [Cancel] [Start Refresh]             │
└─────────────────────────────────────┘
```

## Progress Modal

While refreshing, you'll see real-time progress:

```
┌─────────────────────────────────────┐
│ Refreshing Models                    │
├─────────────────────────────────────┤
│ User: user@example.com               │
│                                      │
│ Progress:                            │
│ 12 / 36 ████████░░░░░░░░ 33%        │
│                                      │
│ Current Model: Gemini                │
│ Prompt Type: Regular                 │
│ Current Prompt:                      │
│ How is [Company] perceived in        │
│ the [Industry] market?               │
│                                      │
│ Remaining: 24 operations             │
└─────────────────────────────────────┘
```

## Tips

1. **Start Small:** When testing, uncheck some models to reduce the number of operations
2. **Select Specific Types:** You don't have to refresh all prompt types - just select the ones you need
3. **Monitor Progress:** The modal shows you exactly what's happening in real-time
4. **One at a Time:** Only one refresh can run at a time to avoid API rate limits

## Recent Changes

✅ **Organizations view now has Refresh button** (previously only in Users view)  
✅ **Per-company refresh** available in Organizations view  
✅ **Same selection modal** for both views  
✅ **Real-time progress tracking** for all refreshes  

---

**Last Updated:** January 14, 2025



