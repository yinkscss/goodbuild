import type { PageTemplate } from "../page-templates";
import { daisyui, hyperui, magicui, pinterest, shadcn, st21, tailblocks } from "./sources";

export const MORE_SAAS: PageTemplate[] = [
  {
    id: "invoicely", label: "Invoicely", category: "SaaS", kind: "site",
    description: "An invoicing tool for freelancers with a clear three-step flow and pricing",
    mood: "fresh and businesslike, white with a confident green",
    font: "sans",
    theme: { bg: "#FFFFFF", fg: "#0F2A1D", muted: "#5E7A6B", card: "#F1F8F4", accent: "#059669", accentFg: "#FFFFFF" },
    nav: { brand: "Invoicely", links: ["Features", "Pricing", "Templates", "Help"], cta: "Create an invoice" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Invoicing for freelancers", title: "Get paid faster, without chasing", sub: "Send a clean invoice in a minute, add a pay link, and get a nudge when it is overdue.", cta: "Create an invoice", cta2: "See an example", art: "dashboard", note: "Free for your first 5 invoices a month" },
      { type: "steps", title: "From job done to money in", items: [
        { title: "Create", text: "Pick a template and add your line items." },
        { title: "Send", text: "Email it or share a pay link on WhatsApp." },
        { title: "Get paid", text: "Track who has paid and who has not." },
      ] },
      { type: "stats", items: [{ value: "9 days", label: "faster payment on average" }, { value: "24,000", label: "invoices sent" }, { value: "4.8/5", label: "freelancer rating" }] },
      { type: "pricing", title: "Pricing that grows with you", items: [
        { name: "Free", price: "$0", points: ["5 invoices a month", "1 template"] },
        { name: "Pro", price: "$9", note: "per month", points: ["Unlimited invoices", "Reminders", "Your logo"], highlight: true },
      ] },
    ],
    footer: "Invoicely. Pricing, Privacy, Terms.",
    inspiration: [hyperui("steps and two-tier pricing"), shadcn("stat row"), pinterest("fresh green finance tools")],
  },
  {
    id: "helpbot", label: "HelpBot", category: "SaaS", kind: "site",
    description: "An AI customer-support product page with a chat mock-up and use cases",
    mood: "modern and slightly futuristic, midnight blue with a violet glow",
    font: "sans",
    theme: { bg: "#0A0D1F", fg: "#ECEEFF", muted: "#9AA0C8", card: "#131735", accent: "#818CF8", accentFg: "#0A0D1F" },
    nav: { brand: "HelpBot", links: ["Product", "Use cases", "Pricing", "Docs"], cta: "Try it free" },
    sections: [
      { type: "hero", variant: "center", eyebrow: "AI support agent", title: "Answer customers at 3am, in their language", sub: "HelpBot reads your docs and answers questions on your site and WhatsApp. It hands over to you when it is unsure.", cta: "Try it free", cta2: "Book a demo", art: "orb" },
      { type: "features", title: "Built to be trusted", items: [
        { icon: "BookOpen", title: "Learns from your docs", text: "Point it at your help pages and it is ready in minutes." },
        { icon: "Languages", title: "Speaks their language", text: "English, Pidgin, Yoruba, Swahili and more." },
        { icon: "UserRoundCheck", title: "Hands over to humans", text: "Tricky chats go to your team with full context." },
      ] },
      { type: "stats", items: [{ value: "72%", label: "of chats solved" }, { value: "8 sec", label: "average reply" }] },
      { type: "cta", title: "Give your support team a night off", button: "Try it free" },
    ],
    footer: "HelpBot. Security, Docs, Status.",
    inspiration: [magicui("glowing orb hero"), shadcn("feature cards"), st21("AI product hero ideas")],
  },
  {
    id: "bookit", label: "BookIt", category: "SaaS", kind: "site",
    description: "An appointment-booking page for small businesses with a calendar look",
    mood: "light, friendly and organised, sky blue",
    font: "sans",
    theme: { bg: "#F4F9FF", fg: "#0E2238", muted: "#607890", card: "#FFFFFF", accent: "#2563EB", accentFg: "#FFFFFF" },
    nav: { brand: "BookIt", links: ["How it works", "Pricing", "For salons", "For clinics"], cta: "Get started" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Online booking", title: "Let customers book you while you work", sub: "A booking page, reminders by SMS and a calendar that stops double bookings.", cta: "Get started", cta2: "See a booking page", art: "dashboard" },
      { type: "features", title: "Fewer no-shows, fuller days", items: [
        { icon: "CalendarCheck", title: "Smart calendar", text: "No double bookings, ever." },
        { icon: "BellRing", title: "SMS reminders", text: "Cut no-shows by about a third." },
        { icon: "CreditCard", title: "Deposits", text: "Take a small deposit to hold the slot." },
      ] },
      { type: "quote", text: "My salon is full and my phone finally stopped ringing during appointments.", who: "Bisi Adekunle, Glow Salon" },
      { type: "cta", title: "Open your booking page today", button: "Get started" },
    ],
    footer: "BookIt. Support, Pricing, Privacy.",
    inspiration: [hyperui("feature cards and testimonial"), daisyui("calendar-like card styling"), pinterest("soft blue booking apps")],
  },
];

