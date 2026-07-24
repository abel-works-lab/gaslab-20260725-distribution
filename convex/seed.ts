import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// 既存を全消去してから投入する seed 用 mutation（scripts/seed.mjs から呼ぶ）。
// 全削除を伴う破壊的処理のため internalMutation にし、外部クライアントから呼べなくする
// （公開 mutation だと誰でも空配列で呼んで本番データを消せてしまう）。
export const seed = internalMutation({
  args: {
    prefectures: v.array(
      v.object({ name: v.string(), metrics: v.any(), costByYear: v.any() })
    ),
    municipalities: v.array(
      v.object({ name: v.string(), value: v.number() })
    ),
  },
  handler: async (ctx, args) => {
    for (const p of await ctx.db.query("prefectures").collect()) {
      await ctx.db.delete(p._id);
    }
    for (const m of await ctx.db.query("municipalities").collect()) {
      await ctx.db.delete(m._id);
    }
    for (const p of args.prefectures) await ctx.db.insert("prefectures", p);
    for (const m of args.municipalities) await ctx.db.insert("municipalities", m);
    return {
      prefectures: args.prefectures.length,
      municipalities: args.municipalities.length,
    };
  },
});
