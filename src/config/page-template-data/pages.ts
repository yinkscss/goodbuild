import type { ExtraPage, Section } from "../page-templates";

const p = (name: string, ...sections: Section[]): ExtraPage => ({ name, sections });
const cards = (title: string, items: [string, string, string?][]): Section => ({ type: "cards", title, items: items.map(([t, x, m]) => ({ title: t, text: x, meta: m })) });
const list = (title: string, rows: [string, string?, string?][]): Section => ({ type: "list", title, rows: rows.map(([left, mid, right]) => ({ left, mid, right })) });
const steps = (title: string, items: [string, string][]): Section => ({ type: "steps", title, items: items.map(([t, x]) => ({ title: t, text: x })) });
const form = (title: string, placeholder: string, button: string, sub?: string): Section => ({ type: "form", title, placeholder, button, sub });
const quote = (text: string, who: string): Section => ({ type: "quote", text, who });
const stats = (...items: [string, string][]): Section => ({ type: "stats", items: items.map(([value, label]) => ({ value, label })) });
const faq = (...items: [string, string][]): Section => ({ type: "faq", items: items.map(([q, a]) => ({ q, a })) });
const feat = (title: string, items: [string, string, string][]): Section => ({ type: "features", title, items: items.map(([icon, t, x]) => ({ icon, title: t, text: x })) });
const price = (title: string, items: { name: string; price: string; note?: string; points: string[]; highlight?: boolean }[]): Section => ({ type: "pricing", title, items });

