import { query } from "./_generated/server";

// 47都道府県のファクトを全件返す（指標・年次込み）。
export const listPrefectures = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("prefectures").collect();
  },
});

// 市町村を1人当たり医療費の降順で返す。
export const listMunicipalities = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("municipalities").collect();
    return all.sort((a, b) => b.value - a.value);
  },
});