export const MORE_PORTFOLIO: PageTemplate[] = [
  {
    id: "authorpage", label: "Author Page", category: "Portfolio", kind: "site",
    description: "A writer's site with a featured book, an excerpt and an events list",
    mood: "bookish and warm, cream paper with a deep plum accent",
    font: "serif",
    theme: { bg: "#FBF6EE", fg: "#2A1620", muted: "#80666F", card: "#F2E8DA", accent: "#7A1F4B", accentFg: "#FFFFFF" },
    nav: { brand: "Ngozi Adichi-Eze", links: ["Books", "Excerpt", "Events", "Contact"], cta: "Order the book" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "The new novel", title: "The Harmattan Years", sub: "A family, a market town and the winter that changed everything. Out now in paperback and ebook.", cta: "Order the book", cta2: "Read an excerpt", art: "tiles" },
      { type: "quote", text: "Tender, funny and impossible to put down.", who: "The Lagos Review" },
      { type: "list", title: "Readings and events", rows: [
        { left: "14 Jan", mid: "Book launch, Lagos", right: "Details" },
        { left: "02 Feb", mid: "Abuja Book Fair", right: "Details" },
        { left: "21 Feb", mid: "Online Q and A", right: "Join" },
      ] },
      { type: "form", title: "Get new chapters in your inbox", placeholder: "you@email.com", button: "Subscribe" },
    ],
    footer: "Ngozi Adichi-Eze. Instagram, Goodreads.",
    inspiration: [tailblocks("split hero with a featured item"), pinterest("author website layouts")],
  },
  {
    id: "atelier", label: "Atelier", category: "Portfolio", kind: "site",
    description: "A minimal architecture studio page with a project grid and a short manifesto",
    mood: "stark and architectural, white and black with a concrete grey",
    font: "sans",
    theme: { bg: "#F4F4F2", fg: "#0F0F0F", muted: "#737373", card: "#E4E4E0", accent: "#111111", accentFg: "#FFFFFF" },
    nav: { brand: "ATELIER OKAFOR", links: ["Projects", "Studio", "Journal", "Contact"], cta: "Start a project" },
    sections: [
      { type: "hero", variant: "center", eyebrow: "Architecture and interiors, Abuja", title: "Space that suits the way you live", sub: "We design homes, offices and public places with light, local materials and patience.", cta: "See projects", cta2: "Start a project" },
      { type: "cards", title: "Selected projects", items: [
        { title: "Garki House", text: "Private residence", meta: "2026" },
        { title: "Maitama Library", text: "Public building", meta: "2025" },
        { title: "Wuse Studio", text: "Office interior", meta: "2025" },
        { title: "Jabi Pavilion", text: "Lakeside cafe", meta: "2024" },
      ] },
      { type: "quote", text: "Good buildings are quiet. They let life be the loud part.", who: "Chief architect, Atelier Okafor" },
    ],
    footer: "Atelier Okafor, Abuja. Instagram, Email.",
    inspiration: [tailblocks("project grid"), pinterest("minimal architecture portfolios"), st21("monochrome hero ideas")],
  },
  {
    id: "castcast", label: "Cast Cast", category: "Portfolio", kind: "site",
    description: "A podcast page with the latest episode, an episode list and where to listen",
    mood: "punchy and conversational, deep red with off-white",
    font: "sans",
    theme: { bg: "#18090B", fg: "#FFF1EC", muted: "#BFA09A", card: "#26100F", accent: "#FF5A44", accentFg: "#240805" },
    nav: { brand: "Cast Cast", links: ["Episodes", "About", "Sponsor"], cta: "Listen now" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "A weekly show about money and Africa", title: "Money Talk, with real people", sub: "Honest conversations about work, saving and building wealth. New episodes every Monday.", cta: "Listen now", cta2: "Subscribe", art: "orb" },
      { type: "list", title: "Latest episodes", rows: [
        { left: "#64", mid: "How I saved my first million", right: "42 min" },
        { left: "#63", mid: "Side hustles that actually pay", right: "38 min" },
        { left: "#62", mid: "Mobile money and the unbanked", right: "51 min" },
      ] },
      { type: "stats", items: [{ value: "1.2M", label: "downloads" }, { value: "64", label: "episodes" }, { value: "4.9", label: "average rating" }] },
    ],
    footer: "Cast Cast. Apple Podcasts, Spotify, YouTube.",
    inspiration: [hyperui("list rows with meta"), magicui("glow orb"), pinterest("podcast landing pages")],
  },
];

