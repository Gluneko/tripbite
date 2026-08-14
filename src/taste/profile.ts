/**
 * 口味画像计算与候选匹配。纯代码、确定性：同一份数据永远算出同一份画像，
 * 匹配打分可回归测试。数据来自 data/taste/reviews.json（大众点评人工转录）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Review {
  name: string;
  city: string;
  category: "餐饮" | "非餐饮";
  cuisine: string;
  rating: number;
  date: string;
  pros: string[];
  cons: string[];
  note: string;
}

export interface TasteProfile {
  sampleSize: number;
  cities: string[];
  /** 菜系 → 就餐次数与均分（≥4.5 为强偏好） */
  cuisineAffinity: Record<string, { count: number; avgRating: number }>;
  topCuisines: string[];
  /** 高频正面信号（出现 ≥2 次），带证据条数 */
  loves: { tag: string; count: number; evidence: string[] }[];
  /** 雷点信号，带证据 */
  dealbreakers: { tag: string; count: number; evidence: string[] }[];
  traits: {
    beefLover: boolean;
    queueAverse: boolean;
    valueSensitive: boolean;
    stabilitySeeker: boolean;
    spiceTolerance: "低" | "中等" | "高";
    fancyRestaurantSkeptic: boolean;
  };
  summary: string;
}

const BEEF_CUISINES = /和牛|牛排|牛肉|烧肉|寿喜烧/;

export function loadReviews(): Review[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../data/taste/reviews.json");
  const raw = JSON.parse(readFileSync(path, "utf-8")) as { reviews: Review[] };
  return raw.reviews;
}

export function buildProfile(reviews: Review[]): TasteProfile {
  const food = reviews.filter((r) => r.category === "餐饮");

  const cuisineAffinity: TasteProfile["cuisineAffinity"] = {};
  for (const r of food) {
    const c = (cuisineAffinity[r.cuisine] ??= { count: 0, avgRating: 0 });
    c.avgRating = (c.avgRating * c.count + r.rating) / (c.count + 1);
    c.count++;
  }
  for (const c of Object.values(cuisineAffinity))
    c.avgRating = Math.round(c.avgRating * 100) / 100;

  const topCuisines = Object.entries(cuisineAffinity)
    .filter(([, v]) => v.avgRating >= 4.5)
    .sort((a, b) => b[1].count - a[1].count || b[1].avgRating - a[1].avgRating)
    .map(([k]) => k);

  const tally = (pick: (r: Review) => string[]) => {
    const map = new Map<string, string[]>();
    for (const r of food) {
      for (const tag of pick(r)) {
        const list = map.get(tag) ?? [];
        list.push(`${r.name}（${r.rating}星）`);
        map.set(tag, list);
      }
    }
    return [...map.entries()]
      .map(([tag, evidence]) => ({ tag, count: evidence.length, evidence }))
      .sort((a, b) => b.count - a.count);
  };

  const loves = tally((r) => r.pros).filter((x) => x.count >= 2);
  const dealbreakers = tally((r) => r.cons);

  // 牛肉偏好：牛肉主题店/牛肉 pros 且评分 ≥4.5 的条目数
  const beefEvidence = food.filter(
    (r) =>
      r.rating >= 4.5 && (BEEF_CUISINES.test(r.cuisine) || r.pros.includes("牛肉"))
  );

  // 辣度：川湘菜均分高 → 能吃辣；但"太麻/太油腻"出现 → 反感重麻重油 → 判中等
  const spicy = food.filter((r) => /川菜|湘菜/.test(r.cuisine));
  const spicyAvg = spicy.length
    ? spicy.reduce((a, r) => a + r.rating, 0) / spicy.length
    : 0;
  const dislikesHeavyMala = food.some(
    (r) => r.cons.includes("太麻") || r.cons.includes("太油腻")
  );
  const spiceTolerance: TasteProfile["traits"]["spiceTolerance"] =
    spicyAvg >= 4.5 && !dislikesHeavyMala ? "高" : spicyAvg >= 4 ? "中等" : "低";

  const countCon = (tag: string) =>
    dealbreakers.find((d) => d.tag === tag)?.count ?? 0;
  const countLove = (tag: string) => loves.find((d) => d.tag === tag)?.count ?? 0;

  const traits = {
    beefLover: beefEvidence.length >= 3,
    queueAverse: countCon("排队久") >= 2 || countLove("不用排队") >= 2,
    valueSensitive: countCon("性价比低") + countCon("高端不值") + countCon("分量虚") >= 2,
    stabilitySeeker: countLove("出品稳定") + countLove("复购") >= 3,
    spiceTolerance,
    fancyRestaurantSkeptic:
      food.filter((r) => r.rating <= 3 && /西餐|意大利/.test(r.cuisine)).length >= 2,
  };

  const summary = [
    traits.beefLover
      ? `牛肉重度爱好者（${beefEvidence.length} 家牛肉主题店 ≥4.5 星，常以"泉市"作对标）`
      : "",
    `菜系口味开放（高分覆盖：${topCuisines.slice(0, 6).join("、")}）`,
    `辣度耐受${spiceTolerance}，反感过麻过油`,
    traits.stabilitySeeker ? "重视出品稳定与复购价值，胜过猎奇" : "",
    traits.queueAverse ? "强烈排队厌恶——「口味不错但不值得排队」是原话" : "",
    traits.valueSensitive ? "性价比敏感：警惕正价虚高、分量虚标" : "",
    traits.fancyRestaurantSkeptic ? "对高端西餐/网红漂亮饭持怀疑，需口味撑住溢价" : "",
    "加分项：现炒、食材新鲜、有特色单品、环境开阔采光好、健康选项",
  ]
    .filter(Boolean)
    .join("；");

  return {
    sampleSize: food.length,
    cities: [...new Set(food.map((r) => r.city))],
    cuisineAffinity,
    topCuisines,
    loves,
    dealbreakers,
    traits,
    summary,
  };
}

