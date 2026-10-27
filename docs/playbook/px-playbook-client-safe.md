# PerceptionX playbook (client-safe)

As of 27 October 2026. Source text for `get_playbook`. Each `## topic:` block is one topic the tool returns verbatim. Contains no client names, no client data and no cross-client figures. External facts carry their source and date; anything marked "check before acting" changes often (laws, platform features, list deadlines).

## topic: prioritise
**Where the score can move.** The Employer Perception Score (EPS) = 50% Sentiment + 30% Visibility + 20% Relevance. The points left in each pillar are (100 minus the pillar) times its weight. Sentiment usually holds about half of the gap. 100 is never a realistic target: it would mean no negative opinion anywhere, being named in every open job search in every market, and only current sources.
- **Visibility** moves only in open job searches (questions that never name an employer). Questions about the employer name it by construction.
- **Relevance** responds fastest to the employer's own pages: new or migrated career pages can be read within a quarter, and retiring stale pages removes old stories.
- **Sentiment** is where most of the gap is, and most of it sits in what employees and candidates write on review sites.

**Rank work by what is at stake.** Look at which topics hold the largest share of the employer's negative opinions, not only which are loudest. Check the candidate experience topics (Application & Communication, Candidate Feedback, Interview Experience, Onboarding) together across markets even when each is small in one market, then split them again by topic and market. Rank each possible action by the share of negatives it targets, how much of it the employer controls (its own pages and profiles: high; needs recruiting systems, web or communications: medium; depends on what people write or on a business change: low) and how fast AI picks up a change (within a quarter, two quarters, longer).

**How to state impact.** On the topic and market an action targets (for example "opinions on applying are X% positive where AI reads none of the employer's pages, Y% where it reads them", with X and Y from the tools), never as a fraction of a point of the overall score. Separate the realistic outcome (back to last quarter's level) from a ceiling (matching the employer's other topics).

## topic: diagnose
Run four questions before recommending anything for a weak topic.
1. **What does AI say?** Read the example themes and answers for the negative and positive opinions (get_attribute_themes, get_responses). Put the complaint in one plain sentence, and note what AI praises.
2. **Where does AI read it?** Which sources and pages are cited in the negative answers, compared with the positive ones (get_attribute_themes, get_sources, get_citations). Note whether the employer's own pages are cited in the same answers and whether they say anything on the topic. Look for the employer's own copy that states the complaint: a posting line such as "only those selected for an interview will be contacted" is read by AI as the employer's policy.
3. **What is true about the employer?** Awards and certifications, published policies and programmes, legal duties already in force, process pages. A strong true fact AI does not see is often the best first move.
4. **What are the moves, and who owns each?**
   - Own pages: publish the missing facts on the exact page AI already reads, in the right place (topic: job_posting).
   - Process: when the complaint describes a real practice (silence, no feedback, long waits), the fix sits with talent acquisition. Say so conditionally: "If every interviewed candidate already hears an outcome, say so on the page; if not, that is the change that improves what candidates write."
   - Review profiles: claim and complete the profiles AI reads; new reviews from everyone at fixed moments.
   - Lists and newsrooms: lists the employer can enter, and its own awards announced on its own pages.
   - Business: when AI accurately relays a real experience (job cuts, leadership), say content will not move it.

Worked pattern, candidate feedback: the employer's own content gives it a share of the story (a hiring-process block, the FAQ, its awards), but the topic moves only when candidates write better things, which needs the process fixed and then everyone invited to share their experience at the decision moment.

## topic: who_owns
| Team | Owns | Can change in days to weeks | Needs others |
|---|---|---|---|
| Employer brand | Careers content, review profiles, social | Profile content, careers stories, FAQ copy (through web), list entries | Posting templates, site templates, legal claims |
| Talent acquisition | How candidates are handled, rejection calls, feedback | Recruiter follow-up, team response times | System defaults, feedback policy, hiring manager behaviour |
| Recruiting systems (TA operations) | Applicant tracking system templates, statuses, triggers, surveys | Email wording, delays, candidate-facing status labels, auto-decline on closed requisitions | Vendor changes, new modules |
| Web / digital | Careers site and templates | Copy within existing templates | New template sections |
| Corporate communications | Newsroom | Posts within its approval chain | Executive and legal approval |
| HR policy, legal, privacy | Recruitment policy, feedback stance, privacy notices | Approve or block | Works councils, global rollout |
| Local market HR | Local practice, local profiles | Local communications and profile content | Global system changes |

