import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildProfile, loadReviews, matchCandidates } from "./profile.js";

const profile = buildProfile(loadReviews());

test("profile: 非餐饮条目被过滤，样本量与城市正确", () => {
  assert.ok(profile.sampleSize >= 25);
  assert.ok(profile.cities.includes("杭州"));
  assert.ok(profile.cities.includes("贵阳"));
  // 健身/按摩/理发不进画像
  assert.ok(!Object.keys(profile.cuisineAffinity).includes("健身"));
});

test("profile: 牛肉偏好、排队厌恶、出品稳定寻求者成立", () => {
  assert.equal(profile.traits.beefLover, true);
  assert.equal(profile.traits.queueAverse, true);
  assert.equal(profile.traits.stabilitySeeker, true);
});

test("profile: 辣度中等（湘川高分但反感过麻过油）", () => {
  assert.equal(profile.traits.spiceTolerance, "中等");
});

test("profile: 雷点带证据（太麻的证据是新沸腾鱼乡）", () => {
  const mala = profile.dealbreakers.find((d) => d.tag === "太麻");
  assert.ok(mala);
  assert.ok(mala!.evidence.some((e) => e.includes("新沸腾鱼乡")));
});

test("match: 潮汕牛肉火锅 显著高于 需排队的网红日式简餐", () => {
  const [beef, queue] = matchCandidates(profile, [
    {
      name: "某某鲜牛肉火锅",
      cuisine: "潮汕牛肉火锅",
      description: "鲜切牛肉现杀直送，牛骨清汤锅底",
      avgPrice: 110,
      rating: 4.6,
    },
    {
      name: "某网红牛排饭",
      cuisine: "日式简餐",
      description: "网红打卡店，饭点需排队等位一小时",
      avgPrice: 80,
      rating: 4.2,
    },
  ]);
  assert.ok(beef!.score - queue!.score >= 20, `${beef!.score} vs ${queue!.score}`);
  assert.equal(beef!.verdict === "强烈推荐" || beef!.verdict === "合适", true);
  assert.ok(beef!.reasons.some((r) => r.includes("牛肉")));
  assert.ok(queue!.reasons.some((r) => r.includes("排队")));
});

test("match: 低于 4.0 的高德评分触发质量底线扣分", () => {
  const [r] = matchCandidates(profile, [
    { name: "评分堪忧餐厅", cuisine: "川菜", rating: 3.6 },
  ]);
  assert.ok(r!.reasons.some((x) => x.includes("质量底线")));
});

test("match: 打分确定性——同输入两次结果一致", () => {
  const input = [{ name: "A店", cuisine: "云南菜", description: "菌子火锅", rating: 4.5 }];
  const a = matchCandidates(profile, input);
  const b = matchCandidates(profile, input);
  assert.deepEqual(a, b);
});
