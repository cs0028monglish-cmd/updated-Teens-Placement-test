/* =====================================================================
   Monglish Teens (Unlock / Interchange) Placement Test v2 — DATA FILE
   ---------------------------------------------------------------------
   Edit content here. app.js is the engine and should not need changing
   for a new programme: change TIERS, READING, BANK, rubrics, DECISION
   and the webhook names in CONFIG.

   LADDER (Dr. Abir, 11 Oct 2026):
     1 Unlock Basic Skills · Pre-Beginner · Pre-A1
     2 Interchange Intro   · Beginner     · A1
     3 Interchange 1       · Elementary   · A2
     4 Interchange 2       · Intermediate · B1
     5 Interchange 3       · Upper Intermediate · B2

   READING   : 30 items, 6 per level, easiest first (stratified linear).
               Items 1-40 of the v1 paper were re-levelled and reused;
               new items fill Pre-A1 and B2. `src` = v1 item number.
   LISTENING : one original exercise per tier (6 items, item 1 is the
               worked example and is NOT scored -> /5). Served at the
               reading tier. audio/listen-N.mp3 when recorded; until then
               the browser reads the script in an en-US voice.
   WRITING   : one task per tier (words, focus, points).
   SPEAKING  : three topic sets per tier; recorded answers (5 questions)
               or the live examiner when CONFIG.agentId is set.
   Every item carries lvl (tier), obj (can-do / objective), dok (1-4).
   CEFR is INDICATIVE until standard setting and validation are done.
   ===================================================================== */

const CONFIG = {
  testName:     "Monglish Teens Placement Test",
  version:      "v2",
  /* TIMING — 60 minutes for every student, whatever the level (Dr. Abir, 11 Oct 2026).
     Each part has its own clock; when it runs out the part is submitted.
       reading   30 items                                   22 min
       listening one track: 3 plays (max ~3 min) + 5 answers   8 min
       writing   one task (15-150 words by level)           20 min
       speaking  5 recorded answers + re-records             10 min
                                                    total   60 min                */
  timing: { readingMin: 22, listeningMin: 8, writingMin: 20, speakingMin: 10 },
  audioSeconds: { 1: 36, 2: 47, 3: 49, 4: 60, 5: 62 },   // filled in by _audio_build/gen.py after recording
  totalMinutes: 60,
  minCoverage:  0.80,     // reading: fewer than 24/30 answered -> PROVISIONAL, CEFR withheld
  masteryBar:   60,       // % that means "working at this level"
  levelWidth:   40,       // % points that equal one level on the ability scale
  maxPlays:     3,        // listening: 1 play + 2 replays
  ageMin:       10, ageMax: 19,
  rubricMax:    5,
  /* REPORTED MARKS OUT OF 100 — four skills weighted equally (25 each):
     receptive (reading + listening) 50% · productive (writing + speaking) 50%.
     Converted mark = (raw mark / section total) x weight.
       Reading   /30 -> 25   (x 0.83)
       Listening  /5 -> 25   (x 5)
       Writing   /20 -> 25   (x 1.25)
       Speaking  /25 -> 25   (x 1)
     Placement still follows the level rules, not this total.                 */
  reportMarks: { reading: 25, listening: 25, writing: 25, speaking: 25 },
  fastAnswerMs: 1500,     // answers quicker than this count as "very fast"
  // n8n endpoints (STAGING until approved). Base can be overridden with ?n8n=https://...
  n8nBase:      "https://monglish.app.n8n.cloud",
  hooks: { result:"teens2-result", writing:"teens2-writing", speaking:"teens2-speaking", flag:"teens2-flag", report:"teens2-report" },
  agentId:      ""        // ElevenLabs examiner agent id. Empty = recorded-answer speaking only.
};