export const MORE_WEB3: PageTemplate[] = [
  {
    id: "badges", label: "Badge Mint", category: "Web3", kind: "dapp",
    description: "Soulbound attendance badges that organisers mint to wallets",
    mood: "proud and playful, deep blue with gold",
    font: "sans",
    theme: { bg: "#0B1330", fg: "#F4F7FF", muted: "#9CA9D6", card: "#141E47", accent: "#FBBF24", accentFg: "#2A1D02" },
    nav: { brand: "Proof of Showing Up", links: ["My badges", "Organisers", "FAQ"], cta: "Connect wallet" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Soulbound badges on Celo", title: "Prove you were there", sub: "Collect badges for the meetups and workshops you attend. They live in your wallet and cannot be sold.", cta: "See my badges", cta2: "Issue badges", art: "mint" },
      { type: "steps", title: "How it works", items: [
        { title: "Attend", text: "Go to an event run by an organiser." },
        { title: "Claim", text: "Scan the code or enter the event word." },
        { title: "Keep", text: "The badge sits in your wallet for good." },
      ] },
      { type: "stats", items: [{ value: "3,420", label: "badges issued" }, { value: "58", label: "events" }] },
    ],
    footer: "Badges are non-transferable. Contract, Docs.",
    onchain: "A non-transferable (soulbound) ERC-721 badge contract: an organiser wallet creates events and can mint a badge to an attendee's wallet or let them claim with an event code, one per wallet per event. The page shows the connected wallet's badges and an organiser form to create events and mint.",
    inspiration: [magicui("glow tiles"), daisyui("steps"), pinterest("badge and achievement UIs")],
  },
  {
    id: "votepoll", label: "Vote Poll", category: "Web3", kind: "dapp",
    description: "A one-wallet-one-vote poll page with live results after it closes",
    mood: "clear and civic, white and navy with an orange call to action",
    font: "sans",
    theme: { bg: "#F6F8FC", fg: "#0F1B3D", muted: "#5F6C8F", card: "#FFFFFF", accent: "#F97316", accentFg: "#2A1100" },
    nav: { brand: "ClassVote", links: ["Poll", "Results", "How it works"], cta: "Connect wallet" },
    sections: [
      { type: "hero", variant: "center", eyebrow: "400-level class poll", title: "Where should we go for the excursion?", sub: "One vote per wallet. Results appear when the poll closes on Friday.", cta: "Cast your vote", note: "Closes in 2 days, 14 hours" },
      { type: "cards", title: "Options", items: [
        { title: "Obudu Mountain Resort", text: "Cross River State", meta: "Overnight" },
        { title: "Lekki Conservation Centre", text: "Lagos", meta: "Day trip" },
        { title: "Yankari Game Reserve", text: "Bauchi State", meta: "Two nights" },
      ] },
      { type: "faq", items: [
        { q: "Can I change my vote?", a: "No. Votes are final once confirmed." },
        { q: "Who can vote?", a: "Wallets on the class list, one vote each." },
      ] },
    ],
    footer: "Votes are public on Celo. Built with GoodBuild.",
    onchain: "A poll contract: an owner-set list of eligible wallets, a deadline, options, one vote per wallet, and results readable only after the deadline. The page shows the options as cards with a Vote button and a results bar chart after close.",
    inspiration: [hyperui("centred hero with option cards"), shadcn("card grid"), pinterest("civic voting interfaces")],
  },
  {
    id: "escrow", label: "Escrow Pay", category: "Web3", kind: "dapp",
    description: "A freelancer escrow page: lock G$ for a job and release it when it is done",
    mood: "secure and calm, slate with a teal accent",
    font: "sans",
    theme: { bg: "#F2F6F7", fg: "#13262B", muted: "#60777D", card: "#FFFFFF", accent: "#0D9488", accentFg: "#FFFFFF" },
    nav: { brand: "SafeJob", links: ["How it works", "My jobs", "Help"], cta: "Connect wallet" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Escrow in G$", title: "Pay for work only when it is done", sub: "The client locks the payment. The freelancer delivers. One click releases the money, or a refund if it falls through.", cta: "Create a job", cta2: "Find my job", art: "dashboard" },
      { type: "steps", title: "Safe for both sides", items: [
        { title: "Lock", text: "The client deposits the agreed G$ amount." },
        { title: "Deliver", text: "The freelancer shares the work." },
        { title: "Release", text: "The client approves and the money moves." },
      ] },
      { type: "faq", items: [
        { q: "What if we disagree?", a: "A neutral arbiter wallet you both pick can decide." },
        { q: "Are there fees?", a: "None from us. You only pay the tiny network fee." },
      ] },
    ],
    footer: "SafeJob. Funds are held by the contract, never by us.",
    onchain: "An escrow contract: a client creates a job with a freelancer wallet, an amount in G$ and an optional arbiter; funds are locked; the client releases to the freelancer, or the arbiter or a deadline refunds the client. The page lists the connected wallet's jobs with status and action buttons.",
    inspiration: [hyperui("steps and faq"), tailblocks("two-column hero"), pinterest("trust and security landing pages")],
  },
];