/** Extra pages after Home, by template id. Only plain websites are multi-page; dApps are one screen. */
export const EXTRA_PAGES: Record<string, ExtraPage[]> = {
  flowdesk: [
    p("Customers", quote("We cut our weekly meeting from an hour to fifteen minutes.", "Dayo Ajayi, operations lead at Savannah Co"), stats(["1,200", "teams"], ["38%", "fewer missed deadlines"], ["4.9/5", "customer rating"]), { type: "logos", label: "Trusted by", items: ["Kora Labs", "Ndiyo", "Paystream", "Savannah Co"] }),
    p("Security", feat("Your work stays yours", [["ShieldCheck", "Encrypted", "Data is encrypted in transit and at rest."], ["KeyRound", "Single sign-on", "Use your company login on the Company plan."], ["History", "Audit log", "See who changed what, and when."]]), faq(["Where is data stored?", "In Lagos and Frankfurt, your choice."])),
  ],
  pulse: [
    p("Docs", steps("Set up in minutes", [["Add the snippet", "One line before the closing body tag."], ["Send an event", "Call pulse.track with a name."], ["Open the dashboard", "Your first chart appears at once."]]), feat("Guides", [["Filter", "Funnels", "Build your first funnel."], ["Repeat", "Retention", "Read the retention grid."], ["Webhook", "Webhooks", "Send events to your own tools."]])),
    p("Pricing", price("Pay for what you track", [{ name: "Starter", price: "$0", note: "up to 10k events", points: ["3 dashboards", "7 day history"] }, { name: "Growth", price: "$49", note: "per month", points: ["1M events", "Unlimited dashboards", "1 year history"], highlight: true }, { name: "Scale", price: "Talk to us", points: ["Custom volume", "Priority support"] }]), faq(["What counts as an event?", "Anything you send with pulse.track."])),
  ],
  shipkit: [
    p("Examples", cards("Start from an example", [["Next.js blog", "Static site with previews.", "Next.js"], ["Vite dashboard", "A React admin template.", "Vite"], ["Edge API", "A tiny API in 20 lines.", "Workers"]])),
    p("Docs", steps("Quickstart", [["Install", "npm i -g shipkit"], ["Log in", "shipkit login opens your browser."], ["Ship", "shipkit ship from any project."]]), faq(["Does it support monorepos?", "Yes. Point it at a folder with --dir."])),
  ],
  pocketpay: [
    p("Fees", price("Clear, tiny fees", [{ name: "Send", price: "$0.01", note: "per transfer", points: ["Any amount", "Anywhere in the app"] }, { name: "Cash out", price: "1%", note: "to a local agent", points: ["Minimum $0.50"], highlight: true }]), faq(["Are there hidden charges?", "No. The fee is shown before you confirm."])),
    p("Safety", feat("Built to be safe", [["Fingerprint", "You hold the keys", "We can never move your money."], ["BellRing", "Instant alerts", "A message for every transfer."], ["LifeBuoy", "Real people", "Help in English and Pidgin."]])),
  ],
  folio: [
    p("About", quote("Design is the quiet work of making things feel obvious.", "Ada Okoro"), steps("How I work", [["Listen", "A short call to understand the goal."], ["Explore", "Three directions in two weeks."], ["Refine", "One direction, polished and handed over."]]), stats(["8", "years"], ["60+", "projects"], ["12", "countries"])),
    p("Contact", form("Tell me about your project", "you@email.com", "Send", "I reply within two working days."), list("Elsewhere", [["Instagram", "@adaokoro.design"], ["Behance", "behance.net/adaokoro"]])),
  ],
  devfolio: [
    p("Writing", list("Recent posts", [["Shipping a Celo dApp in a weekend", "8 min read", "Nov 2026"], ["Why I still use Postgres", "5 min read", "Oct 2026"], ["Notes on accessible forms", "6 min read", "Sep 2026"]])),
    p("About", steps("Where I have worked", [["Paystream", "Staff engineer, 2024 to now."], ["Kora Labs", "Senior engineer, 2021 to 2024."], ["Freelance", "Websites and tools, 2018 to 2021."]]), form("Say hello", "you@company.com", "Send")),
  ],
  lumen: [
    p("Prints", cards("Limited prints", [["Makola, Early", "A3 on cotton paper", "$80"], ["Harmattan", "A2 on matte paper", "$120"], ["The Quiet Hour", "A3 framed", "$150"]]), faq(["How are prints shipped?", "Rolled in a tube, tracked, in five days."])),
    p("About", quote("I photograph the moments just before and after the picture people expect.", "Lumen, photographer"), stats(["12", "years"], ["300+", "shoots"], ["4", "exhibitions"])),
  ],
  beatline: [
    p("Music", cards("Releases", [["Midnight in Kumasi", "Single, 2026", "New"], ["Gold Dust", "EP, coming soon", "2027"], ["Harmattan Nights", "Album, 2025", "12 tracks"]])),
    p("Tour", list("All shows", [["12 Dec", "Accra, Alte Fest", "Tickets"], ["20 Dec", "Lagos, Terra Kulture", "Tickets"], ["04 Jan", "Kumasi, Centre for Culture", "Sold out"], ["18 Jan", "Abuja, Silverbird", "Tickets"]])),
  ],
  corner: [
    p("About", steps("Where it comes from", [["Meet the makers", "Small workshops across Nigeria."], ["Fair prices", "Makers keep 70% of every sale."], ["Made to last", "Natural materials, no waste."]]), quote("Selling through Corner Shop doubled my orders in a season.", "Fatima Bello, basket weaver")),
    p("Contact", form("Say hello", "you@email.com", "Send", "Questions about an order? We reply the same day."), list("Visit us", [["Address", "12 Kofar Mata Road, Kano"], ["Hours", "Mon to Sat, 9am to 6pm"]])),
  ],
  kitchen: [
    p("Menu", cards("Mains", [["Party jollof", "With fried plantain", "₦3,500"], ["Pounded yam and egusi", "With goat meat", "₦4,200"], ["Grilled tilapia", "With pepper sauce", "₦5,000"]]), cards("Sides and drinks", [["Moi moi", "Steamed bean pudding", "₦1,200"], ["Zobo", "Chilled hibiscus", "₦800"], ["Chapman", "House special", "₦1,500"]])),
    p("Find us", list("Where we are", [["Address", "14 Herbert Macaulay Way, Yaba"], ["Phone", "0801 234 5678"], ["Parking", "Free behind the shop"]]), form("Order for a party", "Your phone number", "Call me back")),
  ],
  gathering: [
    p("Speakers", cards("The lineup", [["Amara Eze", "CEO, Kora Labs", "Keynote"], ["Tunde Bello", "Staff engineer", "Talk"], ["Zainab Musa", "Design lead", "Workshop"], ["Ife Adeniyi", "Founder, The Letter", "Panel"]])),
    p("Venue", list("Getting there", [["Where", "Landmark Centre, Victoria Island"], ["Parking", "Free for ticket holders"], ["Hotels", "Partner rates on request"]]), faq(["Is the venue accessible?", "Yes, step-free from the car park."])),
  ],
  buildathon: [
    p("Prizes", cards("What you can win", [["First place", "$2,500 and a mentoring year", "1 team"], ["Runners up", "$1,000 each", "2 teams"], ["Best newcomer", "$500 and swag", "1 team"]]), stats(["$5,000", "in prizes"], ["12", "judges"])),
    p("FAQ", faq(["Do I need a team?", "No. We match you on Friday."], ["Is it free?", "Yes, free to enter."], ["What can I build?", "Anything useful on Celo."])),
  ],
  letter: [
    p("Archive", list("All issues", [["Issue 84", "Why mobile money won", "Oct 30"], ["Issue 83", "The quiet rise of tech hubs", "Oct 23"], ["Issue 82", "Stablecoins for school fees", "Oct 16"], ["Issue 81", "What founders get wrong about Lagos", "Oct 9"]])),
    p("About", quote("I write the newsletter I wish had existed when I started.", "Ife Adeniyi"), steps("What you get", [["One email", "Every Thursday morning."], ["Five ideas", "Each with a short story."], ["No noise", "No ads, ever."]])),
  ],
  cohort: [
    p("Mentors", cards("Meet your mentors", [["Tunde Bello", "Staff engineer, Paystream", "Backend"], ["Zainab Musa", "Design lead, Ndiyo", "Design"], ["Amara Eze", "CEO, Kora Labs", "Career"]])),
    p("FAQ", faq(["Do I need to know code?", "No. We start from the basics."], ["How many hours a week?", "About 10, mostly weekends."], ["Is there a job help?", "Yes, careers coaching in the last month."]), form("Still unsure?", "you@email.com", "Ask us")),
  ],
  hands: [
    p("Stories", quote("The first day the tap worked, the whole village came to watch.", "Mr Yusuf Garba, village head"), cards("From the field", [["Kuriga Primary", "Water point opened in March.", "340 children"], ["Doka Nursery", "New filters installed.", "120 children"]])),
    p("Get involved", steps("Ways to help", [["Give", "Monthly or once."], ["Volunteer", "Join a build trip."], ["Fundraise", "Run a campaign for a school."]]), form("Join our updates", "you@email.com", "Sign up")),
  ],
  invoicely: [
    p("Pricing", price("Simple pricing", [{ name: "Free", price: "$0", points: ["5 invoices a month"] }, { name: "Pro", price: "$9", note: "per month", points: ["Unlimited invoices", "Reminders", "Your logo"], highlight: true }, { name: "Team", price: "$24", note: "per month", points: ["5 people", "Reports"] }]), faq(["Can I cancel anytime?", "Yes, in one click."])),
    p("Templates", cards("Invoice templates", [["Classic", "Clean and formal.", "Free"], ["Studio", "Bold with your logo.", "Pro"], ["Receipt", "Short and quick.", "Free"]])),
  ],
  helpbot: [
    p("Pricing", price("Pricing", [{ name: "Starter", price: "$0", note: "100 chats", points: ["1 website"] }, { name: "Growth", price: "$39", note: "per month", points: ["2,000 chats", "WhatsApp", "Handover to your team"], highlight: true }]), faq(["What counts as a chat?", "One conversation with one visitor."])),
    p("Use cases", cards("Where teams use HelpBot", [["Online shops", "Order status and returns.", "E-commerce"], ["Schools", "Admissions questions.", "Education"], ["Fintech", "Account help, safely.", "Finance"]])),
  ],
  bookit: [
    p("Pricing", price("Pricing", [{ name: "Solo", price: "$7", note: "per month", points: ["1 calendar", "SMS reminders"] }, { name: "Studio", price: "$19", note: "per month", points: ["5 staff", "Deposits", "Reports"], highlight: true }])),
    p("For salons", feat("Made for salons", [["Scissors", "Services and prices", "Show what you offer."], ["Users", "Per-stylist calendars", "Each stylist has their own."], ["Star", "Reviews", "Ask happy clients for a review."]]), quote("I stopped losing money to no-shows.", "Bisi Adekunle, Glow Salon")),
  ],
  authorpage: [
    p("Books", cards("Books", [["The Harmattan Years", "Novel, 2026", "New"], ["Salt and Palm Oil", "Short stories, 2023", ""], ["Letters to Lagos", "Essays, 2020", ""]])),
    p("Events", list("Upcoming", [["14 Jan", "Book launch, Lagos", "Details"], ["02 Feb", "Abuja Book Fair", "Details"], ["21 Feb", "Online Q and A", "Join"]]), form("Invite me to speak", "you@organisation.com", "Send")),
  ],
  atelier: [
    p("Studio", quote("We start with the light, then the walls.", "Atelier Okafor"), stats(["16", "years"], ["80", "projects"], ["9", "architects"])),
    p("Contact", form("Start a project", "you@email.com", "Send", "Tell us about the site and the budget."), list("Studio", [["Address", "5 Gana Street, Maitama, Abuja"], ["Hours", "Mon to Fri, 9am to 5pm"]])),
  ],
  castcast: [
    p("About", quote("We talk about money the way friends do, honestly and with jokes.", "Your host, Kemi Alade"), stats(["64", "episodes"], ["1.2M", "downloads"], ["4.9", "rating"])),
    p("Sponsor", price("Sponsor the show", [{ name: "Mention", price: "$300", points: ["A 30 second read"] }, { name: "Presenting", price: "$900", points: ["Intro and outro", "Newsletter slot"], highlight: true }]), form("Talk to us", "you@company.com", "Send")),
  ],
  bookshop: [
    p("Reading club", steps("How the club works", [["Pick up the book", "A new title every month."], ["Read at your pace", "No pressure."], ["Meet on the last Saturday", "Tea, cake and talk."]]), form("Join the club", "you@email.com", "Join")),
    p("Visit", list("Find us", [["Address", "8 Ogui Road, Enugu"], ["Hours", "Mon to Sat, 9am to 7pm"], ["Phone", "0802 345 6789"]])),
  ],
  thrift: [
    p("Sell with us", steps("Sell your clothes", [["Send photos", "Upload up to 10 items."], ["We price them", "Fair and quick."], ["Get paid", "When it sells, you get 60%."]]), form("Start selling", "you@email.com", "Start")),
    p("Size guide", list("Women", [["S", "UK 8 to 10"], ["M", "UK 12 to 14"], ["L", "UK 16 to 18"]]), list("Men", [["S", "Chest 36 in"], ["M", "Chest 40 in"], ["L", "Chest 44 in"]])),
  ],
  meetup: [
    p("Past talks", list("Recent", [["Dec", "Building with Celo", "Watch"], ["Nov", "Design for slow networks", "Watch"], ["Oct", "Your first open source PR", "Watch"]])),
    p("Speak", steps("Give a talk", [["Pitch", "Send a title and a line."], ["Prepare", "10 minutes, we help."], ["Present", "Friendly room, snacks."]]), form("Propose a talk", "you@email.com", "Send")),
  ],
  fitclub: [
    p("Timetable", list("This week", [["Mon 6am", "Strength 60", "8 spots"], ["Tue 6pm", "Boxing Fit", "5 spots"], ["Wed 6am", "Strength 60", "9 spots"], ["Sun 8am", "Sunday Reset", "12 spots"]])),
    p("Trainers", cards("Your coaches", [["Chika", "Strength", "10 years"], ["Emeka", "Boxing", "8 years"], ["Ify", "Mobility", "6 years"]])),
  ],
  schoolhome: [
    p("Admissions", steps("How to apply", [["Book a visit", "See the school in action."], ["Meet the head", "A short chat with parents."], ["Enrol", "Places confirmed in a week."]]), price("Termly fees", [{ name: "Nursery", price: "₦180,000", points: ["Ages 3 to 5"] }, { name: "Primary", price: "₦240,000", points: ["Ages 6 to 11"], highlight: true }]), form("Ask about a place", "Parent's phone number", "Request a call")),
    p("Life at school", cards("A day at Bright", [["Morning circle", "Songs and stories.", "8am"], ["Maths and reading", "Small groups.", "9am"], ["Clubs", "Art, chess and football.", "2pm"]]), quote("My son runs to school every morning.", "Mrs Folake Ade, parent")),
  ],
};
