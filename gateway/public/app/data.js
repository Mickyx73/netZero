// Reference data for the NetZero Hub app.
//
// The six providers and twenty services are the ones identified in Part A.
// Services 2.1, 3.2, 3.3, 5.1 and 5.2 (and 3.1's live status) are served by
// the Part E microservices through the API gateway. The rest are simulated in
// the app with the datasets below, so every option in the app works end to end.

export const PROVIDERS = [
  { id: "energy", name: "GreenEnergy Co.", short: "Energy", icon: "sun", blurb: "Renewable power for your home" },
  { id: "transit", name: "EcoTransit Authority", short: "Travel", icon: "route", blurb: "Low-carbon ways to get around" },
  { id: "ev", name: "ChargeNet EV", short: "Charging", icon: "plug", blurb: "Find, book and pay for EV charging" },
  { id: "waste", name: "GreenWaste Solutions", short: "Waste", icon: "recycle", blurb: "Recycling, e-waste and compost" },
  { id: "gov", name: "GovEnvironment Agency", short: "Footprint", icon: "leaf", blurb: "Measure and offset your emissions" },
  { id: "community", name: "EcoCommunity Action", short: "Community", icon: "people", blurb: "Local events, gardens and volunteering" },
];

export const SERVICES = [
  { id: "1.1", provider: "energy", name: "Switch to a renewable plan", href: "#/energy/plans", icon: "sun" },
  { id: "1.2", provider: "energy", name: "Check if solar suits your home", href: "#/energy/solar", icon: "sun" },
  { id: "1.3", provider: "energy", name: "Smart meter insights", href: "#/energy/meter", icon: "meter" },
  { id: "1.4", provider: "energy", name: "Sell your solar back to the grid", href: "#/energy/buyback", icon: "zap" },
  { id: "2.1", provider: "transit", name: "Plan a low-carbon trip", href: "#/travel", icon: "route" },
  { id: "2.2", provider: "transit", name: "Buy a transit pass", href: "#/travel/pass", icon: "ticket" },
  { id: "2.3", provider: "transit", name: "Find a share bike", href: "#/travel/bikes", icon: "bike" },
  { id: "3.1", provider: "ev", name: "Find a charger", href: "#/charge", icon: "map" },
  { id: "3.2", provider: "ev", name: "Book a charging bay", href: "#/charge", icon: "calendar" },
  { id: "3.3", provider: "ev", name: "Charging sessions and receipts", href: "#/charge/bookings", icon: "plug" },
  { id: "3.4", provider: "ev", name: "Plan an EV road trip", href: "#/charge/route", icon: "battery" },
  { id: "4.1", provider: "waste", name: "Book an e-waste pickup", href: "#/waste/ewaste", icon: "recycle" },
  { id: "4.2", provider: "waste", name: "Which bin does it go in?", href: "#/waste/guide", icon: "search" },
  { id: "4.3", provider: "waste", name: "Request a compost bin", href: "#/waste/compost", icon: "sprout" },
  { id: "5.1", provider: "gov", name: "Measure your carbon footprint", href: "#/footprint/calc", icon: "leaf" },
  { id: "5.2", provider: "gov", name: "Offset your emissions", href: "#/footprint/offset", icon: "tree" },
  { id: "5.3", provider: "gov", name: "Check a green business", href: "#/business", icon: "store" },
  { id: "6.1", provider: "community", name: "Join a community event", href: "#/community/events", icon: "calendar" },
  { id: "6.2", provider: "community", name: "Book a garden plot", href: "#/community/garden", icon: "sprout" },
  { id: "6.3", provider: "community", name: "Find volunteering", href: "#/community/volunteer", icon: "people" },
];