const TIERS = {
  1:{ course:"Unlock Basic Skills", name:"Pre-Beginner",       cefr:"Pre-A1", anchor:"A1", min:0,  max:6,  color:"#38bdf8" },
  2:{ course:"Interchange Intro",   name:"Beginner",           cefr:"A1",     anchor:"A1", min:7,  max:13, color:"#3b82f6" },
  3:{ course:"Interchange 1",       name:"Elementary",         cefr:"A2",     anchor:"A2", min:14, max:20, color:"#6366f1" },
  4:{ course:"Interchange 2",       name:"Intermediate",       cefr:"B1",     anchor:"B1", min:21, max:27, color:"#f59e0b" },
  5:{ course:"Interchange 3",       name:"Upper Intermediate", cefr:"B2",     anchor:"B2", min:28, max:30, color:"#F26522" }
};

/* CEFR spoken-production descriptors (examiner reference). */
const CEFR_DESCRIPTORS = {
  A1:"Can use simple phrases and sentences to describe where they live and people they know.",
  A2:"Can use a series of phrases and sentences to describe in simple terms family, other people, school and daily routines.",
  B1:"Can connect phrases in a simple way to describe experiences, events, hopes and ambitions, and briefly give reasons for opinions and plans.",
  B2:"Can present clear, detailed descriptions on a wide range of familiar subjects and explain a viewpoint, giving advantages and disadvantages."
};

/* PRODUCTIVE RUBRICS — scored 1-5 AGAINST THE LEVEL TESTED
   (a fluent Pre-A1 answer scores 5 on a Pre-A1 task). Anchored to the decision
   table: 4 = secure at this level (4 x 5 = 20 -> place), 3 = adequate/borderline,
   5 = strong/above, 2 = mostly below, 1 = weak. Same thresholds as Business v4. */
const BAND_WORDS = ["", "Weak (below)", "Mostly below", "Adequate (borderline)", "Secure", "Strong (above)"];
const SPEAKING_RUBRIC = [
  { c:"Fluency & coherence",      d:"Answers at the length the level expects; ideas follow on; recovers from pauses" },
  { c:"Grammar range & accuracy", d:"Uses the level's target structures accurately" },
  { c:"Vocabulary",               d:"Topic words for the level; can explain a missing word" },
  { c:"Pronunciation",            d:"Easy to understand; stress and intonation help meaning" },
  { c:"Interaction",              d:"Understands the question first time; handles follow-ups" }
];
const WRITING_RUBRIC = [
  { c:"Task & length",          d:"Covers every point in the word range set for the level" },
  { c:"Target structures",      d:"Uses the level's grammar focus accurately" },
  { c:"Organisation",           d:"Ideas in a clear order and linked" },
  { c:"Vocabulary & spelling",  d:"Range and spelling right for the level" }
];
const DECISION = {
  speaking: { above:[22,25], place:[18,21], borderline:[14,17], below:[0,13], minCriterionToPlace:3, max:25 },
  writing:  { above:[18,20], confirm:[12,17], below:[0,11], max:20 }
};

