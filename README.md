# HTML Viewer & Search（GitHub Pages 完全静的 SPA 版）

Google ドライブ上の指定フォルダ内にある HTML ファイル（`.html` / `.htm` / `text/html`）を一覧表示・全文検索・安全にプレビュー表示する、サーバーレス静的 Web アプリケーションです。

Google Apps Script（GAS）バックエンドを使用せず、ブラウザから **Google Identity Services (GIS)**、**Google Picker API**、**Google Drive API v3** へ直接通信することで、GitHub Pages のみでゼロ運用コストで稼働します。

---

## 1. 主な機能

- **Google OAuth 2.0 認証（最小権限）**: 閲覧者自身の Google アカウントでサインインし、`https://www.googleapis.com/auth/drive.readonly`（読み取り専用）スコープのみを使用します。
- **フォルダ選択（Google Picker & 手動入力）**: Google Picker（共有ドライブ対応）または手動フォルダ ID / Drive URL 入力モーダルによりフォルダを切り替えられます。
- **HTML ファイル一覧・全文検索**: 指定フォルダ直下の HTML ファイルを更新日時降順で表示し、ファイル名および本文テキスト（`fullText`）の部分一致検索（400ms デバウンス付き）を実行できます。
- **レスポンシブ 2 ペインプレビュー**: サンドボックス化 `<iframe>`（`srcdoc`）による安全なプレビュー表示と再読込、PC 2 ペイン / モバイル画面切り替えに対応しています。
- **ディープリンク共有**: `?folderId=<ID>` または `?f=<ID>` を URL に付与してアクセスすることで、特定のフォルダを直接開けます。
- **ハイブリッド設定管理（`config.js` + ブラウザ設定モーダル）**: `config.js` で既定値を配布できるほか、ブラウザ上の「GCP 接続設定」モーダルから各項目の設定・上書き保存・初期設定リセットが行えます。

---

## 2. ファイル構成

```text
HttpViewer-app/
├── .nojekyll                 # GitHub Pages 上で Jekyll 処理を無効化する空ファイル
├── .gitignore
├── index.html                # メイン画面・レスポンシブ 2 ペイン UI・モーダル群
├── config.js                 # ハイブリッド設定の初期値テンプレート（APP_DEFAULT_CONFIG）
├── js/
│   ├── storage.js            # SafeStorage（localStorage 例外遮断ラッパー）およびキー定数
│   ├── folder-resolver.js    # フォルダ ID 抽出・検証・初期フォルダ解決（URL > localStorage > Default）
│   ├── config.js             # AppConfigProvider（config.js と localStorage の統合解決）
│   ├── auth.js               # AuthService（GIS Token Client 制御・メモリ限定トークン管理）
│   ├── drive-api.js          # DriveApiClient（Drive API v3 直接通信・ページング・エラー分類）
│   ├── picker.js             # PickerService（Google Picker 制御・共有ドライブ対応・フォールバック）
│   └── app.js                # AppStateController（画面状態調停・401再認証復帰・自己修復）
└── tests/
    ├── run_tests.js          # 単体・結合テストスイート
    └── adversarial_tests.js  # 敵対的・セキュリティ・境界値テストスイート
```

---

## 3. Google Cloud (GCP) セットアップ手順

### ステップ 1: API の有効化
1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成または選択します。
2. **API とサービス > ライブラリ** から以下の 2 つの API を有効化します。
   - **Google Drive API**
   - **Google Picker API**（Google Picker によるフォルダ選択を使う場合）

### ステップ 2: OAuth 同意画面の設定
1. **Google Auth Platform（または API とサービス > OAuth 同意画面）** を開きます。
2. User Type で「外部」または組織内向け（「内部」）を選択し、アプリ名などを入力します。
3. **スコープ** に以下を追加します:
   - `https://www.googleapis.com/auth/drive.readonly`
4. **公開ステータスに関する注意**:
   - **テスト（Testing）のまま個人・限定メンバーで利用する場合**: 「テストユーザー」に利用者の Google アカウント（最大 100 名）を登録してください。未登録アカウントはログインできません。
   - **不特定多数へ一般公開する場合**: OAuth 同意画面を本番公開し、Google による制限付き/機密スコープのアプリ検証審査を受ける必要があります。

### ステップ 3: OAuth 2.0 クライアント ID の作成（必須）
1. **API とサービス > 認証情報 > 認証情報を作成 > OAuth クライアント ID** を選択します。
2. アプリケーションの種類で **ウェブ アプリケーション** を選択します。
3. **承認済み JavaScript 生成元（Authorized JavaScript origins）** に、パスを含まないオリジンを登録します。
   - GitHub Pages 公開用: `https://<your-github-username>.github.io`
   - ローカル検証用（任意）: `http://localhost:8080` など
   - ※ `https://<username>.github.io/HttpViewer-app` のようにリポジトリ名パスを付けないでください。
   - ※ **承認済みリダイレクト URI** の登録は不要です（GIS ポップアップフローを使用するため）。
4. 発行された **クライアント ID**（`xxxx.apps.googleusercontent.com`）を控えます。

