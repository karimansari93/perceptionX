# Ask PerceptionX from your AI assistant

Customer-facing setup guide copy. Plain text, sectioned so it can be laid out in a design tool. Bracketed lines are notes to the designer, not copy.

---

## Cover

**Ask PerceptionX from your AI assistant**

Your employer brand data, in the chat window you already use.

[Sub-line]
PerceptionX now connects to AI assistants. Ask a question in plain English and get an answer built from your own dashboard data, with links to the pages the AI models are actually citing.

---

## What you get

Once connected, you can ask your assistant things like:

- Why did our score dip versus last quarter?
- What changed on wellbeing, and which sources are behind it?
- How do we compare to our competitors on flexibility in Germany?
- Which Glassdoor pages come up most, with links?
- Show visibility by job function.
- Draft a job description that leans into what AI already says about us.

Every answer comes from your PerceptionX data. Nothing is made up, and when something isn't tracked the assistant says so.

---

## Before you start

You need three things.

1. **A PerceptionX login.** The same email and password you use for the dashboard.
2. **A paid plan on your AI assistant.** Custom connectors are a paid feature on all the major assistants. Free tiers can't add them.
3. **Five minutes.** Setup is a one-time job.

Good to know:

- **Read-only.** The connector can read your data. It can't change anything in PerceptionX.
- **Your organisation only.** The connector only ever sees the organisation you approve. There is no cross-customer data.
- **You're in control.** You can disconnect from your assistant's settings at any time, and we can revoke access on our side on request.

The connector address you'll need in every case:

`https://app.perceptionx.ai/mcp`

---

## Set up in ChatGPT

[Menu names shift a little between ChatGPT releases. If a label looks different, look for "Connectors" and "Developer mode".]

1. Open **Settings**, then **Connectors** (in some versions, **Apps & Connectors**).
2. Go to **Advanced** and switch on **Developer mode**.
3. Back on the Connectors page, choose **Create** (or **Add custom connector**).
4. Fill in:
   - Name: **PerceptionX**
   - URL: `https://app.perceptionx.ai/mcp`
   - Authentication: **OAuth**
5. Choose **Create**. ChatGPT opens a PerceptionX sign-in page.
6. Sign in with your PerceptionX login. If you belong to more than one organisation, pick the one you want to connect. Choose **Allow access**.
7. You're back in ChatGPT with PerceptionX listed as a connector.

To use it in a chat: start a new chat, open the **+** (or tools) menu, and turn on **PerceptionX**. Then ask your question.

[Team and Enterprise workspaces: an admin may need to enable Developer mode, or can add the connector once and share it with the workspace.]

---

## Set up in Claude

1. Open **Settings**, then **Connectors**.
2. Choose **Add custom connector**.
3. Fill in:
   - Name: **PerceptionX**
   - URL: `https://app.perceptionx.ai/mcp`
4. Choose **Add**, then **Connect**. Claude opens a PerceptionX sign-in page.
5. Sign in with your PerceptionX login. If you belong to more than one organisation, pick the one you want to connect. Choose **Allow access**.
6. You're back in Claude with PerceptionX showing as connected.

To use it in a chat: open the tools menu at the bottom of the message box and make sure **PerceptionX** is switched on. Then ask your question.

[Team and Enterprise plans: an owner can add the connector for the whole organisation, and each person then connects with their own PerceptionX login.]

---

## Other assistants

Gemini and Microsoft Copilot don't yet let individual users add a custom connector. If your company runs an enterprise version that supports custom MCP connectors, your IT team can add PerceptionX with the same address. Get in touch and we'll walk them through it.

---

## Asking good questions

The assistant answers from the same numbers as your dashboard. A few habits get better answers.

- **Name the market.** "In Germany" or "for India" scopes the answer to that market. Otherwise you get the brand-wide view.
- **Name the job function.** "For engineers" or "in finance roles" filters to the answers AI gives candidates in those roles. Ask for "by job function" to see the split.
- **Compare quarters, not months.** PerceptionX measures in waves, usually one per quarter. Ask "versus last quarter" rather than "in March".
- **Ask for links.** "Which pages are behind this, with links?" returns the actual pages AI is citing, not just the site.
- **Ask for the why.** "What's driving the change?" pulls themes, sources and competitors together.

Numbers are shares of answers. "Cited by 31% of answers" means 31% of the AI answers PerceptionX measured mentioned that source. Changes are in percentage points against the previous quarter.

---

## Troubleshooting

**The sign-in page says the request is no longer valid.**
Start again from your assistant. The sign-in link only lives for a few minutes.

**I don't see my organisation on the sign-in page.**
Your PerceptionX account isn't a member of it yet. Ask your PerceptionX admin to add you, or contact us.

**The connector is there but the assistant says it has no tools.**
Remove the connector and add it again. The assistant only reads the tool list when it first connects.

**The assistant answers from general knowledge instead of our data.**
Check that PerceptionX is switched on for that chat, and ask it to "use PerceptionX" in the question.

**Something else.**
Email team@perceptionx.ai and tell us which assistant you're using.

---

## Privacy in one paragraph

The connector uses the same login and the same permissions as the PerceptionX dashboard. It reads only the organisation you approve, it can't write or delete anything, and every request is logged. Your assistant sees the answers to the questions you ask it and nothing else. Disconnect from your assistant's settings at any time.