// Illawarra suburbs with postcode and approximate coordinates.
export const SUBURBS = [
  { name: "Wollongong", postcode: "2500", lat: -34.4248, lng: 150.8931 },
  { name: "North Wollongong", postcode: "2500", lat: -34.4100, lng: 150.8950 },
  { name: "Fairy Meadow", postcode: "2519", lat: -34.3940, lng: 150.8925 },
  { name: "Figtree", postcode: "2525", lat: -34.4353, lng: 150.8604 },
  { name: "Thirroul", postcode: "2515", lat: -34.3175, lng: 150.9206 },
  { name: "Corrimal", postcode: "2518", lat: -34.3720, lng: 150.8990 },
  { name: "Unanderra", postcode: "2526", lat: -34.4550, lng: 150.8440 },
  { name: "Port Kembla", postcode: "2505", lat: -34.4730, lng: 150.8980 },
  { name: "Dapto", postcode: "2530", lat: -34.4940, lng: 150.7920 },
  { name: "Shellharbour", postcode: "2529", lat: -34.5800, lng: 150.8660 },
  { name: "Kiama", postcode: "2533", lat: -34.6710, lng: 150.8540 },
  { name: "Helensburgh", postcode: "2508", lat: -34.1780, lng: 150.9940 },
];
export const suburbByName = (n) => SUBURBS.find((s) => s.name === n) || SUBURBS[0];

// Places the journey planner knows (the journey-planner-service accepts any text).
export const PLACES = ["Wollongong", "Sydney CBD", "Thirroul", "Shellharbour", "Kiama", "Dapto", "Corrimal", "Bulli", "Figtree", "Port Kembla", "Fairy Meadow", "UOW Innovation Campus", "Helensburgh", "Unanderra"];

export const VEHICLES = [
  { id: "model3", name: "Tesla Model 3", plug: "CCS2", rangeKm: 491, batteryKwh: 60 },
  { id: "atto3", name: "BYD Atto 3", plug: "CCS2", rangeKm: 420, batteryKwh: 60 },
  { id: "ioniq5", name: "Hyundai Ioniq 5", plug: "CCS2", rangeKm: 450, batteryKwh: 72 },
  { id: "mg4", name: "MG4", plug: "CCS2", rangeKm: 350, batteryKwh: 51 },
  { id: "leaf", name: "Nissan Leaf", plug: "CHAdeMO", rangeKm: 270, batteryKwh: 40 },
  { id: "zoe", name: "Renault Zoe", plug: "Type 2", rangeKm: 315, batteryKwh: 52 },
];
export const vehicleById = (id) => VEHICLES.find((v) => v.id === id) || null;

// EV road-trip destinations from Wollongong (km by road) and charging stops on the way.
export const ROAD_TRIPS = [
  { to: "Sydney CBD", km: 85, stops: [{ name: "ChargeNet Engadine", at: 55, kw: 150 }] },
  { to: "Kiama", km: 37, stops: [{ name: "ChargeNet Albion Park", at: 22, kw: 150 }] },
  { to: "Bowral", km: 70, stops: [{ name: "ChargeNet Robertson", at: 50, kw: 75 }] },
  { to: "Nowra", km: 77, stops: [{ name: "ChargeNet Gerringong", at: 46, kw: 120 }] },
  { to: "Canberra", km: 235, stops: [{ name: "ChargeNet Moss Vale", at: 82, kw: 150 }, { name: "ChargeNet Goulburn", at: 150, kw: 350 }, { name: "ChargeNet Lake George", at: 205, kw: 150 }] },
  { to: "Batemans Bay", km: 165, stops: [{ name: "ChargeNet Nowra", at: 77, kw: 150 }, { name: "ChargeNet Ulladulla", at: 128, kw: 120 }] },
  { to: "Jervis Bay", km: 105, stops: [{ name: "ChargeNet Nowra", at: 77, kw: 150 }] },
];

// ---------------------------------------------------------------- GreenEnergy Co.
export const ENERGY_PLANS = [
  { id: "solar100", name: "Sunrise 100", greenShare: 1, cPerKwh: 31.9, supplyPerDay: 1.05, summary: "100% GreenPower from NSW solar and wind farms" },
  { id: "blend50", name: "Coastal Blend", greenShare: 0.5, cPerKwh: 29.4, supplyPerDay: 1.0, summary: "Half your power matched with renewables" },
  { id: "neutral", name: "Carbon Neutral Basic", greenShare: 0.25, cPerKwh: 27.8, supplyPerDay: 0.98, summary: "Grid power with certified offsets for the rest" },
];
export const GRID_KG_PER_KWH = 0.7; // matches footprint-service's grid factor
export const FEED_IN_C_PER_KWH = 7.0;