Typical approval paths: posting template, recruiting systems plus employer brand plus legal, weeks. Careers page, employer brand drafts and web publishes, days to weeks. Candidate emails, recruiting systems drafts and leadership and privacy approve, two to six weeks. Prefer levers a central team already runs (a template, the FAQ, an email the system already sends) over asking every market to build something.

## topic: career_site
What strong career sites publish, by the question candidates ask. Every answer as visible text on a crawlable page; video and images support it, never replace it.
| Candidate question | What to publish | Where |
|---|---|---|
| What is it like? | Plain employer value proposition, values with examples, named employee stories with role and location | Function and team pages |
| Pay and benefits | How pay ranges and progression are set; ranges on every job; benefits by country in HTML | Country benefits pages, every posting |
| How does hiring work, how long? | Each stage, number and format of interviews, typical time per stage, variants by job family | How-we-hire page, FAQ, block on every posting |
| Will I hear back? Feedback? | Response commitment, what happens if unsuccessful, feedback policy, contact route | FAQ, process page, posting block |
| Interview preparation | Formats, what is assessed, adjustments, acceptable AI use by candidates | Prep guide |
| Career growth | Progression frameworks, internal moves, real career stories | Career paths page |
| Flexibility and location | Work model by role and country | Policy page, a line on every job |
| Inclusion | Programmes, networks, accessibility, links to pay gap reports | A current page on the careers site, not an old report |
| Job security and stability | Dated company facts; a statement that advertised roles are real vacancies | Facts page, posting line |
| Onboarding | Week one, first 90 days, contact before day one | Onboarding page, FAQ |
| Countries and sites | One local-language page per major country | Country pages |
| Early careers | Eligibility, application windows, assessment dates, pay | Programme pages |

Context: in the 2025 CandE benchmark (Survale, 66,000+ candidates), career sites were candidates' top research channel and "application process and next steps" was among the most valued job content.

Career site checklist: how-we-hire page with stages and timing; response and feedback commitment; interview prep; pay philosophy; country benefits in HTML; work model; named stories; career paths; country pages in the local language; early careers dates; onboarding; visible "last updated" dates; staging and test sites not indexed; expired jobs removed.

## topic: job_posting
**Where a block goes.** Example: a hiring-process block for postings that have Overview, Responsibilities, Culture and Benefits sections and nothing on stages, response times or feedback.
1. A template section on every careers-site posting, next to the existing template sections, added to the in-page navigation, as normal page text. Written once, it appears on every job. Put it after the requirements, near the second Apply button.
2. Two to four lines in the job description's closing block, where pay, visa and equal opportunity lines already sit. Only the job description text travels to LinkedIn, Indeed and Google for Jobs; careers-site template sections do not.
3. The full answers in the FAQ, which both link to.
Rule: if it matters off the careers site, it goes in the description. Hourly and salaried roles often need different versions. Replace any standard line that states the complaint ("only those selected for an interview will be contacted", "we cannot reply to every application") with what the employer does.

**What a strong posting contains:** pay range (and bonus structure), benefits summary, location and work model, the hiring-process lines (stages, typical timing, when the candidate hears back, feedback policy), adjustments contact, inclusion line, and where required by law an existing-vacancy line and a note on AI use in screening.

## topic: ai_readability
- ChatGPT, Claude and Perplexity fetchers do not run JavaScript; Gemini does (Vercel and MERJ study, December 2024; re-tested October 2026). Text in the page's HTML is read even inside a collapsed tab; text loaded on click or built in the browser is not.
- robots.txt should allow the AI search and user fetchers (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot) plus Googlebot and Bingbot on the careers site and the applicant tracking system's domain. Blocking training bots (GPTBot, ClaudeBot, Google-Extended) is a policy choice and does not remove the site from answers. CDN and firewall bot settings matter too.
- Staging and QA sites, test job listings and expired jobs get indexed and read. Lock or remove them.
- Keep FAQs as visible question-and-answer text. llms.txt has no effect on any major assistant today.
- Publish HTML versions of benefits guides, not only PDFs. Show a visible "last updated" date on process and benefits pages.
- JobPosting structured data with salary and closing date, matching the visible text.