### ステップ 4: Google Picker 用 API キーとプロジェクト番号の取得（任意）
Google Picker ダイアログを使用しない場合でも、「手動フォルダ入力モーダル」によりフォルダ ID / URL の直接指定で利用できます。Picker を有効にする場合は以下を設定してください。

1. **API とサービス > 認証情報 > 認証情報を作成 > API キー** を作成します。
2. 作成した API キーの編集画面で必ず以下の制限を設定してください:
   - **アプリケーションの制限**: **ウェブサイト** を選択し、`https://<your-github-username>.github.io/*`（および必要に応じて `http://localhost:8080/*`）を許可。
   - **API の制限**: **キーを制限** を選択し、**Google Picker API** のみを許可。
3. Google Cloud Console のプロジェクトダッシュボードから **プロジェクト番号（Project Number）**（数値文字列）を控えます。これがアプリ内の `appId` になります。

---

## 4. アプリへの設定反映方法（ハイブリッド方式）

本アプリは設定ファイル（`config.js`）とブラウザ上 UI 設定モーダルの**ハイブリッド方式**を採用しています。項目ごとに `ブラウザ保存値 (localStorage) > config.js 既定値` の優先順位で解決されます。

### 方法 A: UI 設定モーダルから設定する（リポジトリに設定値を残さない場合）
1. アプリ画面を開くと「初期設定が必要です」案内が表示されます（または右上の歯車アイコンをクリックします）。
2. 「GCP 接続設定」モーダルに以下を入力し、「保存して適用」をクリックします。
   - **OAuth Client ID**（必須）
   - **Google Picker API Key**（任意）
   - **GCP Project Number (App ID)**（任意）
   - **デフォルトフォルダ ID / URL**（任意）
3. 設定はブラウザの `localStorage`（キー: `html_viewer_app_config`）に保存されます。`config.js` の既定値に戻したい場合はモーダル内の「初期設定に戻す」を押してください。

### 方法 B: `config.js` に初期値を設定して公開する
リポジトリをフォーク・公開する際に全利用者へ同じ設定を配布したい場合は、ルートの `config.js` 内の `APP_DEFAULT_CONFIG` を編集します。

```js
var APP_DEFAULT_CONFIG = {
  clientId: '1234567890-xxxx.apps.googleusercontent.com',
  apiKey: 'AIza...',
  appId: '123456789012',
  defaultFolderId: ''
};
```

> **重要**: `config.js` には OAuth クライアントシークレット（`client_secret`）等の秘密鍵を**絶対に記述しないでください**。

---

## 5. GitHub Pages 公開手順

1. 本リポジトリを GitHub へプッシュします（公開対象ブランチ: `master`）。
2. GitHub リポジトリページの **Settings > Pages** を開きます。
3. **Build and deployment** の **Source** で **Deploy from a branch** を選択します。
4. **Branch** に `master`、フォルダに **`/ (root)`** を選択して **Save** をクリックします。
5. デプロイ完了後、`https://<your-github-username>.github.io/<repository-name>/` へアクセスします。

---

## 6. ディープリンク共有とセキュリティ仕様

### ディープリンク（URL クエリパラメータ）
以下の形式で特定のフォルダを直接開く URL を共有できます（前回開いたフォルダやデフォルト設定よりも優先されます）。
- `https://<user>.github.io/HttpViewer-app/?folderId=<FOLDER_ID>`
- `https://<user>.github.io/HttpViewer-app/?f=<FOLDER_ID>`

### セキュリティ・仕様上の留意点
- **アクセストークンの非永続化**: OAuth 2.0 アクセストークンおよび有効期限は `js/auth.js` 内のメモリ（クロージャ変数）にのみ保持され、`localStorage`・`sessionStorage`・`window` グローバルには一切保存されません。ページ再読み込み時は再度サインイン操作が必要です。
- **トークン有効期限（約 1 時間）**: ブラウザ GIS Token Client はリフレッシュトークンを発行しないため、約 1 時間経過後に Drive API から `401` が返却された場合、画面上部に「再認証」バナーが表示されます。一覧・検索語・プレビュー表示を保持したまま再認証して作業を継続できます。
- **前回フォルダの保存範囲**: 前回選択したフォルダ ID（`html_viewer_last_folder_id`）は同一ブラウザの `localStorage` に保存されます。異なる端末・ブラウザ間での自動同期は行われません（他端末と共有する場合は `?folderId=` URL をご利用ください）。

---

## 7. ローカル開発・テスト実行

### ローカルでの動作確認
静的 HTTP サーバーを起動し、GCP の「承認済み JavaScript 生成元」に登録したローカルオリジン（例: `http://localhost:8080`）でアクセスします。

```bash
# Python を使用する場合
python -m http.server 8080

# Node.js (serve) を使用する場合
npx serve -l 8080 .
```

### 自動テストの実行（Node.js 標準モジュールのみで実行可能）

```bash
# 単体・結合テストスイート
node tests/run_tests.js

# 敵対的・セキュリティ・境界値テストスイート
node tests/adversarial_tests.js
```
