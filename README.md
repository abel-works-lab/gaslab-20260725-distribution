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
- 以下3つのサービスの無料アカウント（手順の中で作成します）
  - WorkOS（ログイン機能）
  - Convex（データベース）
  - fal.ai（AI呼び出し）

## セットアップ手順

上から順番に実行してください。詰まったときは、末尾の「うまくいかないとき」を確認してください。

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

### 3. 自動で開くブラウザでWorkOSのキーを設定する

コマンドが自動で `dashboard.workos.com` を開きます。

1. アカウントを作成する
2. Applicationを新規作成する
3. Redirectsに `http://localhost:3100/callback` を登録する
4. AuthKitを有効化する
5. 表示された `API Key` と `Client ID` をコピーし、開いている `.env.local` に貼り付けて保存する
6. ターミナルに戻ってEnterキーを押す

### 4. 自動で開くブラウザでfal.aiのキーを設定する

コマンドが自動で `fal.ai` を開きます。

1. アカウントを作成する
2. ダッシュボードで `FAL_KEY` を発行する
3. `.env.local` に貼り付けて保存する
4. ターミナルに戻ってEnterキーを押す

### 5. 自動で開くブラウザでConvexにログインする

1. 開いたページでログインする
2. 開発（Dev）デプロイメント側のConvexダッシュボード → Settings → Deploy Keys でキーを発行する
3. `.env.local` に貼り付けて保存する
4. ターミナルに戻ってEnterキーを押す

ここまで進むと、データの投入まで自動で完了します。

### 6. Vercelにデプロイする