## topic: pay_transparency
Check before acting: laws change.
- **EU Pay Transparency Directive (2023/970):** pay or range to applicants in the ad or before interview, no pay-history questions, gender-neutral ads. Transposition was due 7 June 2026. In force as of October 2026: Italy, Lithuania, Malta, Slovakia, Greece (from 1 November 2026); Poland's recruitment rules since 24 December 2025. Not yet in force: Germany, France, Spain, Belgium, Netherlands, Ireland; Hungary and Romania pending.
- **US:** pay ranges required in postings in Colorado, California, Washington, New York State and City, Hawaii, DC, Maryland, Illinois, Minnesota, New Jersey, Vermont, Massachusetts, Cleveland, Virginia (from 1 July 2026), Maine (from 29 July 2026), Connecticut (from 1 October 2026); several also require benefits.
- **Canada:** British Columbia since 1 November 2023. Ontario since 1 January 2026 for employers with 25 or more employees there: pay or range, whether the vacancy exists, AI use in screening, no Canadian-experience requirement, and candidates interviewed for an advertised job must be told within 45 days of their last interview whether a decision has been made (Osler, December 2025).
- **UK:** no duty yet (consultation closed 27 October 2026). **Australia:** no duty to state pay.

## topic: candidate_experience
**What candidates complain about.** Silence (no reply, no follow-up) and no feedback after interview or rejection. In the 2025 CandE benchmark (Survale): 31% of North American candidates had not heard back one to two months after applying; 56% of rejected candidates got no feedback; a third of rejections came from a do-not-reply address. Glassdoor (October 2024): interview reviews that mention ghosting are 87% negative, against 18% of all interview reviews. Causes: no decision deadline, legal caution on feedback, system defaults that allow silence. Voluntary reviewers over-represent extreme views; the ghosted write, the satisfied rarely do.

**Why an employer can win a candidate experience award and still read badly in AI.** Award surveys reach candidates through the employer's own channel, usually at the decision; candidates who never get a decision are never surveyed. Review pages pool years and countries. The move is to fix the silent tail, invite everyone at the decision moment, and publish the award where AI reads.

**What top performers do.** A decision deadline for every applicant and an automatic close-out when a role is filled; rejections from an address candidates can reply to; short job-fit feedback to finalists within one to two weeks; stated timelines that are kept; clear candidate-facing status labels; a short survey after hire or rejection.

**Levers in common applicant tracking systems (vendor documentation).** Oracle Recruiting Cloud: notifications when an application reaches a status; replies to a named sender route to the recruiter. Workday: notifications on any step, bulk-decline on closed requisitions, candidate status page. SAP SuccessFactors: emails linked to statuses, candidate labels and next-step text. Greenhouse: scheduled rejection emails, built-in survey. iCIMS: candidate-facing labels per status. Questions for the recruiting systems team: how many applications are open more than 30 days with no decision, how often rejections go without an email, which address rejections come from, and what each candidate-facing status says.

**CandE awards** are run by Survale (since April 2025); candidates are surveyed January to August and winners announced in September; at least 80% of respondents must be candidates who were not hired. Winners: survale.com/cande-award-winners. Name the years won; never present an earlier win as current.

**Inviting reviews.** Invite everyone at a fixed moment (for example everyone who interviewed, hired or not, a few days after the decision; new hires at about 90 days), never only people expected to be happy, never with incentives, never asking for proof. Prefer a link in emails the employer already sends.

## topic: lists_awards
AI builds open-search shortlists from list pages, press coverage of lists and employers' own newsroom posts about awards. The employer's newsroom and careers pages carry its awards into answers when they name the list, the year and the publisher in text, not only as a badge. Awards fade after about a year.
| Route | Lists | What to do |
|---|---|---|
| Enterable | Great Place to Work (certification, then considered for its lists for 12 months), Top Employers Institute, Canada's Top 100 Employers, CandE, AHRI (Australia), Súper Empresas (Mexico) | Enter, working back from the next deadline (check the publisher's page) |
| Calculated from reviews | kununu Top Company (score 3.8+, 7+ reviews, 2+ new in 12 months; applicant reviews excluded), Glassdoor Best Places to Work, Undelucram, AmbitionBox awards | Review volume and recency |
| No entry route | Merco Talento, Randstad Employer Brand Research, Forbes and Statista, LinkedIn Top Companies, Universum, hipo.ro | Not an action |
Deadlines change: always open the publisher's page before giving a date.