// ---------------------------------------------------------------- EcoTransit
export const PASS_TYPES = [
  { id: "day", name: "Day pass", hours: 24, price: 9.5 },
  { id: "week", name: "7-day pass", hours: 24 * 7, price: 41 },
  { id: "month", name: "30-day pass", hours: 24 * 30, price: 150 },
];
export const BIKE_DOCKS = [
  { id: "BK-01", name: "Crown St Mall", suburb: "Wollongong" },
  { id: "BK-02", name: "Wollongong Station", suburb: "Wollongong" },
  { id: "BK-03", name: "Belmore Basin", suburb: "Wollongong" },
  { id: "BK-04", name: "North Beach", suburb: "North Wollongong" },
  { id: "BK-05", name: "UOW Northfields Ave", suburb: "North Wollongong" },
  { id: "BK-06", name: "Fairy Meadow Station", suburb: "Fairy Meadow" },
  { id: "BK-07", name: "Corrimal Beach", suburb: "Corrimal" },
  { id: "BK-08", name: "Thirroul Station", suburb: "Thirroul" },
  { id: "BK-09", name: "Figtree Grove", suburb: "Figtree" },
  { id: "BK-10", name: "Port Kembla Beach", suburb: "Port Kembla" },
];

// ---------------------------------------------------------------- GreenWaste
export const WOLLONGONG_POSTCODES = ["2500", "2502", "2505", "2506", "2508", "2515", "2516", "2517", "2518", "2519", "2525", "2526", "2527", "2530"];
export const EWASTE_ITEMS = [
  { id: "tv", name: "TVs and monitors", max: 3, unit: "item" },
  { id: "computer", name: "Computers and laptops", max: 5, unit: "item" },
  { id: "phone", name: "Mobile phones and tablets", max: 10, unit: "item" },
  { id: "printer", name: "Printers and scanners", max: 3, unit: "item" },
  { id: "battery", name: "Household batteries", max: 10, unit: "kg" },
  { id: "small", name: "Small appliances (kettles, toasters)", max: 6, unit: "item" },
  { id: "fridge", name: "Fridges and freezers", max: 0, unit: "item", note: "Not collected with e-waste: book a bulky-goods pickup instead" },
];
// Recycling sorting guide: keyword -> disposal instruction.
export const SORTING_GUIDE = [
  { keys: ["pizza box", "pizza"], item: "Pizza box", bin: "yellow", note: "Recycle if mostly clean; put greasy parts in green organics" },
  { keys: ["coffee cup", "takeaway cup"], item: "Takeaway coffee cup", bin: "red", note: "Plastic lining stops it being recycled; lids go in yellow" },
  { keys: ["glass bottle", "jar", "wine bottle", "beer bottle"], item: "Glass bottle or jar", bin: "yellow", note: "Rinse and leave lids off" },
  { keys: ["can", "tin", "aluminium", "aluminum"], item: "Aluminium or steel can", bin: "yellow", note: "Rinse; no need to remove labels" },
  { keys: ["plastic bottle", "milk bottle", "water bottle"], item: "Plastic bottle", bin: "yellow", note: "Eligible containers earn 10c at Return and Earn" },
  { keys: ["soft plastic", "plastic bag", "chip packet", "glad wrap", "cling wrap"], item: "Soft plastic", bin: "red", note: "Not accepted in yellow bins; some supermarkets collect it" },
  { keys: ["newspaper", "paper", "cardboard", "box", "magazine"], item: "Paper and cardboard", bin: "yellow", note: "Flatten boxes" },
  { keys: ["food scrap", "food", "banana", "apple", "vegetable", "fruit", "eggshell", "coffee grounds"], item: "Food scraps", bin: "green", note: "Use the kitchen caddy liners" },
  { keys: ["grass", "leaves", "garden", "branch", "prunings"], item: "Garden organics", bin: "green", note: "Branches under 10 cm thick" },
  { keys: ["battery", "batteries", "aa", "lithium"], item: "Batteries", bin: "dropoff", note: "Fire risk in bins; drop at a Community Recycling Centre or book e-waste pickup" },
  { keys: ["phone", "laptop", "computer", "tv", "monitor", "cable", "charger", "e-waste"], item: "Electronics", bin: "dropoff", note: "Book an e-waste pickup in this app" },
  { keys: ["paint", "oil", "gas bottle", "chemical", "fluorescent", "light globe"], item: "Household chemicals", bin: "dropoff", note: "Community Recycling Centre, Kembla Grange" },
  { keys: ["nappy", "nappies", "tissue", "polystyrene", "styrofoam", "ceramic", "mirror", "broken glass"], item: "General waste", bin: "red", note: "Wrap broken glass before binning" },
  { keys: ["clothes", "clothing", "shoes", "textile"], item: "Clothing", bin: "dropoff", note: "Donate wearable items; textile recycling bins at most shopping centres" },
];
export const BINS = {
  yellow: { name: "Yellow recycling bin", colour: "#E8B21E" },
  green: { name: "Green organics bin", colour: "#3E8B3A" },
  red: { name: "Red general waste bin", colour: "#C0392B" },
  dropoff: { name: "Special drop-off", colour: "#5B6B78" },
};