/* ------------------------------ READING ------------------------------ */
const READING = [
  // Tier 1 · Pre-A1 · Unlock Basic Skills (new items)
  { lvl:1, obj:"classroom objects",        dok:1, sec:"Vocabulary", img:"assets/reading/q-book.jpg", q:"This is a ___.", o:["book","chair","door","apple"], a:0 },
  { lvl:1, obj:"colours",                  dok:1, sec:"Vocabulary", img:"assets/reading/q-sun.jpg", q:"The sun is ___.", o:["blue","yellow","green","black"], a:1 },
  { lvl:1, obj:"numbers 1-20",             dok:1, sec:"Vocabulary", q:"3 + 4 = ___", o:["six","eight","seven","four"], a:2 },
  { lvl:1, obj:"introducing yourself",     dok:1, sec:"Grammar",    q:"Hello! My ___ is Ali.", o:["name","old","from","is"], a:0 },
  { lvl:1, obj:"age",                      dok:1, sec:"Grammar",    q:"I am twelve years ___.", o:["name","big","age","old"], a:3 },
  { lvl:1, obj:"greetings",                dok:1, sec:"Functions",  q:"A: “How are you?”  B: “___”", o:["I’m Ali.","I’m fine, thank you.","I’m ten.","Yes, I am."], a:1 },

  // Tier 2 · A1 · Interchange Intro
  { lvl:2, src:14, obj:"verb be (I)",          dok:1, sec:"Grammar",    q:"I ___ a student.", o:["be","is","are","am"], a:3 },
  { lvl:2, src:15, obj:"verb be (they)",       dok:1, sec:"Grammar",    q:"They ___ from Saudi Arabia.", o:["is","are","be","am"], a:1 },
  { lvl:2, src:16, obj:"personal information", dok:1, sec:"Grammar",    q:"___ your phone number?", o:["What","Where","What’s","How"], a:2 },
  { lvl:2, src:2,  obj:"family words",         dok:1, sec:"Vocabulary", q:"My father’s brother is my ___.", o:["cousin","nephew","grandfather","uncle"], a:3 },
  { lvl:2, src:5,  obj:"adjectives: prices",   dok:1, sec:"Vocabulary", q:"The opposite of “expensive” is ___.", o:["cheap","small","rich","poor"], a:0 },
  { lvl:2, src:31, obj:"meeting people",       dok:1, sec:"Functions",  q:"A: “Hi. I’m Omar.”  B: “___”", o:["Nice to meet you.","Yes, please.","You’re welcome.","I’m fine."], a:0 },

  // Tier 3 · A2 · Interchange 1
  { lvl:3, src:17, obj:"present simple he/she",  dok:1, sec:"Grammar",    q:"She ___ coffee every morning.", o:["is drink","drinks","drink","drinking"], a:1 },
  { lvl:3, src:19, obj:"present simple questions", dok:1, sec:"Grammar",  q:"What time ___ you usually wake up?", o:["is","are","does","do"], a:3 },
  { lvl:3, src:22, obj:"countable nouns",        dok:2, sec:"Grammar",    q:"How ___ apples do you need?", o:["any","many","some","much"], a:1 },
  { lvl:3, src:23, obj:"past simple",            dok:1, sec:"Grammar",    q:"I ___ to Dubai last year.", o:["went","go","am going","have gone"], a:0 },
  { lvl:3, src:6,  obj:"places in town",         dok:2, sec:"Vocabulary", q:"I need to buy a new shirt. Where should I go?", o:["a hospital","a museum","a post office","a clothes store"], a:3 },
  { lvl:3, src:34, obj:"offers",                 dok:2, sec:"Functions",  q:"A: “Would you like some juice?”  B: “___”", o:["Yes, I can.","Yes, I’d love some.","Yes, I like.","Yes, I’m juice."], a:1 },

  // Tier 4 · B1 · Interchange 2
  { lvl:4, src:28, obj:"present perfect (experience)", dok:2, sec:"Grammar", q:"I ___ this movie before. It’s really good.", o:["see","am seeing","have seen","saw"], a:2 },
  { lvl:4, src:29, obj:"second conditional",     dok:2, sec:"Grammar",    q:"If I ___ more money, I would buy a new laptop.", o:["will have","have","am having","had"], a:3 },
  { lvl:4, src:30, obj:"passive (present)",      dok:2, sec:"Grammar",    q:"English ___ in many countries around the world.", o:["is spoken","spoke","is speaking","speaks"], a:0 },
  { lvl:4, src:27, obj:"obligation (must)",      dok:2, sec:"Grammar",    q:"You ___ wear a seat belt in the car. It’s the law.", o:["may","might","must","can"], a:2 },
  { lvl:4, src:10, obj:"interests (be into)",    dok:2, sec:"Vocabulary", q:"“I’m really into photography.” This means ___.", o:["I work in a photo shop","I need a camera","I dislike photography","I am interested in photography"], a:3 },
  { lvl:4, src:39, obj:"agreeing with reasons",  dok:2, sec:"Functions",  q:"A: “I think online learning is very useful.”  B: “___”", o:["I don’t useful.","I agree. It can be very flexible.","I have useful.","I’m agree. It is very flex."], a:1 },

  // Tier 5 · B2 · Interchange 3
  { lvl:5, src:12, obj:"phrasal meaning: postpone", dok:2, sec:"Vocabulary", q:"The meeting was postponed. This means it was ___.", o:["moved to a later time","started early","finished quickly","cancelled forever"], a:0 },
  { lvl:5,          obj:"phrasal verbs",          dok:2, sec:"Vocabulary", q:"The school trip was ___ because of the storm.", o:["called off","taken off","turned off","given off"], a:0 },
  { lvl:5,          obj:"third conditional",      dok:3, sec:"Grammar",    q:"If I ___ harder, I would have passed the exam.", o:["studied","had studied","would study","have studied"], a:1 },
  { lvl:5,          obj:"past perfect",           dok:3, sec:"Grammar",    q:"By the time we got to the cinema, the film ___.", o:["already started","has already started","had already started","was already start"], a:2 },
  { lvl:5,          obj:"verb + -ing (suggest)",  dok:2, sec:"Grammar",    q:"My teacher suggested ___ more English podcasts.", o:["to listen","listening to","listen","listened"], a:1 },
  { lvl:5, src:40,  obj:"disagreeing politely",   dok:3, sec:"Functions",  q:"A: “I don’t think teenagers should spend so much time online.”  B: “___”", o:["I am not online teenagers.","I see your point, but technology can also support learning.","Yes, I have too much.","I don’t spend teenagers."], a:1 }
];
/* Reserve items (v1 numbers) for a parallel form: 1, 3, 4, 7, 8, 9, 11, 13, 18, 20, 21, 24, 25, 26, 32, 33, 35, 36, 37, 38. */