export const MORE_STORE: PageTemplate[] = [
  {
    id: "bookshop", label: "Corner Books", category: "Store", kind: "site",
    description: "An independent bookshop with staff picks, new arrivals and a reading club",
    mood: "cosy and literate, forest green with cream",
    font: "serif",
    theme: { bg: "#F7F3E8", fg: "#1D2B20", muted: "#66755F", card: "#FFFFFF", accent: "#2F6B3F", accentFg: "#FFFFFF" },
    nav: { brand: "Corner Books", links: ["New", "Staff picks", "Reading club", "Visit"], cta: "Cart (0)" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "An independent bookshop in Enugu", title: "Books worth staying up for", sub: "African fiction, poetry and children's stories, chosen by people who have read them.", cta: "Shop new arrivals", cta2: "Join the reading club", art: "tiles" },
      { type: "cards", title: "Staff picks", items: [
        { title: "Things Fall Apart", text: "Chinua Achebe", meta: "₦6,500" },
        { title: "Americanah", text: "Chimamanda Ngozi Adichie", meta: "₦8,000" },
        { title: "Half of a Yellow Sun", text: "Chimamanda Ngozi Adichie", meta: "₦7,500" },
        { title: "Born a Crime", text: "Trevor Noah", meta: "₦7,000" },
      ] },
      { type: "form", title: "Monthly reading club", sub: "One book, one meeting, good company.", placeholder: "you@email.com", button: "Join" },
    ],
    footer: "Corner Books, 8 Ogui Road, Enugu.",
    inspiration: [hyperui("product grid"), tailblocks("simple store footer"), pinterest("independent bookshop sites")],
  },
  {
    id: "thrift", label: "Thrift Row", category: "Store", kind: "site",
    description: "A secondhand fashion store with bold colours, drops and a size guide",
    mood: "loud and youthful, hot pink and lime on warm white",
    font: "sans",
    theme: { bg: "#FFFDF2", fg: "#1B1B1B", muted: "#6F6F5F", card: "#FFFFFF", accent: "#EC4899", accentFg: "#FFFFFF" },
    nav: { brand: "THRIFT ROW", links: ["New drop", "Women", "Men", "Sell with us"], cta: "Bag (0)" },
    sections: [
      { type: "hero", variant: "center", eyebrow: "New drop every Thursday", title: "One of one finds, priced for students", sub: "Curated secondhand jackets, denim and shirts. When it is gone, it is gone.", cta: "Shop the drop", cta2: "Sell with us", art: "tiles" },
      { type: "cards", title: "This week", items: [
        { title: "Vintage denim jacket", text: "Size M", meta: "₦9,500" },
        { title: "Ankara bomber", text: "Size L", meta: "₦12,000" },
        { title: "Linen shirt", text: "Size S", meta: "₦5,500" },
        { title: "Retro track pants", text: "Size M", meta: "₦6,000" },
      ] },
      { type: "features", title: "Why Thrift Row", items: [
        { icon: "Recycle", title: "Second life", text: "Every piece is rescued, not made new." },
        { icon: "Ruler", title: "Honest sizing", text: "Real measurements on every item." },
        { icon: "Truck", title: "Fast delivery", text: "Two days in Lagos and Abuja." },
      ] },
    ],
    footer: "Thrift Row. Returns, Size guide, Instagram.",
    inspiration: [hyperui("product cards and feature row"), pinterest("bold thrift store pages"), st21("streetwear store heroes")],
  },
];