// ---------- 候选匹配 ----------

export interface Candidate {
  name: string;
  cuisine?: string;
  /** 高德/检索得到的描述、标签、推荐菜等自由文本 */
  description?: string;
  avgPrice?: number;
  rating?: number;
}

export interface MatchResult {
  name: string;
  score: number;
  verdict: "强烈推荐" | "合适" | "一般" | "不推荐";
  reasons: string[];
}

const LOVE_KEYWORDS: { pattern: RegExp; reason: string; weight: number }[] = [
  { pattern: /牛肉|和牛|牛排|潮汕牛|鲜切牛/, reason: "牛肉主题——画像中最强的正向信号", weight: 10 },
  { pattern: /现炒|锅气/, reason: "现炒是明确加分项（费大厨、关东小磨证据）", weight: 6 },
  { pattern: /新鲜|现杀|现熬/, reason: "重视食材新鲜度", weight: 5 },
  { pattern: /老店|稳定|连锁老牌/, reason: "偏好出品稳定可复购的店", weight: 4 },
  { pattern: /鸳鸯锅|微辣|辣度可选/, reason: "辣度中等耐受，可调辣度友好", weight: 4 },
  { pattern: /分量足|量大/, reason: "分量实在是加分项", weight: 3 },
  { pattern: /包厢/, reason: "多人聚餐时偏好包厢", weight: 2 },
];

const AVOID_KEYWORDS: { pattern: RegExp; reason: string; weight: number }[] = [
  { pattern: /网红|打卡|排队\d*小时|需排队|等位/, reason: "排队厌恶：「不值得排队」是原话", weight: 8 },
  { pattern: /重麻|特麻|麻辣重油|油腻/, reason: "反感过麻过油（新沸腾鱼乡教训）", weight: 7 },
  { pattern: /预制/, reason: "偏好现做，预制感是雷点", weight: 6 },
  { pattern: /人均[3-9]\d{2,}/, reason: "高端溢价需口味撑住，默认怀疑", weight: 4 },
];

export function matchCandidates(
  profile: TasteProfile,
  candidates: Candidate[]
): MatchResult[] {
  return candidates.map((c) => {
    let score = 50;
    const reasons: string[] = [];
    const text = `${c.name} ${c.cuisine ?? ""} ${c.description ?? ""}`;

    // 菜系亲和度
    if (c.cuisine) {
      const hit = Object.entries(profile.cuisineAffinity).find(
        ([k]) => c.cuisine!.includes(k) || k.includes(c.cuisine!)
      );
      if (hit) {
        const [k, v] = hit;
        if (v.avgRating >= 4.5) {
          score += 12;
          reasons.push(`「${k}」是画像高分菜系（${v.count} 次就餐均分 ${v.avgRating}）`);
        } else if (v.avgRating <= 3.5) {
          score -= 10;
          reasons.push(`「${k}」在画像中评分偏低（均分 ${v.avgRating}），谨慎推荐`);
        }
      }
    }

    for (const kw of LOVE_KEYWORDS) {
      if (kw.pattern.test(text)) {
        score += kw.weight;
        reasons.push(kw.reason);
      }
    }
    for (const kw of AVOID_KEYWORDS) {
      if (kw.pattern.test(text)) {
        score -= kw.weight;
        reasons.push(`⚠ ${kw.reason}`);
      }
    }

    // 公共评分质量底线
    if (c.rating != null) {
      if (c.rating >= 4.5) score += 6;
      else if (c.rating < 4.0) {
        score -= 15;
        reasons.push(`⚠ 高德评分 ${c.rating} 低于 4.0 质量底线`);
      }
    }
    // 价位舒适区（画像主力人均 ~40-160 元）
    if (c.avgPrice != null) {
      if (c.avgPrice >= 40 && c.avgPrice <= 160) score += 4;
      else if (c.avgPrice > 300 && profile.traits.fancyRestaurantSkeptic) {
        score -= 6;
        reasons.push("⚠ 高客单价：画像对高端溢价持怀疑（柏悦西餐 3 星前科）");
      }
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const verdict =
      score >= 75 ? "强烈推荐" : score >= 60 ? "合适" : score >= 45 ? "一般" : "不推荐";
    if (reasons.length === 0) reasons.push("画像无强信号命中，按公共评分与常规质量判断");
    return { name: c.name, score, verdict, reasons };
  });
}