// ---------------------------------------------------------------- GovEnvironment
export const OFFSET_PROJECTS = [
  { id: "reforestation", name: "Reforestation", place: "Southern Highlands, NSW", body: "Replanting cleared farmland with native eucalypt woodland." },
  { id: "renewable", name: "Renewable energy", place: "Central West Orana REZ, NSW", body: "Wind and solar generation that displaces coal-fired power." },
  { id: "waste-recycling", name: "Waste recycling", place: "Illawarra, NSW", body: "Landfill gas capture and organics recycling in the region." },
];
export const BUSINESSES = [
  { abn: "51 824 753 556", name: "Illawarra Coffee Roasters", suburb: "Wollongong", status: "certified", rating: 5, certs: ["Climate Active Carbon Neutral (organisation)", "Plastic-free packaging"], until: "2027-06-30" },
  { abn: "33 102 417 032", name: "Northern Beaches Bakery", suburb: "Thirroul", status: "certified", rating: 4, certs: ["Climate Active Carbon Neutral (product)"], until: "2027-02-28" },
  { abn: "62 991 304 118", name: "Escarpment Electrical", suburb: "Corrimal", status: "certified", rating: 4, certs: ["Clean Energy Council approved retailer"], until: "2026-12-31" },
  { abn: "18 556 203 741", name: "Harbour Fresh Seafood", suburb: "Port Kembla", status: "expired", rating: 3, certs: ["Sustainable seafood (lapsed)"], until: "2026-03-31" },
  { abn: "74 300 129 865", name: "Coastline Builders", suburb: "Figtree", status: "certified", rating: 3, certs: ["Green Star design accredited professional"], until: "2027-09-30" },
  { abn: "29 641 772 503", name: "Kembla Auto Repairs", suburb: "Unanderra", status: "none", rating: 1, certs: [], until: null },
  { abn: "90 145 662 917", name: "Dapto Fresh Grocers", suburb: "Dapto", status: "certified", rating: 4, certs: ["Food waste diverted to compost", "Solar-powered premises"], until: "2027-04-30" },
  { abn: "47 883 019 224", name: "Seacliff Hotel", suburb: "Kiama", status: "pending", rating: 2, certs: ["Application in assessment"], until: null },
  { abn: "56 207 448 391", name: "UniGreen Print Co.", suburb: "North Wollongong", status: "certified", rating: 5, certs: ["FSC chain of custody", "Climate Active Carbon Neutral (organisation)"], until: "2027-11-30" },
  { abn: "11 930 557 208", name: "Shellharbour Marina Cafe", suburb: "Shellharbour", status: "none", rating: 2, certs: [], until: null },
];