export const MORE_EVENTS: PageTemplate[] = [
  {
    id: "wedding", label: "Wedding Day", category: "Events", kind: "site",
    description: "A wedding page with the story, schedule, venue and an RSVP form",
    mood: "romantic and airy, blush and sage with gold type",
    font: "serif",
    theme: { bg: "#FBF4EF", fg: "#3B2A26", muted: "#8E7770", card: "#FFFFFF", accent: "#B8864B", accentFg: "#FFFFFF" },
    nav: { brand: "Tolu and Femi", links: ["Our story", "Schedule", "Venue", "RSVP"], cta: "RSVP" },
    sections: [
      { type: "hero", variant: "center", eyebrow: "Saturday 20 February 2027, Ibadan", title: "Tolu and Femi are getting married", sub: "Join us for a day of love, music and a lot of jollof.", cta: "RSVP", cta2: "See the schedule", art: "orb" },
      { type: "list", title: "The day", rows: [
        { left: "10:00", mid: "Ceremony, St Peter's Church", right: "" },
        { left: "13:00", mid: "Reception, Cocoa House Gardens", right: "" },
        { left: "19:00", mid: "Dancing till late", right: "" },
      ] },
      { type: "form", title: "Will you join us?", sub: "Please reply by 15 January.", placeholder: "Your full name", button: "Send RSVP" },
    ],
    footer: "With love, Tolu and Femi. #TolulolaFemi27",
    inspiration: [tailblocks("centred hero and schedule"), pinterest("wedding website layouts")],
  },
  {
    id: "meetup", label: "Builders Meetup", category: "Events", kind: "site",
    description: "A monthly community meetup page with the next date, talks and a sign-up",
    mood: "casual and welcoming, warm yellow on dark charcoal",
    font: "sans",
    theme: { bg: "#141414", fg: "#FAF7EA", muted: "#A8A38E", card: "#1F1F1F", accent: "#FACC15", accentFg: "#1A1500" },
    nav: { brand: "Builders Meetup", links: ["Next event", "Past talks", "Speak", "Join"], cta: "Save my seat" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Last Thursday of every month", title: "Meet the people building in your city", sub: "Short talks, live demos and good food. Beginners very welcome.", cta: "Save my seat", cta2: "Propose a talk", art: "tiles", note: "Next: 28 January, Yaba, 6pm" },
      { type: "list", title: "Next lineup", rows: [
        { left: "6:00", mid: "Doors, pizza and hello", right: "" },
        { left: "6:30", mid: "Shipping your first app in a weekend", right: "Tunde B." },
        { left: "7:15", mid: "Lightning demos", right: "You?" },
      ] },
      { type: "stats", items: [{ value: "1,900", label: "members" }, { value: "36", label: "meetups held" }] },
    ],
    footer: "Builders Meetup. Code of conduct, Slack.",
    inspiration: [hyperui("event hero and agenda list"), daisyui("dark card styling")],
  },
];

