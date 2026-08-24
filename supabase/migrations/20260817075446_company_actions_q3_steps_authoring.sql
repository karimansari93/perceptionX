-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260817075446; this file was
-- back-filled afterwards and therefore post-dates the deployment.

UPDATE public.company_actions ca
SET steps = v.steps::jsonb, updated_at = now()
FROM (VALUES
('kununu-germany-claim', '[
 {"label":"Claim the employer profile on kununu","url":"https://www.kununu.com/de/netflix-services-germany"},
 {"label":"Reply in German to the cited reviews on Wellbeing and Job Security","url":"https://www.kununu.com/de/netflix-services-germany/kommentare"},
 {"label":"Name a monthly response owner","url":null}
]'),
('note-com-japan-publish', '[
 {"label":"Reactivate the existing Netflix note.com account","url":null},
 {"label":"Review the third-party accounts AI cites today for the topics to cover","url":"https://note.com/pincheenano"},
 {"label":"Publish the first Japanese-language piece — a Tokyo engineering team profile","url":null},
 {"label":"Set a monthly publishing cadence: careers, culture, hiring posts","url":null}
]'),
('naver-korean-content', '[
 {"label":"Review the legacy blog posts AI still cites for the topics that need replacing","url":"https://blog.naver.com/smartincome12"},
 {"label":"Commission Korean-language employer content — engineering and content-team stories","url":null},
 {"label":"Publish across the Naver ecosystem (first-party or partnered), on a cadence","url":null}
]'),
('reddit-authentic-participation', '[
 {"label":"Identify engineering leaders and recruiters willing to participate under their own names","url":null},
 {"label":"Set disclosure and participation guidelines — no incentives, no coordinated posting","url":null},
 {"label":"Answer the PIP and Keeper Test questions openly in r/cscareerquestions (AMA-style)","url":null},
 {"label":"Respond with factual corrections in the cited r/recruitinghell interview threads","url":null}
]'),
('culture-polarity-owned-content', '[
 {"label":"Draft a first-party explainer: how performance management actually works, Keeper Test included","url":null},
 {"label":"Write it for the audiences carrying the concern — Legal and Talent & HR, not engineering","url":null},
 {"label":"Publish on the culture page AI already reads","url":"https://jobs.netflix.com/culture"},
 {"label":"Syndicate through LinkedIn and WeAreNetflix","url":null}
]'),
('linkedin-listings-employee-posting', '[
 {"label":"Audit listing currency in India, Indonesia, Netherlands and the UK","url":null},
 {"label":"Close stale postings; refresh and complete live ones","url":null},
 {"label":"Enable and encourage employee posting under their own names","url":null},
 {"label":"Brief the four market TA teams on the cadence","url":null}
]'),
('instagram-owned-brazil-argentina', '[
 {"label":"Stand up an employer-brand content stream on the owned LATAM Instagram surfaces","url":null},
 {"label":"Publish team, office and career moments in Portuguese and Spanish — not title marketing","url":null},
 {"label":"Amplify earned creator coverage like the cited reels","url":"https://www.instagram.com/reel/DNy70f30kr1"}
]'),
('facebook-owned-thailand-philippines', '[
 {"label":"Establish owned employer pages for Thailand and the Philippines","url":null},
 {"label":"Publish local-language career and team content on a cadence","url":null},
 {"label":"Engage the cited community groups where the narrative currently forms","url":"https://www.facebook.com/groups/NextUpAsia"}
]'),
('function-positioning-plays', '[
 {"label":"US: creative-cultural impact and DTC scale vs Apple — both tech and content audiences","url":null},
 {"label":"Philippines: global content scale vs the broadcasters; tech-employer story where locals are weakest","url":null},
 {"label":"South Korea: global distribution vs CJ ENM; platform-scale engineering vs Naver","url":null},
 {"label":"Netherlands: content-platform-scale engineering plus candor on work-life reality","url":null}
]'),
('builtin-profile-completeness', '[
 {"label":"Audit Built In profile completeness against comparable tech employers","url":"https://builtin.com"},
 {"label":"Fill the gaps in underperforming markets","url":null},
 {"label":"Re-check capture at the Q4 review","url":null}
]'),
('tryexponent-interview-narrative', '[
 {"label":"Review how Exponent currently frames the Netflix interview","url":"https://tryexponent.com"},
 {"label":"No action this quarter — monitor at the Q4 review","url":null}
]'),
('youtube-brazil-employer-video', '[
 {"label":"Commission a Portuguese-language employer video series — engineering profiles, production stories, career paths","url":null},
 {"label":"Publish on Netflix-owned channels so the citation graph has first-party video to weigh","url":null},
 {"label":"Run it as a series on a cadence, not a one-off","url":null}
]'),
('glassdoor-es-pt-response-programme', '[
 {"label":"Claim or verify employer access on the three local-language Glassdoor domains","url":null},
 {"label":"Respond in Spanish to the Wellbeing and Job Security threads on the Mexican reviews page","url":"https://www.glassdoor.com.mx/Evaluaciones/Netflix-Evaluaciones-E11891.htm"},
 {"label":"Respond in Portuguese on the Brazilian reviews page","url":"https://www.glassdoor.com.br/Avalia%C3%A7%C3%B5es/Netflix-Avalia%C3%A7%C3%B5es-E11891.htm"},
 {"label":"Respond in Spanish on the Argentine reviews page","url":"https://www.glassdoor.com.ar/Evaluaciones/Netflix-Evaluaciones-E11891.htm"},
 {"label":"Encourage balanced reviews from LATAM-based employees","url":null}
]'),
('glassdoor-us-response-programme', '[
 {"label":"Launch company responses on the Job Security and High Performance review threads","url":"https://www.glassdoor.com/Reviews/Netflix-Reviews-E11891.htm"},
 {"label":"Write responses for the Legal and Talent & HR audiences where the concern concentrates","url":null},
 {"label":"Monitor the interview-questions page AI also cites","url":"https://www.glassdoor.com/Interview/Netflix-Interview-Questions-E11891.htm"},
 {"label":"Encourage balanced reviews from current employees","url":null}
]'),
('wearenetflix-us-employer-video', '[
 {"label":"Structure episodes around the questions candidates actually ask AI — what is it like, how do I interview, how does the Keeper Test work","url":null},
 {"label":"Publish through the existing WeAreNetflix YouTube machine","url":null},
 {"label":"Use question-shaped titles and descriptions so the answers are indexable","url":null}
]'),
('youtube-japan-employer-video', '[
 {"label":"Produce Japanese-language employer video through the WeAreNetflix machine — engineering and production stories","url":null},
 {"label":"Include a direct interview-process explainer — the specific damage video can repair","url":null},
 {"label":"Publish on the owned channel with Japanese titles and descriptions","url":null}
]'),
('gowork-poland-claim', '[
 {"label":"Claim the GoWork.pl employer profile","url":null},
 {"label":"Respond in Polish to the cited opinion thread","url":"https://www.gowork.pl/opinie_czytaj,24906273"},
 {"label":"Encourage balanced reviews from Warsaw-based employees","url":null}
]'),
('levels-fyi-salary-currency', '[
 {"label":"Verify the Warsaw software-engineer bands on the cited page are current","url":"https://www.levels.fyi/pl-pl/companies/netflix/salaries/software-engineer/locations/poland"},
 {"label":"Verify the Berlin bands on the cited page","url":"https://www.levels.fyi/companies/netflix/salaries/software-engineer/locations/germany"},
 {"label":"Correct any stale bands through levels.fyi employer channels","url":null}
]'),
('prosple-philippines-profiles', '[
 {"label":"Claim the Prosple Philippines employer profile","url":"https://ph.prosple.com"},
 {"label":"Complete the profile — roles, culture content, early-careers detail","url":null},
 {"label":"Review presence at Q4","url":null}
]')
) AS v(key, steps)
WHERE ca.key = v.key;