// ---------------------------------------------------------------- EcoCommunity
export const EVENTS = [
  { id: "EV-101", title: "Bellambi dune planting", place: "Bellambi Point Reserve", dayOffset: 3, start: "08:30", end: "11:30", capacity: 40, taken: 31, kind: "Planting", bring: "Closed shoes, hat, water bottle" },
  { id: "EV-102", title: "Repair cafe: fix it, don't bin it", place: "Wollongong Library", dayOffset: 5, start: "10:00", end: "13:00", capacity: 25, taken: 25, kind: "Workshop", bring: "Your broken small appliance or clothing" },
  { id: "EV-103", title: "North Beach clean-up", place: "North Beach Pavilion", dayOffset: 6, start: "07:30", end: "09:30", capacity: 60, taken: 22, kind: "Clean-up", bring: "Gloves and bags provided" },
  { id: "EV-104", title: "Home energy efficiency night", place: "Corrimal Community Centre", dayOffset: 9, start: "18:30", end: "20:00", capacity: 50, taken: 18, kind: "Talk", bring: "A recent power bill if you want advice" },
  { id: "EV-105", title: "Escarpment bush regeneration", place: "Mount Keira lookout", dayOffset: 12, start: "09:00", end: "12:00", capacity: 20, taken: 14, kind: "Planting", bring: "Long sleeves, sturdy boots" },
  { id: "EV-106", title: "Kids' worm farm workshop", place: "Figtree Community Garden", dayOffset: 14, start: "10:00", end: "11:30", capacity: 30, taken: 9, kind: "Workshop", bring: "A shoebox-sized container" },
];
export const GARDENS = [
  { id: "GD-1", name: "Figtree Community Garden", suburb: "Figtree", plots: 24, taken: 19, feeMonth: 8 },
  { id: "GD-2", name: "Thirroul Village Garden", suburb: "Thirroul", plots: 16, taken: 16, feeMonth: 10 },
  { id: "GD-3", name: "Wollongong Botanic Garden allotments", suburb: "Keiraville", plots: 40, taken: 28, feeMonth: 12 },
];
export const SKILLS = ["Gardening", "Teaching", "Repairs", "Photography", "Events", "Admin", "Driving", "Cooking", "Coding", "First aid"];
export const OPPORTUNITIES = [
  { id: "VO-1", title: "Bush regeneration crew", org: "Illawarra Landcare", suburb: "Corrimal", skills: ["Gardening"], when: "weekends" },
  { id: "VO-2", title: "Repair cafe fixer", org: "Repair Cafe Wollongong", suburb: "Wollongong", skills: ["Repairs", "Teaching"], when: "weekends" },
  { id: "VO-3", title: "Event photographer", org: "EcoCommunity Action", suburb: "Wollongong", skills: ["Photography", "Events"], when: "weekends" },
  { id: "VO-4", title: "Food rescue driver", org: "OzHarvest Illawarra", suburb: "Unanderra", skills: ["Driving"], when: "weekdays" },
  { id: "VO-5", title: "Community kitchen helper", org: "Illawarra Community Kitchen", suburb: "Fairy Meadow", skills: ["Cooking", "First aid"], when: "weekdays" },
  { id: "VO-6", title: "Website volunteer", org: "Clean Up Wollongong", suburb: "Remote", skills: ["Coding", "Admin"], when: "flexible" },
  { id: "VO-7", title: "School garden mentor", org: "Kids in the Garden", suburb: "Figtree", skills: ["Gardening", "Teaching"], when: "weekdays" },
  { id: "VO-8", title: "Beach clean-up leader", org: "Take 3 for the Sea", suburb: "Thirroul", skills: ["Events", "First aid"], when: "weekends" },
];

// ---------------------------------------------------------------- Rewards
export const REWARDS = [
  { id: "seedlings", name: "Native seedling pack", cost: 150, body: "Six local natives from the Illawarra Grevillea Park nursery" },
  { id: "charge5", name: "$5 charging credit", cost: 250, body: "Applied to your next ChargeNet session" },
  { id: "daypass", name: "Free day transit pass", cost: 300, body: "One day of unlimited bus and train travel" },
  { id: "keepcup", name: "Reusable cup", cost: 400, body: "Collect from Illawarra Coffee Roasters" },
];
