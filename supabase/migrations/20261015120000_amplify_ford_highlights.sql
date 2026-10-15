-- Ford Amplify: a specific page on every card, from the October collection.
--
-- The Ford "Global" link (ford.perceptionx.ai/brwpxu) covers all 18 markets,
-- but only six had a highlight, and every Reddit card in the other twelve
-- opened r/Ford's front page. TikTok cards opened tiktok.com, and the global
-- default (tier 3) opened reddit.com and linkedin.com. This seeds the page AI
-- actually cites for each market x platform card, so a recipient lands on
-- the thread or post itself.
--
-- Source: collection_cycle 2026-10-01 (27,610 Ford answers, 2026-10-03 to
-- 2026-10-05). `citations` = answers in that market citing the page.
-- Floor: 3 answers. Where October has no page above the floor, the July
-- cycle is used (AU Reddit and Quora, VE Quora; DE Reddit keeps its July row).
--
-- Curation rules, applied by hand:
--   * Forum ("Answer this"): the most-cited thread or question.
--   * Social ("Most cited"): the most-cited page about working at Ford.
--     Skipped: politicians' posts, car sales and market news, dealers,
--     competitor pages, personal LinkedIn profiles, job ads (they expire).
--     Markets with nothing that qualifies keep the bare card: Facebook in
--     AU, ES, PE; Instagram in BR, CL, IN, VE; LinkedIn in RO.
--   * Review platforms: candidates get the interview page (as Thermo
--     Fisher's do, 20261014120000). Where Ford Credit's page outranks Ford
--     Motor Company's (BE, DE, HU), the Ford Motor Company page is used,
--     since highlights cannot be scoped to an entity.
--
-- Reddit could not be opened from the build session, so whether each thread
-- still takes replies is unchecked. Threads older than six months may be
-- archived in subreddits that archive.
--
-- Backup of the eight Ford highlights before this migration: all were
-- general (audience/job_functions NULL), rank 1, citations from July:
-- US/GB/IN/DE/BR reddit r/Ford 1ndhvti (74/44/59/5/7), RO reddit r/Romania
-- zqinqg (10), US quora corporate culture (52), IN quora interview (77).

do $$
declare
  v_org uuid := '0af791f6-db6e-4063-95c4-71cd31f8779a';
  rf text := 'https://www.reddit.com/r/Ford/comments/1ndhvti/whats_it_like_working_at_ford/';
  rf_label text := '“What''s it like working at Ford” on r/Ford';
  lc text := 'https://www.reddit.com/r/lacamiseta/comments/1fjyz1e/trabajar_en_la_ford/';
  lc_label text := '“Trabajar en la Ford” on r/lacamiseta';
  qc text := 'https://www.quora.com/What-is-the-corporate-culture-like-at-Ford-How-is-the-culture-different-than-other-companies';
  qc_label text := '“What is the corporate culture like at Ford?”';
  tt_practicas text := 'https://www.tiktok.com/@firstjobme/video/7535947895070035206';
  tt_practicas_label text := '“Prácticas en Ford: experiencias y beneficios”';
  fb_app text := 'https://www.facebook.com/FordMotorCompanyCareers/videos/ford-application-process/1407224609453197';
  fb_app_label text := 'Ford application process (Ford Careers video)';
  fb_valores text := 'https://www.facebook.com/lanacion/videos/en-ford-combinamos-los-valores-culturales-de-una-empresa-que-opera-hace-113-a%C3%B1os/3377498435752274';
  fb_valores_label text := '“En Ford combinamos los valores culturales…” (La Nación video)';
  ig_talento text := 'https://www.instagram.com/reel/DMf0hu4usoG';
  ig_talento_label text := 'Talento Ford México reel';
  li_wcm text := 'https://www.linkedin.com/company/ford-wcm';
  li_wcm_label text := 'Ford Chile, Colombia, Perú y Venezuela on LinkedIn';
  li_newhire text := 'https://www.linkedin.com/pulse/fords-new-hire-experience-gets-tech-boost-collaboration-8r6qc';
  li_newhire_label text := '“Ford''s new hire experience gets tech boost”';
  gd_fmc text := 'https://www.glassdoor.com/Interview/Ford-Motor-Company-Interview-Questions-E263.htm';
  gd_ar text := 'https://www.glassdoor.com.ar/Entrevista/Ford-Motor-Company-Preguntas-entrevistas-E263.htm';
  in_fmc text := 'https://www.indeed.com/cmp/Ford-Motor-Company/interviews';
  gd_label text := 'Ford interview reviews';
  in_label text := 'Ford interview reviews';
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise notice 'Ford org % not found; skipping', v_org;
    return;
  end if;

  insert into public.activate_route_highlights
    (org_id, market_code, platform, url, label, citations, rank, audience)
  values
    -- Reddit
    (v_org,'AR','reddit','https://www.reddit.com/r/empleos_AR/comments/1mcbhfd/esperando_el_llamado_de_la_f%C3%A1brica_de_ford/',
     '“Esperando el llamado de la fábrica de Ford” on r/empleos_AR',48,1,null),
    (v_org,'AU','reddit',rf,rf_label,31,1,null),
    (v_org,'BE','reddit',rf,rf_label,7,1,null),
    (v_org,'CA','reddit',rf,rf_label,47,1,null),
    (v_org,'CL','reddit',lc,lc_label,14,1,null),
    (v_org,'CO','reddit',lc,lc_label,12,1,null),
    (v_org,'ES','reddit',lc,lc_label,6,1,null),
    (v_org,'GB','reddit',rf,rf_label,9,1,null),
    (v_org,'HU','reddit','https://www.reddit.com/r/jobshungary/comments/1pkqowr/ford_magyarorsz%C3%A1gn%C3%A1l_dolgozik_valaki/',
     '“Ford Magyarországnál dolgozik valaki?” on r/jobshungary',82,1,null),
    (v_org,'IN','reddit','https://www.reddit.com/r/developersIndia/comments/1rqxbql/got_offer_at_ford_business_solutions_india_should/',
     '“Got offer at Ford Business Solutions India…” on r/developersIndia',34,1,null),
    (v_org,'IN','reddit',rf,rf_label,18,2,null),
    (v_org,'MX','reddit',lc,lc_label,90,1,null),
    (v_org,'PE','reddit',lc,lc_label,17,1,null),
    (v_org,'RO','reddit','https://www.reddit.com/r/Romania/comments/zqinqg/companii_industria_automotive_in_ro_cine_e_cel/',
     '“Automotive companies in Romania: which is best?” on r/Romania',17,1,null),
    (v_org,'US','reddit',rf,rf_label,46,1,null),
    (v_org,'VE','reddit',rf,rf_label,9,1,null),

    -- Quora
    (v_org,'AU','quora',qc,qc_label,11,1,null),
    (v_org,'GB','quora',qc,qc_label,10,1,null),
    (v_org,'IN','quora','https://www.quora.com/What-is-the-interview-process-at-Ford-India-What-are-the-rounds',
     '“What is the interview process at Ford India?”',93,1,null),
    (v_org,'US','quora',qc,qc_label,19,1,null),
    (v_org,'US','quora','https://www.quora.com/What-are-some-tips-on-making-it-through-the-job-interview-process-at-Ford',
     '“What are some tips on making it through the job interview process at Ford?”',10,1,'candidate'),
    (v_org,'VE','quora','https://www.quora.com/What-is-Ford-Plant-s-hiring-process-like',
     '“What is Ford Plant''s hiring process like?”',7,1,null),

    -- TikTok
    (v_org,'AR','tiktok',tt_practicas,tt_practicas_label,7,1,null),
    (v_org,'CL','tiktok','https://www.tiktok.com/@firstjobme/video/7251777402781617413',
     '“Ping pong con practicantes de Ford”',14,1,null),
    (v_org,'CO','tiktok',tt_practicas,tt_practicas_label,9,1,null),
    (v_org,'PE','tiktok',tt_practicas,tt_practicas_label,4,1,null),

    -- Facebook
    (v_org,'AR','facebook','https://www.facebook.com/lanacion/videos/es-una-planta-que-mejora-la-experiencia-de-los-empleados-y-la-hacer-realmente-in/665706188781601',
     '“Es una planta que mejora la experiencia de los empleados” (La Nación video)',79,1,null),
    (v_org,'CA','facebook',fb_app,fb_app_label,15,1,null),
    (v_org,'CL','facebook',fb_valores,fb_valores_label,6,1,null),
    (v_org,'CO','facebook',fb_valores,fb_valores_label,4,1,null),
    (v_org,'FR','facebook','https://www.facebook.com/BFMBusiness/videos/ford-r%C3%A9embauche-des-employ%C3%A9s-car-lia-ne-fait-pas-bien-le-job/1505822217329163',
     '“Ford réembauche des employés… car l''IA ne fait pas bien le job” (BFM Business)',4,1,null),
    (v_org,'GB','facebook',fb_app,fb_app_label,3,1,null),
    (v_org,'HU','facebook','https://www.facebook.com/fordbusinesssolutionshungary',
     'Ford Business Solutions Hungary on Facebook',14,1,null),
    (v_org,'IN','facebook','https://www.facebook.com/yourstorycom/videos/beyond-borders-inside-fords-global-capability-center-in-india-what-does-it-take-/24571898119163792',
     '“Beyond borders: inside Ford''s global capability center in India” (YourStory)',212,1,null),
    (v_org,'MX','facebook','https://www.facebook.com/EddyWarmanOficial/videos/el-motor-de-ford-m%C3%A9xico-no-solo-es-tecnolog%C3%ADa-es-el-mexicano/775702218361814',
     '“El motor de Ford México no solo es tecnología, es el mexicano”',32,1,null),
    (v_org,'RO','facebook','https://www.facebook.com/autocritica.ro/posts/-ford-otosan-a-anun%C8%9Bat-c%C4%83-va-crea-1300-de-noi-locuri-de-munc%C4%83-la-fabrica-din-cra/650125957129711',
     'Ford Otosan to create 1,300 new jobs in Craiova (Autocritica post)',5,1,null),
    (v_org,'US','facebook','https://www.facebook.com/FordMotorCompanyCareers/posts/ford-energy-is-a-new-battery-energy-storage-business-at-the-intersection-of-adva/1425131149657451',
     'Ford Energy careers in battery storage (Ford Careers post)',185,1,null),
    (v_org,'VE','facebook','https://www.facebook.com/FordVenezuela',
     'Ford Venezuela on Facebook',5,1,null),

    -- Instagram
    (v_org,'AR','instagram','https://www.instagram.com/reel/DQKAFq5DXzN',
     '“Las 10 mejores empresas para trabajar en Argentina”',19,1,null),
    (v_org,'CO','instagram',ig_talento,ig_talento_label,4,1,null),
    (v_org,'DE','instagram','https://www.instagram.com/reel/DQOls2RlUHN',
     '“Ford als sicherer Arbeitgeber?” (WDR)',15,1,null),
    (v_org,'FR','instagram','https://www.instagram.com/p/DPOOjR2CFgJ',
     '“Classement 2025 : les entreprises du secteur automobile…”',21,1,null),
    (v_org,'MX','instagram','https://www.instagram.com/reel/DZLOvV1JoRo',
     '“En Ford de México creemos que entender el negocio es clave”',45,1,null),
    (v_org,'PE','instagram',ig_talento,ig_talento_label,3,1,null),

    -- LinkedIn
    (v_org,'AR','linkedin','https://www.linkedin.com/company/ford-motor-company/life/argentina',
     'Life at Ford Argentina on LinkedIn',51,1,null),
    (v_org,'AU','linkedin','https://www.linkedin.com/posts/ford-australia_a-proud-moment-for-our-ford-australia-team-activity-7193041945957392385-zdxP',
     '“A proud moment for our Ford Australia team”',22,1,null),
    (v_org,'BE','linkedin','https://be.linkedin.com/showcase/ford-belgium',
     'Ford Belgium on LinkedIn',22,1,null),
    (v_org,'BR','linkedin','https://www.linkedin.com/company/ford-motor-company/life/brasil',
     'Life at Ford Brasil on LinkedIn',23,1,null),
    (v_org,'CA','linkedin',li_newhire,li_newhire_label,35,1,null),
    (v_org,'CL','linkedin','https://cl.linkedin.com/company/ford-wcm',li_wcm_label,47,1,null),
    (v_org,'CO','linkedin',li_wcm,li_wcm_label,27,1,null),
    (v_org,'DE','linkedin','https://www.linkedin.com/company/ford-motor-company/life',
     'Life at Ford on LinkedIn',14,1,null),
    (v_org,'ES','linkedin','https://es.linkedin.com/jobs/ford-empleos',
     'Ford jobs in Spain on LinkedIn',9,1,'candidate'),
    (v_org,'FR','linkedin','https://www.linkedin.com/showcase/ford-france',
     'Ford France on LinkedIn',10,1,null),
    (v_org,'FR','linkedin','https://fr.linkedin.com/pulse/how-pass-ford-motor-company-job-interview-vlztc',
     'How to pass a Ford job interview (LinkedIn article)',13,1,'candidate'),
    (v_org,'GB','linkedin','https://www.linkedin.com/pulse/workforce-innovations-ford-my-conversation-kiersten-amit-mohanty',
     '“Workforce innovations at Ford”',23,1,null),
    (v_org,'HU','linkedin','https://hu.linkedin.com/showcase/ford-business-solutions-hungary',
     'Ford Business Solutions Hungary on LinkedIn',96,1,null),
    (v_org,'IN','linkedin','https://www.linkedin.com/posts/ford-india_weareford-wearefbs-fordbusinesssolutionsindia-activity-7304742758982836224-dhG1',
     'Ford Business Solutions India #WeAreFord post',126,1,null),
    (v_org,'MX','linkedin','https://es.linkedin.com/posts/fordmx_en-ford-de-m%C3%A9xico-la-diversidad-equidad-activity-7139041278494691329-_-cQ',
     '“En Ford de México la diversidad, equidad…” (Ford México post)',67,1,null),
    (v_org,'MX','linkedin','https://es.linkedin.com/pulse/esto-es-lo-que-ford-busca-en-el-talento-mexicano-1rpxc',
     '“Esto es lo que Ford busca en el talento mexicano”',49,1,'candidate'),
    (v_org,'PE','linkedin',li_wcm,li_wcm_label,31,1,null),
    (v_org,'US','linkedin',li_newhire,li_newhire_label,62,1,null),
    (v_org,'VE','linkedin',li_wcm,li_wcm_label,69,1,null),

    -- Glassdoor: candidates
    (v_org,'AR','glassdoor','https://www.glassdoor.com.ar/Entrevista/Ford-Argentina-Preguntas-entrevistas-E3123922.htm',
     'Ford Argentina interview reviews',90,1,'candidate'),
    (v_org,'AU','glassdoor','https://www.glassdoor.com.au/Interview/Ford-Motor-Company-Interview-Questions-E263.htm',gd_label,22,1,'candidate'),
    (v_org,'BE','glassdoor',gd_fmc,gd_label,13,1,'candidate'),
    (v_org,'BR','glassdoor','https://www.glassdoor.com.br/Entrevista/Ford-Motor-Company-Perguntas-entrevista-E263.htm',gd_label,81,1,'candidate'),
    (v_org,'CA','glassdoor','https://www.glassdoor.ca/Interview/Ford-Motor-Co-of-Canada-Interview-Questions-E8205.htm',
     'Ford of Canada interview reviews',205,1,'candidate'),
    (v_org,'CL','glassdoor',gd_fmc,gd_label,18,1,'candidate'),
    (v_org,'CO','glassdoor',gd_ar,gd_label,16,1,'candidate'),
    (v_org,'DE','glassdoor','https://www.glassdoor.com/Interview/Ford-Motor-Company-Cologne-Interview-Questions-EI_IE263.0,18_IL.19,26_IM1061.htm',
     'Ford Cologne interview reviews',13,1,'candidate'),
    (v_org,'ES','glassdoor','https://www.glassdoor.es/Entrevista/Ford-Espana-Preguntas-de-entrevista-E3160077.htm',
     'Ford España interview reviews',18,1,'candidate'),
    (v_org,'FR','glassdoor','https://www.glassdoor.fr/Entretien/Ford-Motor-Company-questions-entretien-d-embauche-E263.htm',gd_label,19,1,'candidate'),
    (v_org,'GB','glassdoor','https://www.glassdoor.co.uk/Interview/Ford-Motor-Company-UK-Interview-Questions-E152869.htm',
     'Ford UK interview reviews',106,1,'candidate'),
    (v_org,'HU','glassdoor',gd_fmc,gd_label,16,1,'candidate'),
    (v_org,'IN','glassdoor','https://www.glassdoor.co.in/Interview/Ford-India-Interview-Questions-E152871.htm',
     'Ford India interview reviews',152,1,'candidate'),
    (v_org,'MX','glassdoor','https://www.glassdoor.com.mx/Entrevista/Ford-Motor-Company-Preguntas-entrevistas-E263.htm',gd_label,133,1,'candidate'),
    (v_org,'PE','glassdoor',gd_fmc,gd_label,14,1,'candidate'),
    (v_org,'RO','glassdoor','https://www.glassdoor.com/Interview/Ford-Otosan-Interview-Questions-E40638.htm',
     'Ford Otosan interview reviews',27,1,'candidate'),
    (v_org,'US','glassdoor',gd_fmc,gd_label,306,1,'candidate'),
    (v_org,'VE','glassdoor',gd_fmc,gd_label,25,1,'candidate'),

    -- Indeed: candidates
    (v_org,'AR','indeed','https://ar.indeed.com/cmp/Ford-Argentina-Sca/interviews','Ford Argentina interviews',78,1,'candidate'),
    (v_org,'AU','indeed','https://au.indeed.com/cmp/Ford-Australia/interviews','Ford Australia interviews',16,1,'candidate'),
    (v_org,'BE','indeed','https://fr.indeed.com/cmp/Ford-Motor-Company/interviews',in_label,20,1,'candidate'),
    (v_org,'BR','indeed','https://br.indeed.com/cmp/Ford-Motor-Company/interviews',in_label,54,1,'candidate'),
    (v_org,'CA','indeed','https://ca.indeed.com/cmp/Ford-of-Canada/interviews','Ford of Canada interviews',84,1,'candidate'),
    (v_org,'CL','indeed','https://cl.indeed.com/cmp/Ford-Motor-Company/interviews',in_label,22,1,'candidate'),
    (v_org,'CO','indeed',in_fmc,in_label,11,1,'candidate'),
    (v_org,'DE','indeed','https://de.indeed.com/cmp/Ford-Werke-Gmbh/interviews','Ford-Werke interviews',21,1,'candidate'),
    (v_org,'ES','indeed','https://es.indeed.com/cmp/Ford-Espa%C3%B1a/interviews','Ford España interviews',38,1,'candidate'),
    (v_org,'FR','indeed','https://fr.indeed.com/cmp/Ford-Motor-Company/interviews',in_label,32,1,'candidate'),
    (v_org,'GB','indeed',in_fmc,in_label,11,1,'candidate'),
    (v_org,'HU','indeed',in_fmc,in_label,9,1,'candidate'),
    (v_org,'IN','indeed','https://www.indeed.com/cmp/Ford-India-Pvt.ltd/faq/what-is-the-interview-process-like-at-ford-india-pvt-ltd',
     '“What is the interview process like at Ford India?”',26,1,'candidate'),
    (v_org,'MX','indeed','https://mx.indeed.com/cmp/Ford-Motor-Company/faq/c%C3%B3mo-es-el-proceso-de-entrevista-en-ford-motor-company',
     '“¿Cómo es el proceso de entrevista en Ford?”',94,1,'candidate'),
    (v_org,'PE','indeed',in_fmc,in_label,18,1,'candidate'),
    (v_org,'US','indeed',in_fmc,in_label,71,1,'candidate'),
    (v_org,'VE','indeed','https://cl.indeed.com/cmp/Ford-Motor-Company/interviews',in_label,21,1,'candidate'),

    -- Local review platforms and Comparably: candidates
    (v_org,'DE','kununu','https://www.kununu.com/de/ford-werke/bewerbung','Bewerbungserfahrungen bei Ford-Werke',101,1,'candidate'),
    (v_org,'IN','ambitionbox','https://www.ambitionbox.com/interviews/ford-india-interview-questions','Ford India interview questions',76,1,'candidate'),
    (v_org,'US','comparably','https://www.comparably.com/companies/ford-motor-company/interviews','Ford interviews',8,1,'candidate')
  on conflict (org_id, coalesce(market_code,'--'), platform, url) do update set
    label = excluded.label, citations = excluded.citations, rank = excluded.rank,
    audience = excluded.audience;

  -- Cards whose own link was the platform's front door.
  -- TikTok: a search, matching the YouTube cards.
  update public.activate_routes
     set destination_url = 'https://www.tiktok.com/search?q=trabajar%20en%20Ford'
   where org_id = v_org and platform = 'tiktok' and destination_url = 'https://www.tiktok.com'
     and market_code in ('AR','CL','CO','PE');

  -- Mexico Instagram: Ford's talent account (cited in 20 Mexican answers)
  -- rather than the consumer brand account.
  update public.activate_routes
     set destination_url = 'https://www.instagram.com/talento_ford_mexico/'
   where org_id = v_org and market_code = 'MX' and platform = 'instagram';

  -- Global default (countries we don't measure): highlights are per market,
  -- so the specific page goes on the route itself.
  update public.activate_routes
     set destination_url = rf
   where org_id = v_org and market_code is null and platform = 'reddit'
     and destination_url = 'https://www.reddit.com';
  update public.activate_routes
     set destination_url = 'https://www.linkedin.com/company/ford-motor-company/life'
   where org_id = v_org and market_code is null and platform = 'linkedin'
     and destination_url = 'https://www.linkedin.com';
end $$;