/* ------------------------------ BANK ------------------------------ */
const L = (who, text) => ({ who, text });   // who: NARR | M | W | M2 | W2

const BANK = {
  /* ===== TIER 1 — Pre-A1 · Unlock Basic Skills ===== */
  1: {
    listening: {
      title:"My things", audioSrc:"audio/listen-1.mp3",
      instruction:"Listen to six short sentences. Choose the correct answer.",
      items:[
        { example:true, q:"What colour is Mona’s bag?", options:["red","blue","green"], answer:"red", obj:"colours", script:[L("W","Hi! I’m Mona. My bag is red.")] },
        { q:"How many books does Tom have?", options:["two","three","four"], answer:"three", obj:"numbers", script:[L("M","I’m Tom. I have three books.")] },
        { q:"What is it?", options:["a pen","a pencil","a ruler"], answer:"a pencil", obj:"classroom objects", script:[L("W","Look. This is my pencil.")] },
        { q:"Which bus is it?", options:["5","15","50"], answer:"15", obj:"numbers", script:[L("M","This is bus number fifteen.")] },
        { q:"What day is it today?", options:["Monday","Sunday","Friday"], answer:"Friday", obj:"days", script:[L("W","Today is Friday.")] },
        { q:"What does Ali like?", options:["pizza","apples","rice"], answer:"apples", obj:"food likes", script:[L("M2","I’m Ali. I like apples.")] }
      ]
    },
    writing: { task:"About me", words:[15,30], minutes:20, focus:"I am / I like / I have",
      instruction:"Write three short sentences about you (15–30 words).",
      points:["Your name.","Your age.","One thing you like."], starter:"My name is ______. I am ______ years old. I like ______." },
    speaking: { grammar:["I am / I have / I like","Numbers, colours, family words","Yes/No answers with a short reason"],
      sets:[
        { title:"Me", qs:["What is your name?","How old are you?","What is your favourite colour?","Do you have a brother or a sister?"] },
        { title:"My things", qs:["What is in your school bag?","What colour is your phone or bag?","Do you have a pet?","What is your favourite food?"] },
        { title:"My day", qs:["What do you like to do after school?","Do you like sport?","What is your favourite day?","Who is your best friend?"] }
      ] }
  },

  /* ===== TIER 2 — A1 · Interchange Intro ===== */
  2: {
    listening: {
      title:"At a language club", audioSrc:"audio/listen-2.mp3",
      instruction:"Listen to six short conversations at a language club. Choose the correct answer.",
      items:[
        { example:true, q:"Where is Lina from?", options:["Jordan","Japan","Germany"], answer:"Jordan", obj:"countries", script:[L("M","Hi, where are you from?"),L("W","I’m Lina. I’m from Jordan.")] },
        { q:"How old is Sam?", options:["13","14","15"], answer:"14", obj:"age", script:[L("W","How old are you, Sam?"),L("M","I’m fourteen.")] },
        { q:"What is Karim’s favourite subject?", options:["math","art","music"], answer:"art", obj:"school subjects", script:[L("W","Karim, what’s your favourite subject?"),L("M2","My favourite subject is art. I don’t like math.")] },
        { q:"What room is the English class in?", options:["12","20","22"], answer:"22", obj:"numbers", script:[L("M","Excuse me, where’s the English class?"),L("W","It’s in room twenty-two.")] },
        { q:"When is the club?", options:["Monday","Tuesday","Thursday"], answer:"Tuesday", obj:"days", script:[L("W2","When is the club?"),L("M","It’s on Tuesday, every week.")] },
        { q:"What time does it start?", options:["4:00","4:30","5:30"], answer:"4:30", obj:"telling the time", script:[L("W2","And what time does it start?"),L("M","At four thirty.")] }
      ]
    },
    writing: { task:"Me and my family", words:[30,50], minutes:20, focus:"Present simple: be, have, like",
      instruction:"Write about you and your family (30–50 words). Use the present simple.",
      points:["Your name, age and where you are from.","The people in your family.","What you like to do."], starter:"My name is ______. I am from ______." },
    speaking: { grammar:["Verb be and present simple","Possessive adjectives (my, his, her)","There is / there are","Daily routine and free-time words"],
      sets:[
        { title:"Personal information", qs:["What’s your name? Can you spell it, please?","Where are you from?","What school do you go to?","How old are you?"] },
        { title:"Family", qs:["Tell me about your family.","What does your father or mother do?","Do you have any brothers or sisters?","Who do you live with?"] },
        { title:"Daily life", qs:["What time do you get up?","What do you do after school?","What do you do on the weekend?","What is your favourite TV show?"] }
      ] }
  },

  /* ===== TIER 3 — A2 · Interchange 1 ===== */
  3: {
    listening: {
      title:"Weekend plans", audioSrc:"audio/listen-3.mp3",
      instruction:"Listen to six short conversations about the weekend. Choose the correct answer.",
      items:[
        { example:true, q:"What did Maya do on Saturday?", options:["went to the beach","played football","visited her aunt"], answer:"went to the beach", obj:"past simple", script:[L("M","How was your weekend, Maya?"),L("W","Great! On Saturday I went to the beach with my family.")] },
        { q:"What does Adam want to buy?", options:["a jacket","shoes","a bag"], answer:"shoes", obj:"shopping", script:[L("W","What are you looking for, Adam?"),L("M","Some new shoes for the gym. My old ones are too small.")] },
        { q:"How much is the concert ticket?", options:["$8","$18","$80"], answer:"$18", obj:"prices", script:[L("M2","How much is a ticket for the concert?"),L("W","It’s eighteen dollars for students.")] },
        { q:"Where are they going to meet?", options:["at the mall","at the station","at school"], answer:"at the station", obj:"arrangements", script:[L("W","Where do you want to meet?"),L("M","Let’s meet at the station at ten.")] },
        { q:"What’s the weather going to be like tomorrow?", options:["rainy","sunny","windy"], answer:"sunny", obj:"weather", script:[L("NARR","And now the weather. Tomorrow it’s going to be sunny, but cold in the morning.")] },
        { q:"Why can’t Nour come?", options:["She has homework.","She is sick.","She is visiting her grandma."], answer:"She has homework.", obj:"reasons", script:[L("W2","Sorry, I can’t come tonight. I have to finish my science homework.")] }
      ]
    },
    writing: { task:"Last weekend", words:[50,70], minutes:20, focus:"Past simple, time words (first, then, after that)",
      instruction:"Write about what you did last weekend (50–70 words). Use the past simple.",
      points:["Where you went and who you were with.","What you did there.","How you felt about it."], starter:"Last weekend I ______" },
    speaking: { grammar:["Past simple: regular and irregular verbs","Countable and uncountable nouns","Going to for plans","Can / can’t for ability"],
      sets:[
        { title:"Past events", qs:["What did you do last weekend?","Where did you go on your last holiday?","What did you have for dinner yesterday?","Tell me about your last birthday."] },
        { title:"Food and shopping", qs:["What is your favourite meal? How do you make it?","Where do you like to go shopping?","How much money do you spend each week?","What did you buy last time you went shopping?"] },
        { title:"Plans and abilities", qs:["What are you going to do this summer?","What sports can you play?","What are you going to do after the test today?","What can you cook?"] }
      ] }
  },

  /* ===== TIER 4 — B1 · Interchange 2 ===== */
  4: {
    listening: {
      title:"A teen podcast about volunteering", audioSrc:"audio/listen-4.mp3",
      instruction:"Listen to a podcast interview with Dina, a teenage volunteer. There are six parts. Choose the correct answer for each part.",
      items:[
        { example:true, q:"How long has Dina volunteered at the animal shelter?", options:["for two years","for two months","since last week"], answer:"for two years", obj:"present perfect (for/since)", script:[L("M","Welcome back. Today I’m talking to Dina. Dina, how long have you volunteered at the animal shelter?"),L("W","I’ve been going there for two years now, every Saturday.")] },
        { q:"Why did she start?", options:["A friend asked her to come.","It was a school project.","She wanted a pet."], answer:"A friend asked her to come.", obj:"reasons", script:[L("M","Why did you start?"),L("W","Honestly, my best friend asked me to come along one day, and I loved it from the start.")] },
        { q:"What is the most important thing she has learned?", options:["to be patient","to speak in public","to manage money"], answer:"to be patient", obj:"main idea", script:[L("M","What have you learned?"),L("W","The biggest thing is patience. Some of the dogs are scared at first, so you have to wait.")] },
        { q:"What would she do if she had more time?", options:["start a club at school","train dogs at home","raise money online"], answer:"start a club at school", obj:"second conditional", script:[L("M","If you had more free time, what would you do?"),L("W","I’d start a volunteering club at my school, so more students could join.")] },
        { q:"What does the host think?", options:["Schools should include volunteering.","Volunteering is only for adults.","Volunteering takes too much time."], answer:"Schools should include volunteering.", obj:"opinion", script:[L("M","Personally, I think every school should include volunteering in the timetable. It teaches things you can’t learn from books.")] },
        { q:"What is Dina’s advice?", options:["Start with something you enjoy.","Ask your parents first.","Volunteer every day."], answer:"Start with something you enjoy.", obj:"advice", script:[L("M","Any advice for listeners?"),L("W","Start with something you already enjoy. If you love animals, go to a shelter. Then it never feels like work.")] }
      ]
    },
    writing: { task:"An experience to remember", words:[80,100], minutes:20, focus:"Present perfect, past simple, second conditional",
      instruction:"Write about an interesting experience you have had (80–100 words). Say what happened, how you felt, and what you would do if it happened again.",
      points:["An interesting experience you have had (present perfect + past simple).","How you felt and why.","What you would do if it happened again (second conditional)."], starter:"I have never forgotten the day ______" },
    speaking: { grammar:["Present perfect vs past simple","Comparatives and superlatives","Second conditional","Should / must for advice and obligation"],
      sets:[
        { title:"Experiences", qs:["What is the most interesting place you have ever visited?","Have you ever tried a new hobby? How was it?","What is something you have learned this year?","Tell me about a time you helped someone."] },
        { title:"Comparing and choosing", qs:["Is it better to live in a city or in the countryside? Why?","Which is more useful for teenagers: a phone or a laptop?","What is the best way to learn English?","How is your school different from your parents’ school?"] },
        { title:"Imagine and advise", qs:["If you could live in another country, where would you go?","What would you do if you won a lot of money?","What should a new student do on the first day of school?","What must teenagers do to stay healthy?"] }
      ] }
  },

  /* ===== TIER 5 — B2 · Interchange 3 ===== */
  5: {
    listening: {
      title:"A debate: phones in schools", audioSrc:"audio/listen-5.mp3",
      instruction:"Listen to two students, Leo and Sara, in a school debate about phones. There are six parts. Choose the best answer for each part.",
      items:[
        { example:true, q:"What is the debate about?", options:["banning phones during lessons","buying phones for students","using phones for homework"], answer:"banning phones during lessons", obj:"topic", script:[L("NARR","Today’s motion: phones should be banned during lessons. Leo speaks for the motion, Sara against.")] },
        { q:"What is Leo’s main argument?", options:["Phones distract students even when switched off.","Phones are too expensive for students.","Teachers do not know how to use phones."], answer:"Phones distract students even when switched off.", obj:"main argument", script:[L("M","Research suggests that just having a phone on your desk reduces concentration, even if it’s switched off. So the problem isn’t only using it.")] },
        { q:"How does Sara respond?", options:["She partly agrees but prefers clear rules to a ban.","She agrees that a ban is the only answer.","She says phones never distract anyone."], answer:"She partly agrees but prefers clear rules to a ban.", obj:"stance", script:[L("W","I see your point, Leo, and I’d accept that phones can be a distraction. But a complete ban seems unrealistic. Clear rules would work better.")] },
        { q:"What does Sara imply about emergencies?", options:["Parents need to be able to contact students.","Schools should buy phones for emergencies.","Emergencies rarely happen at school."], answer:"Parents need to be able to contact students.", obj:"inference", script:[L("W","And let’s be honest: if something happened on the way home, most parents would want to reach their children straight away.")] },
        { q:"What compromise do they reach?", options:["Phones stay in lockers until lunch.","Phones are allowed in every lesson.","Only older students may bring phones."], answer:"Phones stay in lockers until lunch.", obj:"negotiating", script:[L("M","What if phones were kept in lockers until lunchtime, and students could check them then?"),L("W","That’s something I could live with.")] },
        { q:"What does the moderator conclude?", options:["Students should help make the rules.","Leo clearly won the debate.","The school will ban phones next year."], answer:"Students should help make the rules.", obj:"conclusion", script:[L("NARR","Interesting. It seems both sides agree on one thing: rules work best when students have helped to write them.")] }
      ]
    },
    writing: { task:"Opinion essay", words:[120,150], minutes:20, focus:"Linking words, passive, conditionals, giving and balancing opinions",
      instruction:"Should phones be banned in schools? Write an opinion essay (120–150 words). Give both sides and your own view.",
      points:["Arguments for a ban.","Arguments against a ban.","Your opinion with a reason, and a conclusion."], starter:"Many people believe that ______" },
    speaking: { grammar:["Third conditional and wishes","Passive in different tenses","Relative clauses","Expressing and balancing opinions"],
      sets:[
        { title:"Opinions", qs:["Should students wear school uniforms? Why or why not?","How has social media changed the way teenagers communicate?","Do you think homework helps students learn? Explain.","What makes a good teacher, in your opinion?"] },
        { title:"Reflection", qs:["If you could change one decision you made, what would it be?","What is something you wish you had learned earlier?","Describe a person who has influenced you and explain how.","What is a skill that is often underestimated?"] },
        { title:"Society and the future", qs:["How will schools be different in twenty years?","What can young people do about environmental problems?","Should online learning replace classrooms? Give both sides.","What problem in your city would you like to solve, and how?"] }
      ] }
  }
};

(typeof window !== "undefined" ? window : globalThis).TPT = { CONFIG, TIERS, CEFR_DESCRIPTORS, BAND_WORDS, SPEAKING_RUBRIC, WRITING_RUBRIC, DECISION, READING, BANK };
if (typeof module !== "undefined") module.exports = globalThis.TPT || window.TPT;
