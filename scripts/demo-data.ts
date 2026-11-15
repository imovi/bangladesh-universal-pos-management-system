export const DEMO_CATEGORIES = [
  { name: "Men", subcategories: ["Shirts", "Trousers", "Polos & Tees"] },
  { name: "Women", subcategories: ["Sarees", "Kurtis", "Bottoms"] },
  { name: "Kids", subcategories: ["Boys Wear", "Girls Wear"] },
];

export const DEMO_BRANDS = ["Artisan Classic", "Indigo Craft"];
export const DEMO_COLLECTIONS = ["Summer Fest 2026", "Winter Warmth 2026"];

export interface DemoProductDef {
  name: string;
  sku: string;
  category: string;
  brand: string;
  collection: string;
  priceMinor: number;
  costMinor: number;
  options: { name: string; values: string[] }[];
}

export const DEMO_PRODUCTS: DemoProductDef[] = [
  {
    name: "Oxford Formal Shirt", sku: "M-OXF", category: "Shirts", brand: "Artisan Classic", collection: "Summer Fest 2026",
    priceMinor: 220000, costMinor: 110000, options: [{ name: "Size", values: ["M", "L", "XL"] }, { name: "Color", values: ["White", "Sky Blue"] }],
  },
  {
    name: "Slim Fit Chino Pants", sku: "M-CHN", category: "Trousers", brand: "Indigo Craft", collection: "Summer Fest 2026",
    priceMinor: 280000, costMinor: 140000, options: [{ name: "Size", values: ["30", "32", "34"] }, { name: "Color", values: ["Khaki", "Navy"] }],
  },
  {
    name: "Pique Cotton Polo", sku: "M-POLO", category: "Polos & Tees", brand: "Artisan Classic", collection: "Summer Fest 2026",
    priceMinor: 150000, costMinor: 75000, options: [{ name: "Size", values: ["M", "L", "XL"] }, { name: "Color", values: ["Black", "Maroon"] }],
  },
  {
    name: "Classic Graphic T-Shirt", sku: "M-TEE", category: "Polos & Tees", brand: "Indigo Craft", collection: "Summer Fest 2026",
    priceMinor: 95000, costMinor: 45000, options: [{ name: "Size", values: ["S", "M", "L"] }, { name: "Color", values: ["Olive", "Charcoal"] }],
  },
  {
    name: "Dhakai Jamdani Saree", sku: "W-JAM", category: "Sarees", brand: "Artisan Classic", collection: "Summer Fest 2026",
    priceMinor: 850000, costMinor: 450000, options: [{ name: "Size", values: ["Free Size"] }, { name: "Color", values: ["Crimson", "Royal Blue"] }],
  },
  {
    name: "Embroidered Silk Kurti", sku: "W-KUR", category: "Kurtis", brand: "Artisan Classic", collection: "Summer Fest 2026",
    priceMinor: 320000, costMinor: 160000, options: [{ name: "Size", values: ["M", "L", "XL"] }, { name: "Color", values: ["Teal", "Mustard"] }],
  },
  {
    name: "High-Rise Stretch Denim", sku: "W-DNM", category: "Bottoms", brand: "Indigo Craft", collection: "Summer Fest 2026",
    priceMinor: 350000, costMinor: 175000, options: [{ name: "Size", values: ["28", "30", "32"] }, { name: "Color", values: ["Vintage Blue", "Black"] }],
  },
  {
    name: "Linen Wide-Leg Pants", sku: "W-LIN", category: "Bottoms", brand: "Artisan Classic", collection: "Summer Fest 2026",
    priceMinor: 260000, costMinor: 130000, options: [{ name: "Size", values: ["S", "M", "L"] }, { name: "Color", values: ["Off-White", "Sage"] }],
  },
  {
    name: "Kids Floral Cotton Frock", sku: "K-FRK", category: "Girls Wear", brand: "Indigo Craft", collection: "Summer Fest 2026",
    priceMinor: 140000, costMinor: 65000, options: [{ name: "Size", values: ["4Y", "6Y", "8Y"] }, { name: "Color", values: ["Pink", "Yellow"] }],
  },
  {
    name: "Kids Denim Overall Dungaree", sku: "K-DNG", category: "Boys Wear", brand: "Indigo Craft", collection: "Summer Fest 2026",
    priceMinor: 195000, costMinor: 95000, options: [{ name: "Size", values: ["4Y", "6Y", "8Y"] }, { name: "Color", values: ["Stone Wash"] }],
  },
];

export const DEMO_SUPPLIERS = [
  { name: "Dhaka Textiles & Fabrics Ltd", contactPerson: "Rezaul Karim", phone: "+8801711111111", email: "info@dhakatex.com", leadTimeDays: 7 },
  { name: "Chittagong Garments Accessories", contactPerson: "Mizanur Rahman", phone: "+8801722222222", email: "sales@ctgaccessories.com", leadTimeDays: 5 },
];

export const DEMO_CUSTOMERS = [
  { name: "Tanvir Ahmed", phone: "01712345678", email: "tanvir@example.com" },
  { name: "Nusrat Jahan", phone: "01812345678", email: "nusrat@example.com" },
  { name: "Rahim Chowdhury", phone: "01912345678", email: "rahim@example.com" },
  { name: "Farhana Islam", phone: "01612345678", email: "farhana@example.com" },
  { name: "Kamal Hossain", phone: "01512345678", email: "kamal@example.com" },
];
