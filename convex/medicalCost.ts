import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

const levelV = v.union(v.literal("pref"), v.literal("muni"));

// 国保/後期 一人当たり実績医療費を投入（冪等: 既存を全削除→投入）。他テーブルには触れない。
// 全削除を伴う破壊的処理のため internalMutation にし、外部クライアントから呼べなくする。
export const seedMedicalCost = internalMutation({
  args: {
    rows: v.array(
      v.object({
        level: levelV,
        pref: v.string(),
        name: v.string(),
        kokuho: v.number(),
        kouki: v.number(),
        // schema 側が optional のため引数も揃えて optional にする
        koukiKenshin: v.optional(v.number()),
        tokuteiHoken: v.optional(v.number()),
        year: v.string(),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    for (const r of await ctx.db.query("medicalCost").collect()) {
      await ctx.db.delete(r._id);
    }
    for (const r of rows) await ctx.db.insert("medicalCost", r);
    return { inserted: rows.length };
  },
});

// 全件返す（47県のみなのでcollectで十分）
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("medicalCost").collect();
  },
});

// 全国市町村統計の投入（冪等: 全削除→投入）
// 全削除を伴う破壊的処理のため internalMutation にし、外部クライアントから呼べなくする。
export const seedMuniStats = internalMutation({
  args: {
    rows: v.array(
      v.object({
        pref: v.string(),
        city: v.string(),
        kokuho: v.number(),
        kouki: v.number(),
        kenshin: v.union(v.number(), v.null()),
        hoken: v.union(v.number(), v.null()),
        year: v.string(),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    for (const r of await ctx.db.query("muniStats").collect()) {
      await ctx.db.delete(r._id);
    }
    for (const r of rows) await ctx.db.insert("muniStats", r);
    return { inserted: rows.length };
  },
});

// 全国市町村統計を返す（ランキング用・1912件固定）
export const muniAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("muniStats").collect();
  },
});

// 指定都道府県の市町村統計を返す
export const muniByPref = query({
  args: { pref: v.string() },
  handler: async (ctx, { pref }) => {
    return await ctx.db
      .query("muniStats")
      .withIndex("by_pref", (q) => q.eq("pref", pref))
      .collect();
  },
});
