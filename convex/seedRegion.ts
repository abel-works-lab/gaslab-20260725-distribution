import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

// 地域要因マスター(山口)を regionFactors テーブルに投入する seed 用 mutation。
// regionFactors のみを対象にし、他テーブル(prefectures/municipalities/savedOutputs)には一切触れない。
// 全削除を伴う破壊的処理のため internalMutation にし、外部クライアントから呼べなくする。
export const seedRegion = internalMutation({
  args: {
    rows: v.array(
      v.object({
        pref: v.string(),
        city: v.string(),
        metrics: v.array(
          v.object({
            item: v.string(),
            label: v.string(),
            value: v.number(),
            year: v.optional(v.union(v.string(), v.null())), // 各指標の実年度
          })
        ),
      })
    ),
  },
  handler: async (ctx, args) => {
    // regionFactors だけ全消去してから入れ直す
    for (const r of await ctx.db.query("regionFactors").collect()) {
      await ctx.db.delete(r._id);
    }
    for (const row of args.rows) {
      await ctx.db.insert("regionFactors", row);
    }
    return { regionFactors: args.rows.length };
  },
});

// 指定都道府県の市町村要因を返す（件数が少ないためcollect+filterで十分）
export const listByPref = query({
  args: { pref: v.string() },
  handler: async (ctx, { pref }) => {
    const all = await ctx.db.query("regionFactors").collect();
    return all.filter((r) => r.pref === pref);
  },
});
