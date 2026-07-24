import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// 【既知のセキュリティ課題】save/list/remove は公開関数のまま認証チェックがなく、
// ConvexのURLを知っていれば誰でも保存物の閲覧・追加・削除ができる。
// 正しく直すには以下が必要（Convex×WorkOS連携の大掛かりな変更になるため未実施）:
//   1. convex/auth.config.ts を作成し WorkOS をJWTプロバイダとして登録する
//   2. クライアント側を ConvexProvider → ConvexProviderWithAuth に差し替え、
//      WorkOSのアクセストークンをConvexに渡す（ConvexClientProvider.tsx の変更）
//   3. schema の savedOutputs に userId カラムを追加し、
//      各関数で ctx.auth.getUserIdentity() を検証して本人のデータのみ操作を許可する
// 暫定軽減策として save の content にサイズ上限のみ設けている。

const kindValidator = v.union(
  v.literal("insight"),
  v.literal("report"),
  v.literal("slides"),
);

// AI生成物（インサイト/レポート/スライド）をConvexに保存
export const save = mutation({
  args: { kind: kindValidator, content: v.string() },
  handler: async (ctx, { kind, content }) => {
    // 無認証で書き込めるため、せめて巨大データの投入によるストレージ濫用を防ぐ
    // （正規のAI生成物は数千〜数万字。100KBあれば十分）
    if (content.length > 100_000) {
      throw new Error("content が大きすぎます（100,000字まで）");
    }
    return await ctx.db.insert("savedOutputs", {
      kind,
      content,
      createdAt: Date.now(),
    });
  },
});

// 保存済みを新しい順で最大100件返す（全件collectはスケールしないため）
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("savedOutputs")
      .withIndex("by_createdAt")
      .order("desc")
      .take(100);
  },
});

// 保存済みを1件削除
export const remove = mutation({
  args: { id: v.id("savedOutputs") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