1. このリポジトリをGitHub上の自分のアカウントにフォーク、または新規リポジトリとしてpushする
2. [vercel.com](https://vercel.com) でアカウントを作成する
3. 「Add New...」→「Project」から、1のリポジトリをImportする
4. Environment Variablesに `.env.local` の中身をすべて貼り付ける
5. `WORKOS_REDIRECT_URI` の値だけを、Vercelが発行するURL（例：`https://<プロジェクト名>.vercel.app/callback`）に書き換える
6. 「Deploy」を押す
7. デプロイ完了後、発行されたURLをWorkOSダッシュボードのRedirectsに追加登録する（`http://localhost:3100/callback` は残したまま、もう1つ追加する）
8. デプロイされたURLを開き、ログインできれば完了

## うまくいかないとき

### セットアップ中（手順1〜5）

- **`npm run setup` が `bad option` エラーで止まる**：[nodejs.org](https://nodejs.org/) から最新のLTS版Node.jsを入れ直してください。
- **`unable to verify the first certificate` というエラーが出る**：PowerShellで `$env:NODE_OPTIONS="--use-system-ca"` を実行してから、同じターミナルでもう一度コマンドを実行してください。
- **キーを`.env.local`に貼ってもコマンドが先に進まない**：貼り付けた値の前後に `"` や `'`、余分な空白が入っていないか確認してください。
- **`.env.local`を書き換えた後にエラーになる**：一度そのコマンドを最初からやり直してください（`npm run setup`をもう一度実行）。動作中のコマンドは起動時に読み込んだ値を使い続けるため、途中でファイルを書き換えても反映されないことがあります。
- **手順5で、Convexの新規プロジェクト作成時にリージョン（US East / Europe）を聞かれる**：どちらでも動作します。迷ったら「US East」を選んでください。
- **手順5で、Deploy Key発行時に権限（Permissions）を選ぶ画面が出る**：「Select all」を選んでください。一部の権限だけ選ぶと、データ投入時に`Unauthorized`エラーになることがあります。すでになって場合は、Deploy Keyを新しく発行し直し（今度はSelect all）、`.env.local`を新しい値に差し替えてから`npm run setup`をもう一度実行してください。

### Vercelデプロイ中（手順6）

- **Environment Variablesの入力欄に、まとめて貼り付けたい**：「Key」の入力欄に、`.env.local`の中身をそのまま貼り付けると、複数の環境変数に自動で分解されます（1個ずつ手入力する必要はありません）。
- **値を貼り付けても反映されないように見える**：反映に少し時間がかかることがあります。連打・連続貼り付けをすると同じ値が重複して入ってしまうので、一度貼り付けたら少し待って、内容を確認してから次に進んでください。
- **`WORKOS_REDIRECT_URI`をなぜ変える必要があるのか**：ログイン後にWorkOSが「どこに戻すか」は、事前に登録したURLでしか許可されません。`.env.local`には手順3で`http://localhost:3100/callback`が自動設定されていますが、Vercel上ではアプリが別の場所（Vercelのサーバー）で動くため、戻り先のURLも変える必要があります。
- **ログイン後にエラーになる**：Environment VariablesでVercel用に書き換えた`WORKOS_REDIRECT_URI`が、WorkOSダッシュボードのRedirectsにも登録されているか確認してください（登録されていないURLへの戻りは拒否されます）。

手動で1つずつ設定したい場合は `ENV_SETUP.md` を参照してください。

## 技術スタック

Next.js 14 (App Router) / Convex / WorkOS AuthKit / Leaflet・react-leaflet / pptxgenjs / fal.ai経由のClaude

## データについて

`data/` 配下のJSONは、e-Stat APIで取得した政府統計データを都道府県・市町村単位に加工した実データです（個人情報は含みません）。

## （参考）e-Stat APIとMCPサーバーを自分で構築する

このアプリの元データがどう取得されたか、同じ方法を自分のPCでも試せます。**このリポジトリとは別の、新しい空のフォルダ**で行ってください（環境変数ファイルの名前はこのリポジトリと同じ`.env.local`ですが、フォルダが違うので別ファイルです）。

1. [e-Stat公式サイト](https://www.e-stat.go.jp/api/)でアカウント登録し、マイページからAPIキーを発行する（無料・5分程度）
2. 新しい空のフォルダを作り、Python仮想環境（venv）を作る

```bash
mkdir estat-mcp-server && cd estat-mcp-server
python -m venv venv
```

3. 仮想環境を有効化する（PC全体のPython環境を汚さないため。**この手順を飛ばして`pip install`すると、他のPythonプロジェクトのパッケージが意図せず書き換わることがあります**）

- Windows（PowerShell）：`.\venv\Scripts\Activate.ps1`
- Mac/Linux：`source venv/bin/activate`

ターミナルの行頭に `(venv)` と表示されれば成功です。

4. `.env.local`の雛形を用意する

```bash
pip install fastmcp
echo 'ESTAT_API_KEY=' > .env.local
```

5. 作成された `.env.local` ファイルをエディタで開き、`ESTAT_API_KEY=` の後ろに手順1で取得したキーを貼り付けて保存する（**コマンドにキーを直接書かない**。ターミナルの履歴にキーが平文で残ってしまうため）
6. 保存できたら、`(venv)` が表示されたままの同じターミナルで以下を実行する

```bash
claude -p --dangerously-skip-permissions "e-Stat APIを使ってMCPサーバーを作ってください。確認や質問はせず、必要な調査は自動的に行った上で、最後まで実装を完了してください。
要件：
- 言語：Python
- FastMCPライブラリを使う
- APIキーは .env.local の ESTAT_API_KEY から読む
- 以下の4つの機能を実装してください：
  1. キーワードで統計を検索する機能
  2. 統計IDを指定してデータを取得する機能
  3. ローカルに保存されたCSVファイルの一覧を表示する機能
  4. ローカルのCSVファイルを読み込む機能
- あわせて .mcp.json もプロジェクトフォルダのルートに作成してください（このvenv環境のPythonを使うようcommandを設定してください）"
```

これで `server.py`（MCPサーバー本体）と `.mcp.json`（Claude Codeが接続するための設定ファイル）が生成されます。次回Claude Codeを起動すると自動で接続され、「e-Statで◯◯のデータを探して」と頼むだけでデータを取得できるようになります。

- **`-p`は1回限りの非対話モード**：途中で確認や質問をされても返信できず、そこで処理が止まります。もしファイルが何も生成されずに終わっていたら（`ls`で確認）、同じコマンドをもう一度実行してください。

- `--dangerously-skip-permissions` は確認プロンプトを省略するフラグです。**信頼できるまっさらなプロジェクトフォルダでのみ**使ってください。
- 都度確認しながら進めたい場合は、`-p` を付けずに `claude` だけを実行し、対話画面でプロンプトを貼り付けて実行してください。
