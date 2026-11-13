/**
 * 用詞對照表：使用者（或 ERP 的會計科目）怎麼說 → 官方係數的名稱裡找什麼。
 *
 * 這是本服務整理的對照，不是官方資料。它只用來「找候選」，絕不用來替使用者選定係數：
 * 「塑膠原料」對到聚丙烯、聚乙烯、聚氯乙烯……哪一個才對，只有使用者知道。
 *
 * 規則：keyword 必須確實出現在已收錄係數的名稱裡。產品碳足跡的名稱來自環境部的即時資料，
 * 離線測試看不到，所以用 `npm run check-concepts` 對跑著的服務檢查每個 keyword 都找得到係數。
 * selectors 的順序就是候選的排序。
 */
import type { Category } from "./types";

export interface Selector {
  category: Category;
  /** 係數名稱需包含的字。不給就是該類別全部。 */
  keyword?: string;
  /** 概括用的字（「紙」「鋼」）：只在描述沒有點名更具體的品項時才用。 */
  broad?: boolean;
}

export interface Concept {
  id: string;
  label: string;
  /** 使用者的說法。出現在描述裡就算符合（不分大小寫）。 */
  terms: string[];
  selectors: Selector[];
}

const footprint = (...keywords: string[]): Selector[] => keywords.map((keyword) => ({ category: "product_footprint", keyword }));
const broad = (keyword: string): Selector => ({ category: "product_footprint", keyword, broad: true });

export const CONCEPTS: Concept[] = [
  {
    id: "electricity", label: "購入電力",
    terms: ["電費", "水電費", "電力", "用電", "電度", "electricity", "power bill"],
    selectors: [{ category: "electricity" }, ...footprint("電力碳足跡")],
  },
  {
    id: "water", label: "自來水",
    terms: ["水費", "水電費", "自來水", "用水", "tap water", "water bill"],
    selectors: [{ category: "water" }, ...footprint("自來水")],
  },
  {
    id: "gasoline", label: "汽油",
    terms: ["汽油", "加油", "油料費", "油資", "無鉛", "gasoline", "petrol"],
    selectors: [{ category: "fuel_combustion", keyword: "汽油" }, ...footprint("車用汽油")],
  },
  {
    id: "diesel", label: "柴油",
    terms: ["柴油", "油料費", "油資", "diesel"],
    selectors: [{ category: "fuel_combustion", keyword: "柴油" }, ...footprint("柴油")],
  },
  {
    id: "natural-gas", label: "天然氣",
    terms: ["天然氣", "瓦斯", "natural gas"],
    selectors: [{ category: "fuel_combustion", keyword: "天然氣" }, ...footprint("天然氣")],
  },
  {
    id: "lpg", label: "液化石油氣",
    terms: ["液化石油氣", "桶裝瓦斯", "瓦斯", "lpg"],
    selectors: [{ category: "fuel_combustion", keyword: "液化石油氣" }, ...footprint("液化石油氣")],
  },
  {
    id: "fuel-oil", label: "燃料油",
    terms: ["燃料油", "重油", "fuel oil"],
    selectors: [{ category: "fuel_combustion", keyword: "燃料油" }, ...footprint("燃料油")],
  },
  {
    id: "plastic", label: "塑膠原料",
    terms: ["塑膠原料", "塑膠粒", "塑膠", "塑料", "plastic"],
    selectors: [...footprint("聚丙烯", "聚乙烯", "聚氯乙烯", "聚苯乙烯", "聚對苯二甲酸", "聚碳酸酯", "PET", "ABS"), broad("塑膠")],
  },
  { id: "steel", label: "鋼鐵", terms: ["鋼材", "鋼鐵", "鋼筋", "不鏽鋼", "steel"], selectors: [...footprint("鋼筋", "鋼胚", "不鏽鋼"), broad("鋼")] },
  { id: "paper", label: "紙", terms: ["紙張", "用紙", "影印紙", "衛生紙", "paper"], selectors: [...footprint("影印紙", "衛生紙"), broad("紙")] },
  { id: "packaging", label: "包裝材料", terms: ["包材", "包裝", "紙箱", "packaging"], selectors: footprint("紙箱", "瓦楞", "膠帶", "鋁箔") },
  { id: "cement", label: "水泥與混凝土", terms: ["水泥", "混凝土", "瀝青", "cement", "concrete"], selectors: footprint("水泥", "混凝土", "瀝青") },
  { id: "aluminium", label: "鋁", terms: ["鋁材", "鋁", "aluminium", "aluminum"], selectors: footprint("鋁") },
  { id: "glass", label: "玻璃", terms: ["玻璃", "glass"], selectors: footprint("玻璃") },
  { id: "copper", label: "銅", terms: ["銅材", "銅", "copper"], selectors: footprint("銅") },
  { id: "freight", label: "貨物運輸", terms: ["貨運", "運費", "物流", "運輸", "freight", "shipping"], selectors: [...footprint("貨車", "海運貨物", "鐵路"), broad("運輸")] },
  { id: "refrigerant", label: "冷媒", terms: ["冷媒", "冷氣", "空調", "冰水主機", "冰水機", "冷凍", "refrigerant", "air conditioning"], selectors: [{ category: "refrigerant" }] },
  { id: "waste", label: "廢棄物處理", terms: ["廢棄物", "垃圾", "清運", "waste"], selectors: footprint("廢棄物", "焚化", "掩埋") },
];

/** 描述裡提到了哪些概念。 */
export function conceptsIn(description: string): Concept[] {
  const text = description.toLowerCase();
  return CONCEPTS.filter((c) => c.terms.some((t) => text.includes(t.toLowerCase())));
}

/**
 * 這段描述該用概念裡的哪些 selector。
 * 描述已經點名具體品項（「影印紙」「鋼筋」）時只取那個品項，否則「影印紙」會連衛生紙一起列出來；
 * 只說了概括的詞（「紙張」「塑膠原料」）才展開成整個概念。
 */
export function selectorsFor(concept: Concept, description: string): Selector[] {
  const text = description.toLowerCase();
  const named = concept.selectors.filter((s) => s.keyword && !s.broad && text.includes(s.keyword.toLowerCase()));
  return named.length ? named : concept.selectors;
}

/** 給字面搜尋用：這個查詢可以改查哪些官方名稱裡的字。 */
export function relatedTerms(query: string): string[] {
  const text = query.toLowerCase();
  const out = new Set<string>();
  for (const c of conceptsIn(query)) {
    for (const s of c.selectors) if (s.keyword && !text.includes(s.keyword.toLowerCase())) out.add(s.keyword);
  }
  return [...out];
}