## topic: levers
Levers that change what AI reads, with when each fits and how it fails.
1. **Country pages on the careers site.** Fits when AI answers a market from corporate or third-party pages. Fails when a market has no appetite for one; prefer central levers.
2. **Hiring block on postings and the FAQ.** Fits applying and onboarding. A page can be read more while the topic still falls, because it does not answer the question.
3. **Process fix in talent acquisition.** Fits silence and no feedback. The lever that changes what candidates write.
4. **Claim and complete review profiles.** Fits unclaimed, out-of-date or wrong-entity profiles and duplicate pages. Changes facts, not review text.
5. **New reviews at fixed moments.** Fits when most negatives sit in answers citing review profiles. Tie invitations to emails the employer already sends (interview decision, first day, work anniversary, leaving). PerceptionX Amplify supports this.
6. **Retire stale sources.** Old reports, fading corporate pages, old blog posts, staging sites: redirect, noindex, replace with a current page.
7. **Publish true facts AI misses.** Awards, certifications, legal duties already met, programmes.
8. **Rewrite own copy that states the complaint.**
9. **Lists and newsrooms.** For open-search visibility.
10. **Business changes.** Job security or leadership driven by real events: content will not move them.
Not recommended on their own: replying to reviews (no platform says it changes the rating); generic advice ("grow employee voices", "build presence", "create more content"); asking only happy people; incentives; asking for compliant negative reviews to be removed; llms.txt.

## topic: review_platforms
Rules on every major platform: invite everyone at a fixed moment, never only people likely to be happy; no incentives, pressure or proof requests; compliant negative reviews stay up; responding is free but does not change ratings; the newest reviews are what candidates and AI see first. For interview reviews, invite everyone who reached interview, hired or not. Check before acting: features change.

**Glassdoor** (part of Indeed since 1 July 2026). Free employer account: edit company details, logo, leadership and inclusion content, post updates, respond to and flag reviews, send review requests by email or a shareable link. Paid Enhanced Profile: country profiles, a featured review, rating trends, competitor reports. Removal only for guideline breaches; age is not a reason. A country profile can sit unclaimed while the global profile is managed.

**Indeed.** Company Page created when jobs post; the account owner claims it (24 to 48 working hours). Free: description, logo, a "Why join us" section with up to ten pieces of content, responses. Removal only for guideline breaches. Duplicate company pages in one market are common.

**kununu** (Germany, Austria, Switzerland). Claim with a company email; free profile can comment; paid branding profiles from about €124 to €499 a month. Encourages invitations with neutral wording and an applicant-review link that can sit in rejection emails; bans inviting only groups expected to be positive. Since 1 September 2026 the score is a recency-weighted average of employee reviews only; applicant reviews stay visible but do not count. Large employers often have several profiles (legal entities, sites).

**AmbitionBox** (India). Claim with an official email. Responses are moderated. Invitations encouraged, no incentives. The rating is a simple all-time average. AI can read a former or sister entity's profile.

**Seek and Jobstreet.** Free company profile; admins edit overview, culture, perks and awards and can reply where the market allows. Newest reviews first and an AI summary of recent reviews. Out-of-date About text is common and fixable.

**LinkedIn.** No reviews; AI reads company pages, posts and job pages (job pages carry only the job description text).

**Smaller sites.** Undelucram (Romania): employers can reply through a verified account; several profiles per employer are common. WhereWeWork (Hungary): profiles may sit unclaimed. profession.hu (Hungary): company pages with reviews; a missing employer description is fixable. Comparably (US), Computrabajo, Infojobs, StepStone: check the platform's employer pages before advising.

**Law.** US FTC rule on reviews (October 2024) bans sentiment-linked incentives and suppression; UK fake-review rules (April 2025) treat encouraging only the satisfied as cherry-picking; EU unfair-practice rules ban commissioned reviews; under GDPR, prefer a link in existing emails to uploading email lists to a platform.

## topic: writing_recommendations
When recommending an action: give the move, the exact page and where on the page it goes (and whether it must also sit in the job description), why in the employer's own figures with a comparison, what is true about the employer that it uses, and which team owns it. Write changes owned by another team conditionally. State impact on the targeted topic and market. Do not give timing (the employer decides) or invent figures; if a figure is not in the tools, say it is not measured.
