import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// 都道府県別ファクト（医療費・要因・疾病）と市町村ランキングを保持。
export default defineSchema({
  prefectures: defineTable({
    name: v.string(),
    // metrics: { per_capita_cost, aging_rate, beds_per_100k, ... dis_diabetes ... }
    metrics: v.any(),
    // costByYear: { "2014": 350.1, ... "2023": 386.7 }
    costByYear: v.any(),
  }).index("by_name", ["name"]),

  municipalities: defineTable({
    name: v.string(),
    value: v.number(), // 国保 1人当たり医療費（円）
  }),

  // AIで生成したインサイト/レポート/スライドの永続保存
  savedOutputs: defineTable({
    kind: v.union(v.literal("insight"), v.literal("report"), v.literal("slides")),
    content: v.string(),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  // 地域要因79項目（市町×指標）。metricsは[{item,label,value}]の配列。
  regionFactors: defineTable({
    pref: v.string(),
    city: v.string(),
    metrics: v.any(),
  }).index("by_city", ["city"]), // ※by_cityは現状未使用。seedRegion.listByPrefはprefで絞るためby_prefに張り替えるのが素直（77件のため実害なし・スキーマ変更はデプロイ反映が必要なので保留）

  // 国保/後期 一人当たり実績医療費（医療費の地域差分析 R5・都道府県）。既存テーブルと混ぜず分離。
  medicalCost: defineTable({
    level: v.union(v.literal("pref"), v.literal("muni")),
    pref: v.string(),
    name: v.string(),
    kokuho: v.number(), // 国保 一人当たり医療費(円)
    kouki: v.number(), // 後期 一人当たり医療費(円)
    koukiKenshin: v.optional(v.number()), // 特定健診受診率(%・全保険者ベース)。※元xlsx「令和5年度都道府県別特定健診受診率」。フィールド名は歴史的経緯（変更はseed再投入が必要）
    tokuteiHoken: v.optional(v.number()), // 特定保健指導 実施率(%)
    year: v.string(),
  }).index("by_level", ["level"]),

  // 全国市町村 × 国保/後期医療費・特定健診/保健指導実施率（R5）。健診は未結合のものはnull。
  muniStats: defineTable({
    pref: v.string(),
    city: v.string(),
    kokuho: v.number(), // 国保 一人当たり医療費（円）
    kouki: v.number(), // 後期 一人当たり医療費（円）
    kenshin: v.union(v.number(), v.null()), // 特定健診実施率(%)
    hoken: v.union(v.number(), v.null()), // 特定保健指導実施率(%)
    year: v.string(),
  }).index("by_pref", ["pref"]),
});
