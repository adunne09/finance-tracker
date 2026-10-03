export const categories = {
  housing: "Housing",
  utilities: "Utilities & communications",
  groceries: "Groceries",
  dining: "Dining & drinks",
  transportation: "Transportation",
  travel: "Travel",
  shopping: "Shopping",
  entertainment: "Entertainment & recreation",
  health: "Health & fitness",
  personal_care: "Personal care",
  software: "Software & digital services",
  memberships: "Media & memberships",
  insurance: "Insurance",
  taxes: "Taxes",
  professional: "Professional & administrative services",
  education: "Education",
  gifts: "Gifts & donations",
  financial: "Financial fees & interest",
  uncategorized: "Uncategorized / mixed purchases",
};

export type Category = keyof typeof categories;

export const transactionTypes = {
  expense: "Expense",
  refund: "Refund / reversal",
  income: "Income",
  reimbursement: "Reimbursement",
  transfer: "Internal transfer",
  card_payment: "Credit-card payment",
  reward: "Rewards / statement credit",
  verification: "Account verification",
  unknown: "Unknown cash movement",
};

export type TransactionType = keyof typeof transactionTypes;

export const categoryCriteria = {
  housing: "Residential rent and housing payment service fees; not hotels.",
  utilities:
    "Electricity, gas utilities, trash, mobile telephone, home internet.",
  groceries:
    "Grocery merchants, grocery delivery, meal kits; not restaurants. General retailers and warehouse clubs are shopping unless groceries are explicit.",
  dining:
    "Restaurants, coffee, takeout, food delivery, bars, liquor stores, venue food concessions; including during trips.",
  transportation:
    "Rideshare explicitly identified as trips, transit, scooters, fuel, parking, maintenance, vehicle registration; not flights.",
  travel:
    "Flights, lodging, rental vehicles, travel connectivity; not dining or entertainment while traveling.",
  shopping:
    "General retail, warehouse clubs, marketplace goods, clothing, electronics, home goods. Amazon/Target/Costco goods default here; do not guess item details.",
  entertainment:
    "Event tickets, museums, attractions, ski passes, recreational activities; not food concessions.",
  health: "Medical services, pharmacy, vision, gyms, fitness programs.",
  personal_care:
    "Haircuts, salons, beauty products, skincare, beauty services; not medical care.",
  software:
    "AI tools, hosting, productivity software, apps; Apple billing alone does not establish the product.",
  memberships:
    "Streaming video/music and retail membership fees, including Prime/Costco; not marketplace goods.",
  insurance: "Auto, jewelry, or other insurance premiums.",
  taxes: "Payments of federal/state/local taxes; not tax-preparation fees.",
  professional:
    "Legal, accounting/tax preparation, immigration, business filings, administrative services. Do not infer business purpose.",
  education:
    "Classes, tuition, language learning, courses and educational instruction.",
  gifts:
    "Explicit charitable contributions or confirmed gifts; not unknown person-to-person transfers.",
  financial:
    "Bank fees, credit-card annual fees, international transaction fees, borrowing interest; not card payments.",
  uncategorized:
    "Insufficient merchant/product evidence, Apple billing without a product, unidentified payment processors, non-purchase movements, or no matching category.",
};
