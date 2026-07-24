# e-Stat医療データ分析＋PPTX自動生成アプリ

政府統計ポータル「e-Stat」の医療・人口・介護データをもとに、都道府県別・市町村別の医療費・要因分析を地図とグラフで可視化し、AIによるインサイト生成からPowerPointスライドの自動生成までを行うWebアプリです。

## 主な機能

- 都道府県別の医療費・要因データを地図で色分け表示（山口・奈良・島根は市町村単位でも比較可能）
- 約30項目の指標（高齢化率・入院受療率・疾病別受療率など）を切り替えて表示
- AIが選択したデータからインサイト（分析コメント）を生成
- インサイトをもとに提案レポート（Markdown）を自動生成
- レポートをPowerPointスライド（.pptx）に自動変換

## 必要なもの

- Node.js 18以降
- 以下3つのサービスの無料アカウント（手順3〜5で作成します）
  - WorkOS（ログイン機能）
  - Convex（データベース）
  - fal.ai（AI呼び出し）

## セットアップ手順

上から順番に実行してください。

### 1. リポジトリをクローンする

```bash
git clone https://github.com/abel-works-lab/gaslab-20260725-distribution.git
cd gaslab-20260725-distribution
```

### 2. セットアップコマンドを実行する

```bash
npm run setup
```

このコマンドが `npm install` と `.env.local` の作成を自動で行い、その後2回、下の手順待ちで一時停止します。

### 3. コマンドが止まったら：WorkOSのキーを設定する

1. [dashboard.workos.com](https://dashboard.workos.com) でアカウントを作成する
2. Applicationを新規作成する
3. Redirectsに `http://localhost:3100/callback` を登録する
4. AuthKitを有効化する
5. 表示された `API Key` と `Client ID` をコピーし、開いている `.env.local` に貼り付けて保存する
6. ターミナルに戻ってEnterキーを押す

### 4. 次に止まったら：fal.aiのキーを設定する

1. [fal.ai](https://fal.ai) でアカウントを作成する
2. ダッシュボードで `FAL_KEY` を発行する
3. `.env.local` に貼り付けて保存する
4. ターミナルに戻ってEnterキーを押す

### 5. 自動で開くブラウザでConvexにログインする

1. 開いたページでログインする（新規プロジェクト作成時にリージョンを聞かれたら、どちらでも動作します。迷ったら「US East」でOK）
2. 開発（Dev）デプロイメント側のConvexダッシュボード → Settings → Deploy Keys でキーを発行する（**権限選択は「Select all」推奨**。一部の権限だけ選ぶと、データ投入時に`Unauthorized`エラーになることがあります）
3. `.env.local` に貼り付けて保存する
4. ターミナルに戻ってEnterキーを押す

ここまで進むと、データの投入まで自動で完了します。

**`.env.local`を書き換えた後にコマンドがエラーになった場合**：一度そのコマンドを最初からやり直してください（`npm run setup`をもう一度実行）。動作中のコマンドは起動時に読み込んだ値を使い続けるため、途中でファイルを書き換えても反映されないことがあります。

### 6. アプリを起動する

```bash
npm run dev
```

### 7. ブラウザで開く

```
http://localhost:3100
```

ログイン画面が表示されるので、WorkOSでログインすると地図画面が表示されます。

### 8. Vercelにデプロイする（任意）

ローカルでの動作確認ができたら、インターネット上に公開できます。

1. このリポジトリをGitHub上の自分のアカウントにフォーク、または新規リポジトリとしてpushする
2. [vercel.com](https://vercel.com) でアカウントを作成する
3. 「Add New...」→「Project」から、1のリポジトリをImportする
4. Environment Variablesに、`.env.local`と同じ内容をすべて設定する。**`WORKOS_REDIRECT_URI`だけは例外**で、Vercelが発行するURL（例：`https://<プロジェクト名>.vercel.app/callback`）に変更する
5. 「Deploy」を押す
6. デプロイ完了後に発行されたURLを、WorkOSダッシュボードのRedirectsに追加登録する（ローカル用の`http://localhost:3100/callback`は残したまま、もう1つ追加する）
7. デプロイされたURLを開き、ログインできれば完了

## うまくいかないとき

- **`npm run dev` が `bad option` エラーで止まる**：[nodejs.org](https://nodejs.org/) から最新のLTS版Node.jsを入れ直してください。
- **`unable to verify the first certificate` というエラーが出る**：PowerShellで `$env:NODE_OPTIONS="--use-system-ca"` を実行してから、同じターミナルでもう一度コマンドを実行してください。
- **キーを`.env.local`に貼ってもコマンドが先に進まない**：貼り付けた値の前後に `"` や `'`、余分な空白が入っていないか確認してください。
- **ログイン後にエラーになる**：手順3で登録したRedirect URIが `http://localhost:3100/callback` になっているか確認してください（他のポート番号だとログインが失敗します）。
- **`Cannot read properties of undefined (reading 'split')` というエラーが出る**：同じPCの`localhost`で別のアプリにログインした際のCookieが残っている可能性があります（`localhost`はポート番号を区別せずCookieが共有されるため）。ブラウザのシークレットウィンドウで開き直すか、`localhost`のCookieを削除してください。
- **Convexのデータ投入で`Unauthorized`エラーになる**：Deploy Key発行時の権限選択が不足している可能性があります。Convexダッシュボードで新しくDeploy Keyを発行し直し、今度は「Select all」を選んでください。新しいキーに差し替えたら、`npm run setup`をもう一度実行してください。

手動で1つずつ設定したい場合は `ENV_SETUP.md` を参照してください。

## 技術スタック

Next.js 14 (App Router) / Convex / WorkOS AuthKit / Leaflet・react-leaflet / pptxgenjs / fal.ai経由のClaude

## データについて

`data/` 配下のJSONは、e-Stat APIで取得した政府統計データを都道府県・市町村単位に加工した実データです（個人情報は含みません）。