export const MORE_COMMUNITY: PageTemplate[] = [
  {
    id: "fitclub", label: "FitClub", category: "Community", kind: "site",
    description: "A local gym page with classes, memberships and a free trial form",
    mood: "energetic and bold, black with electric orange",
    font: "sans",
    theme: { bg: "#0D0D0D", fg: "#FFFFFF", muted: "#A3A3A3", card: "#1A1A1A", accent: "#FF6B1A", accentFg: "#1A0A00" },
    nav: { brand: "FITCLUB", links: ["Classes", "Memberships", "Trainers", "Visit"], cta: "Free trial" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Strength and conditioning, Port Harcourt", title: "Train hard. Feel it every day.", sub: "Small classes, real coaches and a community that turns up. Your first week is free.", cta: "Free trial", cta2: "See the timetable", art: "chart" },
      { type: "cards", title: "Classes", items: [
        { title: "Strength 60", text: "Barbells and bodyweight", meta: "Mon, Wed, Fri" },
        { title: "Boxing Fit", text: "Pads, bags and cardio", meta: "Tue, Thu" },
        { title: "Sunday Reset", text: "Mobility and stretch", meta: "Sun" },
      ] },
      { type: "pricing", title: "Memberships", items: [
        { name: "Drop in", price: "₦5,000", points: ["Any class", "No contract"] },
        { name: "Monthly", price: "₦30,000", points: ["Unlimited classes", "1 guest pass"], highlight: true },
        { name: "Quarterly", price: "₦80,000", points: ["Everything in monthly", "Free kit"] },
      ] },
    ],
    footer: "FitClub, 22 Aba Road, Port Harcourt.",
    inspiration: [hyperui("class cards and pricing row"), pinterest("bold gym landing pages"), magicui("chart glow")],
  },
  {
    id: "schoolhome", label: "Bright School", category: "Community", kind: "site",
    description: "A primary school website with admissions, values and a visit-us form",
    mood: "cheerful and trustworthy, navy with sunshine yellow",
    font: "sans",
    theme: { bg: "#F5F8FF", fg: "#10224A", muted: "#5B6C91", card: "#FFFFFF", accent: "#F59E0B", accentFg: "#2A1900" },
    nav: { brand: "Bright School", links: ["About", "Admissions", "Life at school", "Contact"], cta: "Book a visit" },
    sections: [
      { type: "hero", variant: "split", eyebrow: "Nursery and primary, Ibadan", title: "Where curious children grow", sub: "Small classes, kind teachers and a love of learning, from age 3 to 11.", cta: "Book a visit", cta2: "Admissions", art: "tiles" },
      { type: "features", title: "What we believe", items: [
        { icon: "Sprout", title: "Curiosity first", text: "Children learn best when they ask why." },
        { icon: "HeartHandshake", title: "Kindness counts", text: "Character matters as much as grades." },
        { icon: "Users", title: "Small classes", text: "No more than 20 children each." },
      ] },
      { type: "stats", items: [{ value: "18", label: "years" }, { value: "1:12", label: "teacher ratio" }, { value: "96%", label: "parent satisfaction" }] },
      { type: "form", title: "Book a school visit", placeholder: "Parent's phone number", button: "Request a visit" },
    ],
    footer: "Bright School, Bodija, Ibadan.",
    inspiration: [tailblocks("feature trio and stat band"), hyperui("contact strip"), pinterest("school website boards")],
  },
];
