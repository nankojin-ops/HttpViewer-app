# 実装計画・タスク仕様書（GitHub Pages 移行・GAS バックエンド廃止）

> **文書ステータス**: Phase 2（実装計画・タスク仕様）  
> **対象設計書**: [ARCHITECTURE_GITHUB_PAGES.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/architecture/ARCHITECTURE_GITHUB_PAGES.md)  
> **承認済み前提条件**:
> - **採用アーキテクチャ**: 案B（GAS バックエンド完全廃止 + GitHub Pages 静的 SPA）
> - **B-1（GCP 設定管理）**: ハイブリッド方式（`config.js` で初期値指定可能 + UI 設定モーダルから入力・`localStorage` 保存・上書き可能）
> - **B-2（旧 GAS 関連ファイル）**: 完全削除（`コード.js`, `appsscript.json`, `.clasp.json`, `.claspignore` 等）
> - **B-3（端末間同期）**: `localStorage` のみ（`drive.readonly` 最小権限維持、他端末共有は `?folderId=` URL を利用）
> - **B-4（GitHub Pages 公開構成）**: `master` ブランチのルート（`/`）で公開

---

## 1. アーキテクチャレビュー所見

### 1.1 実現可能性評価
承認済みアーキテクチャ設計書（`ARCHITECTURE_GITHUB_PAGES.md`）および現行コードベース（`index.html`, `コード.js`, `appsscript.json`, `.clasp.json`, `.claspignore`, `.gitignore`, `tests/run_tests.js`, `tests/adversarial_tests.js`）を照合・精査した結果を以下に示します。

- **総合評価**: **条件付き承認（Feasible — 実装仕様への詳細補完が必要）**
- **評価理由**:
  - 現行 `コード.js` の全機能（フォルダ検証、HTML 一覧、ファイル名/全文検索、HTML 本文取得、Picker 用トークン供給）は、Google Identity Services (GIS) Token Client + Google Drive API v3 REST + Google Picker API の組み合わせでブラウザ完結できます。
  - GitHub Pages のトップレベルオリジンで稼働することにより、GAS 特有のサンドボックス iframe 制約（`google.script.host.origin`、サードパーティストレージパーティショニング、`<?= ... ?>` テンプレートインジェクションリスク）が根本解消されます。
  - 一方で、設計書（概念設計レベル）からそのまま実装へ移すと、**Drive API v3 特有の仕様差（GAS `DriveApp` との挙動差異）**、**GIS / Picker の非同期ロードと `clientId` 動的変更**、**テストスイートの GAS 依存箇所**において不具合を生む余地があるため、以下の技術的補完を本計画書に組み込みました。

---

### 1.2 留意事項・技術リスク（批判的レビュー結果）

#### (1) Google Drive API v3 と GAS `DriveApp` の仕様差異
1. **検索フィールド名（`name` vs `title`）**:
   - 現行 `コード.js`（281–282行目）は Drive API v2 互換の `title contains` を使用していますが、Drive API v3 の `q` パラメータでは **`name`** を使用する必要があります（`title` を指定すると `400 Bad Request` になります）。
2. **`endsWith` 演算子の不在とフォルダ・非HTMLファイルの混入**:
   - Drive API v3 の `q` には `endsWith` が存在せず、`name contains '.html'` のみでは `sample.html.bak` のような中間一致や、同名のフォルダ（`backup.html`）が返却される可能性があります。
   - 対策として、`q` 側で `mimeType != 'application/vnd.google-apps.folder' and trashed = false` を指定した上で、**クライアント側でも厳密に `file.mimeType === 'text/html' || lowerName.endsWith('.html') || lowerName.endsWith('.htm')`（かつ非フォルダ・非ゴミ箱）で再フィルタリング**を行います。
   - なお、Google ドキュメント等の Google Workspace ネイティブ形式（`application/vnd.google-apps.*`）を拡張子 `.html` のような名前で保存していた場合、`files.get?alt=media` は `403 fileNotDownloadable` となるため、明確なエラーメッセージでユーザーへ通知します。
3. **共有ドライブ（Shared Drives）対応の欠落**:
   - Drive API v3 はデフォルトでマイドライブのみを対象とするため、共有ドライブ上のフォルダ・ファイルにアクセスすると `404` または空一覧になります。
   - `files.get` には `supportsAllDrives=true`、`files.list` には `supportsAllDrives=true&includeItemsFromAllDrives=true` を必須付与します。
4. **ページネーション（`pageSize` / `nextPageToken`）と競合制御**:
   - `files.list` のデフォルト `pageSize` は `100` であり、101件以上あるフォルダで取得漏れが発生します。`pageSize=1000` と `nextPageToken` による全ページ取得ループ（無限ループ防止の上限ページ数・最新リクエスト ID による中断判定付き）を必須とします。
5. **`files.list` の空成功とフォルダ種別検証**:
   - GAS `DriveApp.getFolderById()` と異なり、Drive API v3 の `files.list` は存在しない親 ID でも `200 OK`（`files: []`）を返します。また `files.get` は通常のファイル ID を渡しても `200 OK` を返します。
   - したがって、`files.get` で `fields=id,name,mimeType,trashed` を取得し、**`mimeType === 'application/vnd.google-apps.folder'` かつ `trashed !== true`** であることを明示検証します。
6. **JSON レスポンスの型と並び順**:
   - Drive API v3 の `size` は文字列（例: `"2048"`）または未定義で返るため `Number(file.size || 0)` へ正規化します。`modifiedTime` は ISO 8601 UTC 文字列であるため、ソート比較には ISO 文字列（またはミリ秒時刻）を用い、表示用文字列へ整形します。
7. **HTTP ステータスおよび `403` 理由コードの分類（誤消去防止）**:
   - `401 Unauthorized` はトークン期限切れ（`UNAUTHORIZED`）であり、**絶対に `localStorage` の `html_viewer_last_folder_id` を削除してはなりません**。作業状態（`currentFolderId`, 検索語, `activeFileId`）を保持したまま再認証へ誘導します。
   - `403 Forbidden` は「フォルダ権限不足」だけでなく「レート制限（`rateLimitExceeded` / `userRateLimitExceeded`）」や「API 未有効化（`accessNotConfigured`）」でも返ります。エラーレスポンスの `error.errors[0].reason` を検査し、レート制限・設定エラー時は一時障害（`RATE_LIMITED` / `API_ERROR`）として扱い、フォルダ設定を誤消去しないようにします（既存 QA 指摘 `BUG-002` の精神を継承）。

#### (2) Google Picker API 連携とフォールバック
1. **`setOrigin` の変更**:
   - `index.html`（686–688行目）の `google.script.host.origin` を削除し、`.setOrigin(window.location.origin)` を設定します。
2. **認証・設定不足時の安全制御**:
   - Picker 表示前には「サインイン済みかつ有効トークンあり（`authService.getValidToken()`）」を前提とします。未認証・期限切れ時は Picker を開かずサインイン／再認証を促します。
   - B-1 ハイブリッド方式により `clientId` のみ設定され、`apiKey` または `appId`（GCP プロジェクト番号）が未設定の場合でも、アプリ全体は利用可能であるべきです。`apiKey` または `appId` が未設定（あるいは `gapi` ロード失敗）時は、シームレスに手動フォルダ入力モーダルへフォールバックします。
   - 共有ドライブを Picker で選択できるよう、`DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true)` および `enableFeature(google.picker.Feature.SUPPORT_DRIVES)` を設定します。

#### (3) GIS Token Client ライフサイクル・UI 状態・セキュリティ
1. **外部スクリプトの非同期ロード**:
   - `https://accounts.google.com/gsi/client` および `https://apis.google.com/js/api.js` は外部 CDN 依存であり、広告ブロッカーやオフライン等で遅延・失敗し得ます。`AuthService` / `PickerService` は `DOMContentLoaded` 時点でライブラリ未ロードでもクラッシュせず、ロード完了待機または遅延初期化を行う必要があります。
2. **`clientId` 未設定・動的変更時の再初期化**:
   - B-1（ハイブリッド方式）により、初期アクセス時に `config.js` も `localStorage` も空（`clientId === ''`）のケースが発生します。設定モーダルから `clientId` を新規入力または変更した場合、`AuthService.reinit(newClientId)` で既存のメモリ内トークンを破棄し、`google.accounts.oauth2.initTokenClient` を再構成する設計が必要です。
   - また、GIS の `callback` 内エラー（`response.error`）だけでなく、ユーザーがポップアップを閉じた／ブラウザがブロックした際に呼ばれる `error_callback` も必ず捕捉し、認証中状態のデッドロックを防ぎます。
3. **セキュリティ境界（`<iframe sandbox>` と `localStorage`）**:
   - `accessToken` および `expiresAt` は**モジュール内クロージャ変数（メモリ上のみ）に厳格保持**し、`localStorage`・`sessionStorage`・`window` グローバル・DOM 属性には一切書き込みません。`client_secret` も一切扱いません。
   - プレビュー用 `<iframe id="previewFrame" sandbox="allow-scripts allow-forms allow-same-origin">` は既存要件通り維持しますが、技術的性質として `allow-scripts` + `allow-same-origin` の併用はプレビュー対象 HTML が同一オリジン扱いとなり `window.parent` / `localStorage` へ技術的にアクセス可能です（閲覧者自身のドライブ内 HTML を信頼境界とする現行仕様を踏襲）。そのためにも、**トークンを絶対に `localStorage` や `window` に置かないこと**が必須防衛線となります。
   - `localStorage` に保存する `AppConfig`（`clientId`, `apiKey`, `appId`, `defaultFolderId`）は公開識別子のみであり、読み込み時に JSON パース例外遮断と型・フォーマット検証（`defaultFolderId` の `sanitizeFolderId` 相当チェック）を実施します。

#### (4) 既存テストと新構成の整合性・GitHub Pages ルート公開構成
1. **既存テストの GAS 依存箇所**:
   - `tests/run_tests.js` は `コード.js` の読み込み・`vm` 実行、`<?= ... ?>` 置換、`USER_PROPERTIES` カスケード検証、`saveLastFolderId` / `clearLastFolderId` / `saveLastFolderIdRequestId` の文字列検査を行っており、B-2（`コード.js` 削除）後にそのままでは全失敗します。
   - `tests/adversarial_tests.js` も同様に `コード.js` と GAS モック（`PropertiesService`, `HtmlService`, `ScriptApp`, `DriveApp`）に依存しています。
   - 対策として、クライアントロジックを `index.html` の単一インラインスクリプトから**依存関係のない純粋 JS モジュール群（`js/*.js`、UMD/デュアルエクスポート方式）へ分割**し、ビルドツール不要で GitHub Pages と Node.js テスト（モック `fetch` / モック `localStorage`）の双方から直接読み込める構成とします。
2. **GitHub Pages ルート公開のファイル整理**:
   - `master` ブランチのルート（`/`）公開のため、Jekyll 無効化用の `.nojekyll`、初期設定用 `config.js`（空値テンプレート）、セットアップ手順を記載した `README.md` をルートに配置します。
   - なお、現在のリポジトリルートには `.gitignore` と同一内容（238バイト）の `gitignore.txt` が残存しています。削除・整理対象に含めるか確認の上で扱う必要があります（本計画では明確にリストアップします）。

---

### 1.3 アーキテクトへのエスカレーション有無
- **エスカレーション**: **なし**
- **判断根拠**: 上流の決定事項（案B、B-1〜B-4、ADR-1〜ADR-6）との矛盾はなく、すべての技術的論点（Drive API v3 の詳細仕様、共有ドライブ対応、ページネーション、Picker フォールバック、GIS 再初期化、`localStorage`/メモリ境界、テスト移行）はアーキテクチャ境界内の実装仕様として解決可能です。

---

## 2. 影響範囲・変更対象ファイル一覧

### 2.1 変更・新規作成・削除ファイル一覧

| ファイルパス | 操作 | 概要・責務 | 影響度 |
| :--- | :---: | :--- | :---: |
| `コード.js` | **削除** | GAS バックエンドを完全廃止（B-2） | 高 |
| `appsscript.json` | **削除** | GAS マニフェスト削除（B-2） | 中 |
| `.clasp.json` | **削除** | clasp プロジェクト設定削除（B-2） | 低 |
| `.claspignore` | **削除** | clasp 無視定義削除（B-2） | 低 |
| `.gitignore` | **変更** | GAS/clasp 専用記述の見直し（`.clasprc.json` 等の誤コミット防止記述は維持可、ローカル確認用設定の扱い整理） | 低 |
| `gitignore.txt` | **確認/削除推奨** | `.gitignore` の複製と思われる旧ファイル（実態同一のため整理推奨。削除可否を実装時に最終確認） | 低 |
| `.nojekyll` | **新規** | GitHub Pages 上で Jekyll 処理を無効化する空ファイル（B-4） | 低 |
| `config.js` | **新規** | ハイブリッド設定の初期値ファイル（`APP_DEFAULT_CONFIG` テンプレート、初期値はすべて空文字）（B-1） | 中 |
| `js/storage.js` | **新規** | `SafeStorage`（`localStorage` の `try-catch` ラッパー）およびストレージキー定数 | 中 |
| `js/config.js` | **新規** | `AppConfigProvider`（`config.js` 初期値と `localStorage` 上書き値の統合・検証・保存・リセット） | 中 |
| `js/folder-resolver.js` | **新規** | `sanitizeFolderId`, `getClientUrlFolderId`, `resolveInitialFolderId`（URL > LOCAL_STORAGE > DEFAULT > NONE） | 中 |
| `js/auth.js` | **新規** | `AuthService`（GIS 読み込み待機、`TokenClient` 初期化/再初期化、メモリ限定トークン保持、サインイン/アウト） | 高 |
| `js/drive-api.js` | **新規** | `DriveApiClient`（Drive API v3 `files.get` / `files.list` / `alt=media`、クエリ構築・エスケープ、ページング、エラー分類） | 高 |
| `js/picker.js` | **新規** | `PickerService`（`gapi.load('picker')`、`window.location.origin`、共有ドライブ対応、手動モーダルへのフォールバック） | 中 |
| `js/app.js` | **新規** | `AppStateController` & UI イベント制御（認証状態遷移、`401` リカバリー、検索デバウンス、競合制御、設定モーダル、自己修復） | 高 |
| `index.html` | **変更** | GAS テンプレート構文と `google.script.run` を完全除去。GIS スクリプト・分割 JS 読み込み・サインイン/サインアウト UI・再認証バナー・GCP 設定モーダルを追加 | 高 |
| `tests/run_tests.js` | **変更** | GAS 依存テストを廃止し、新モジュール群（`storage`, `config`, `folder-resolver`, `auth`, `drive-api`, `picker`, `app`）の単体・結合テストへ刷新 | 高 |
| `tests/adversarial_tests.js` | **変更** | GAS 依存の敵対的テストを廃止し、Drive API v3 境界値・トークン非永続化・401リカバリー・クエリインジェクション・競合制御の敵対的テストへ刷新 | 高 |
| `README.md` | **新規** | アプリ概要、GCP OAuth/API キー設定手順、GitHub Pages（`master` ルート）公開手順、ローカル検証手順、セキュリティ設計解説 | 中 |

### 2.2 モジュール読み込み順と依存関係（GitHub Pages ゼロビルド構成）
GitHub Pages 上での静的配信（ビルドツール不要）と Node.js（`tests/`）での `require()` を両立するため、各 `js/*.js` モジュールは **UMD（デュアルエクスポート）パターン**（Node 環境では `module.exports`、ブラウザ環境では `window.HttpViewer` 名前空間へ登録）を採用します。

`index.html` 内の `<script>` 読み込み順序は以下の依存 DAG に従います：
1. 外部ライブラリ:
   - `https://cdn.tailwindcss.com`（`<head>` 内）
   - `https://apis.google.com/js/api.js`（`<head>` または `<body>` 末尾、非ブロッキング/ロード状態検知対応）
   - `https://accounts.google.com/gsi/client`（`async defer`、ロード完了検知対応）
2. アプリケーション設定・モジュール（`<body>` 末尾で順序通り読み込み）:
   1. `config.js`（依存なし）
   2. `js/storage.js`（依存なし）
   3. `js/folder-resolver.js`（依存なし）
   4. `js/config.js`（依存: `js/storage.js`, `js/folder-resolver.js`, `window.APP_DEFAULT_CONFIG`）
   5. `js/auth.js`（依存: `google.accounts.oauth2` ※実行時解決）
   6. `js/drive-api.js`（依存: `js/folder-resolver.js`, `fetch`）
   7. `js/picker.js`（依存: `gapi.picker` ※実行時解決）
   8. `js/app.js`（依存: 上記全モジュール + DOM）

### 2.3 後方互換性への考慮事項
- **ディープリンク URL 互換性**: `?folderId=<ID>` および `?f=<ID>` のクエリパラメータ仕様を完全維持します。
- **`localStorage` キー互換性**: 前回フォルダ保存キー `'html_viewer_last_folder_id'` を維持します（ただしオリジンが GAS `script.googleusercontent.com` から GitHub Pages に変わるため、初回アクセス時は新規保存扱いとなります）。
- **UI/UX パリティ**: 2ペイン（PC）/ 排他切替（モバイル）、400ms デバウンス検索、一覧表示項目（ファイル名、サイズ、更新日時）、`<iframe sandbox="allow-scripts allow-forms allow-same-origin">` プレビュー、手動フォルダ入力モーダル、トースト通知を完全維持します。
- **GAS 資産の非互換**: B-2 決定に基づき `コード.js` 等を削除するため、既存の GAS Web App デプロイとの併用は対象外とします。

---

## 3. インターフェース・データ構造仕様

※以下はシニアコーダーが実装時に準拠すべき契約仕様（データ構造・シグネチャ・振る舞い規則）であり、完全な実装コードではありません。

### 3.1 定数・ストレージキー仕様（`js/storage.js` & `config.js`）

```typescript
/** config.js が window に公開する既定設定オブジェクト */
interface AppConfig {
  clientId: string;        // Google OAuth 2.0 クライアントID（例: "xxxx.apps.googleusercontent.com"）
  apiKey: string;          // Google Picker 用 API キー（任意。未設定時は手動入力へフォールバック）
  appId: string;           // Google Cloud プロジェクト番号（数値文字列、任意）
  defaultFolderId: string; // 既定フォルダ ID または Drive URL（任意）
}

// config.js で定義するグローバル定数名
// window.APP_DEFAULT_CONFIG: AppConfig

/** localStorage キー定義（アクセストークンは絶対に含めない） */
const STORAGE_KEYS = {
  LAST_FOLDER_ID: 'html_viewer_last_folder_id',
  APP_CONFIG: 'html_viewer_app_config'
};
```

#### `SafeStorage`（`js/storage.js`）
- `get(key: string): string | null` — `window.localStorage.getItem(key)` を `try-catch` で保護し、例外・未定義時は `null` を返す。
- `set(key: string, value: string): boolean` — `window.localStorage.setItem(key, value)` を `try-catch` で保護し、成功時 `true`、失敗時 `false` を返す。
- `remove(key: string): boolean` — `window.localStorage.removeItem(key)` を `try-catch` で保護し、成功時 `true`、失敗時 `false` を返す。

---

### 3.2 設定管理モジュール（`js/config.js`: `AppConfigProvider`）

```typescript
interface ResolvedAppConfig extends AppConfig {
  sources: {
    clientId: 'LOCAL_STORAGE' | 'CONFIG_FILE' | 'NONE';
    apiKey: 'LOCAL_STORAGE' | 'CONFIG_FILE' | 'NONE';
    appId: 'LOCAL_STORAGE' | 'CONFIG_FILE' | 'NONE';
    defaultFolderId: 'LOCAL_STORAGE' | 'CONFIG_FILE' | 'NONE';
  };
  hasLocalOverrides: boolean;
  isAuthConfigured: boolean;   // clientId が非空であること
  isPickerConfigured: boolean; // apiKey と appId がともに非空であること
}

interface ConfigSaveResult {
  success: boolean;
  config?: ResolvedAppConfig;
  error?: string;
}

interface AppConfigProvider {
  loadConfig(defaultConfig?: Partial<AppConfig>, storage?: SafeStorageLike): ResolvedAppConfig;
  saveConfigOverrides(partial: Partial<AppConfig>, storage?: SafeStorageLike): ConfigSaveResult;
  clearConfigOverrides(storage?: SafeStorageLike): boolean;
  getDefaultConfig(defaultConfig?: Partial<AppConfig>): AppConfig;
}
```

- **解決ルール（B-1 ハイブリッド方式）**:
  - `STORAGE_KEYS.APP_CONFIG` の JSON を `try-catch` でパース（破損 JSON の場合は無視し `localStorage` 破損による起動不能を防止）。
  - 各項目（`clientId`, `apiKey`, `appId`, `defaultFolderId`）について、文字列トリム後に「`localStorage` 側の非空値 > `config.js`（`APP_DEFAULT_CONFIG`）の非空値 > `""`」で解決する。
  - **補足（上書き・リセット挙動）**: ユーザーが設定モーダルで値を空にして保存した場合、`config.js` に値が無ければ空になる。`config.js` に値がある環境で一時上書きを戻したい場合は、設定モーダルの「初期設定に戻す（リセット）」操作で `clearConfigOverrides()` を呼び、`STORAGE_KEYS.APP_CONFIG` を削除する。
  - **`defaultFolderId` の検証**: 保存時および読み込み時に非空の `defaultFolderId` が指定されている場合、`sanitizeFolderId` により Drive URL からの ID 抽出・形式チェックを行う。保存時に不正形式なら `ConfigSaveResult { success: false, error }` を返す。

---

### 3.3 フォルダ ID 検証・解決モジュール（`js/folder-resolver.js`）

```typescript
interface FolderResolutionResult {
  folderId: string;
  source: 'URL' | 'LOCAL_STORAGE' | 'DEFAULT' | 'NONE';
}

interface FolderResolverModule {
  sanitizeFolderId(input: string): string; // 無効時は Error をスロー
  trySanitizeFolderId(input: string): string; // 無効時は '' を返す（URLパラメータ等の安全抽出用）
  getClientUrlFolderId(searchString?: string): string;
  resolveInitialFolderId(sources: {
    urlParam?: string | null;
    localStore?: string | null;
    defaultProp?: string | null;
  }): FolderResolutionResult;
}
```

- **`sanitizeFolderId(input)` 仕様**:
  - 空文字・非文字列・空白のみの場合は例外をスローする。
  - 最大長上限（例: 256文字超）をチェックし、異常な長大入力を拒否する（`AUDIT_REPORT.md` 改善提案反映）。
  - 対応する抽出パターン:
    1. `folders/([a-zA-Z0-9_-]+)`（`drive/folders/...`, `drive/u/0/folders/...`）
    2. `[?&]id=([a-zA-Z0-9_-]+)`（`open?id=...`）
    3. 直接 ID（`/^[a-zA-Z0-9_-]+$/`）
  - 一致しない場合は `'無効なフォルダID形式です。指定されたフォルダの英数字IDまたはドライブURLを入力してください。'` をスローする。
- **`resolveInitialFolderId(sources)` 仕様**:
  - 優先順位: `URL` > `LOCAL_STORAGE` > `DEFAULT` > `NONE`（GAS 廃止に伴い `USER_PROPERTIES` 層を削除）。
  - 注意: `urlParam` 等に不正文字が含まれる場合でも `resolveInitialFolderId` 自体は文字列トリムによる解決または `sanitize` 連携を行い、呼び出し元（または自己修復フロー）で無限ループしないこと（後述 3.6 参照）。

---

### 3.4 GIS 認証管理モジュール（`js/auth.js`: `AuthService`）

```typescript
type AuthStatus = 'UNCONFIGURED' | 'SIGNED_OUT' | 'AUTHENTICATING' | 'AUTHENTICATED' | 'EXPIRED';

interface AuthState {
  status: AuthStatus;
  isAuthenticated: boolean;
  expiresAt: number | null; // Unix timestamp (ms)
  errorMessage?: string;
}

interface AuthServiceOptions {
  scope?: string; // 既定: 'https://www.googleapis.com/auth/drive.readonly'
  waitForGisTimeoutMs?: number; // 既定: 10000
}

interface AuthService {
  init(clientId: string, onAuthChange: (state: AuthState) => void, options?: AuthServiceOptions): void;
  reinit(newClientId: string): void;
  signIn(prompt?: '' | 'consent' | 'select_account'): Promise<string>;
  signOut(): Promise<void>;
  handleUnauthorized(): void;
  getValidToken(): string | null;
  getState(): AuthState;
}
```

- **トークン保持ルール（セキュリティ必須要件）**:
  - `accessToken` および `expiresAt` は `createAuthService()` の**クロージャローカル変数のみ**に保持し、外部へは `getValidToken()` 経由でのみ返す（`AuthState` 自体には生の `accessToken` を露出しない設計を推奨）。
  - `expiresAt` は `Date.now() + Math.max(0, Number(expiresInSec || 3600) - 60) * 1000` とし、60秒の安全マージンを設ける。
- **GIS 非同期ロード & `initTokenClient` 契約**:
  - `signIn()` 呼び出し時に `window.google?.accounts?.oauth2?.initTokenClient` が未ロードの場合は、最大 `waitForGisTimeoutMs` まで待機（またはエラー通知）。
  - `initTokenClient` には `callback` と `error_callback` の双方を設定する:
    - `callback(resp)`: `resp.error` がある場合は Promise を reject し、状態を元の `SIGNED_OUT` / `EXPIRED` へ戻す。成功時はトークンをメモリ保存し状態を `AUTHENTICATED` に遷移させ resolve。
    - `error_callback(err)`: ポップアップ閉鎖（`popup_closed`）やポップアップブロック（`popup_failed_to_open`）を検知し、必ず Promise を reject して `AUTHENTICATING` 状態から復帰させる。
- **`reinit(newClientId)`**:
  - `newClientId !== currentClientId` の場合、既存のメモリ内トークンを破棄（可能なら `revoke`）し、`tokenClient = null` にリセットした上で、`newClientId` が空なら `UNCONFIGURED`、非空なら `SIGNED_OUT` に状態遷移する。
- **`handleUnauthorized()`**:
  - Drive API から `401` を受信した際に呼び出され、メモリ内の `accessToken` と `expiresAt` をクリアし、状態を `'EXPIRED'` に遷移させて `onAuthChange` を発火する。

---

### 3.5 Google Drive API v3 クライアント（`js/drive-api.js`: `DriveApiClient`）

```typescript
type DriveErrorCode =
  | 'UNAUTHORIZED'      // HTTP 401（トークン無効・期限切れ）
  | 'FORBIDDEN'         // HTTP 403（対象フォルダ/ファイルへの権限不足）
  | 'NOT_FOUND'         // HTTP 404（存在しない・非公開）
  | 'TRASHED'           // 対象がゴミ箱内
  | 'NOT_A_FOLDER'      // フォルダ検証で mimeType !== 'application/vnd.google-apps.folder'
  | 'NOT_DOWNLOADABLE'  // Google Workspace ネイティブ文書等、alt=media 不可
  | 'INVALID_INPUT'     // フォルダID/ファイルID形式不正
  | 'RATE_LIMITED'      // HTTP 429 または 403 rateLimitExceeded / userRateLimitExceeded
  | 'API_DISABLED'      // HTTP 403 accessNotConfigured 等
  | 'NETWORK_ERROR';    // 通信失敗 / 5xx / タイムアウト

interface FolderInfo {
  id: string;
  name: string;
}

interface HtmlFileMetadata {
  id: string;
  name: string;
  size: number;
  updated: string;      // 表示用 'yyyy-MM-dd HH:mm:ss'
  modifiedTime: string; // ソート・比較用 ISO 8601 文字列
}

interface DriveResult<T> {
  success: boolean;
  data?: T;
  folder?: FolderInfo;
  error?: string;
  errorCode?: DriveErrorCode;
  truncated?: boolean;  // 安全上限ページ数に達した場合 true
}

interface DriveApiClientOptions {
  getAccessToken: () => string | null;
  fetchImpl?: typeof fetch; // テスト注入用（既定: window.fetch）
  pageSize?: number;        // 既定: 1000（Drive v3 上限）
  maxPages?: number;        // 既定: 20（無限ページング防止）
}
```

#### Drive API v3 エンドポイントおよびパラメータ厳密仕様

1. **`sanitizeSearchQuery(input: string): string`**:
   - `\` を `\\`、次いで `'` を `\'` にエスケープする。
2. **`isHtmlDriveFile(file): boolean`（厳密判定関数）**:
   - `file.trashed !== true`
   - `file.mimeType !== 'application/vnd.google-apps.folder'`
   - `file.mimeType === 'text/html' || lowerName.endsWith('.html') || lowerName.endsWith('.htm')`
3. **`getFolderDetails(folderIdOrUrl: string): Promise<DriveResult<FolderInfo>>`**:
   - `sanitizeFolderId(folderIdOrUrl)` を実行（失敗時は `errorCode: 'INVALID_INPUT'`）。
   - リクエスト:
     `GET https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}?fields=id,name,mimeType,trashed&supportsAllDrives=true`
   - 検証:
     - `data.trashed === true` → `success: false, errorCode: 'TRASHED'`
     - `data.mimeType !== 'application/vnd.google-apps.folder'` → `success: false, errorCode: 'NOT_A_FOLDER'`
     - 正常時 → `{ success: true, data: { id: data.id, name: data.name }, folder: { id: data.id, name: data.name } }`
4. **`getHtmlFileList(folderIdOrUrl: string, signal?: { isCancelled?: () => boolean }): Promise<DriveResult<HtmlFileMetadata[]>>`**:
   - 先に（または並行で）`getFolderDetails(folderIdOrUrl)` 相当のフォルダ検証とフォルダ名取得を実行し、無効なら即座に失敗返却。
   - クエリ `q`:
     `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder' and (mimeType = 'text/html' or name contains '.html' or name contains '.htm')`
   - パラメータ（`URLSearchParams` で構築）:
     - `q`: 上記クエリ
     - `fields`: `'nextPageToken,files(id,name,size,modifiedTime,mimeType,trashed)'`
     - `orderBy`: `'modifiedTime desc'`
     - `pageSize`: `String(pageSize)`（既定 `1000`）
     - `supportsAllDrives`: `'true'`
     - `includeItemsFromAllDrives`: `'true'`
     - 2ページ目以降: `pageToken`: `nextPageToken`
   - `nextPageToken` ループ（最大 `maxPages` 回、各ページ取得前に `signal?.isCancelled?.()` を確認してキャンセル時は中断）。
   - 取得全件に対し `isHtmlDriveFile` で厳密フィルタし、`modifiedTime` 降順ソート、`size: Number(f.size || 0)` および表示用 `updated`（`yyyy-MM-dd HH:mm:ss`）へ変換して返却。
5. **`searchHtmlFiles(keyword: string, folderIdOrUrl: string, signal?: { isCancelled?: () => boolean }): Promise<DriveResult<HtmlFileMetadata[]>>`**:
   - `keyword.trim() === ''` の場合は `getHtmlFileList(folderIdOrUrl, signal)` へ委譲。
   - `sanitizeFolderId(folderIdOrUrl)` および `sanitizeSearchQuery(keyword.trim())` を実行。
   - クエリ `q`:
     `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder' and (mimeType = 'text/html' or name contains '.html' or name contains '.htm') and (name contains '${cleanKeyword}' or fullText contains '${cleanKeyword}')`
   - パラメータ・ページネーション・`isHtmlDriveFile` 厳密フィルタ・降順ソートは `getHtmlFileList` と同一。
6. **`getHtmlFileContent(fileId: string): Promise<DriveResult<{ content: string; fileName: string }>>`**:
   - `sanitizeFolderId(fileId)` で ID 形式を検証（Drive ファイル ID も同一文字種 `[a-zA-Z0-9_-]+`）。
   - リクエスト: `GET https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanFileId)}?alt=media&supportsAllDrives=true`
   - レスポンスを `response.text()`（UTF-8）として取得し返却。
   - エラー時: `403` で `fileNotDownloadable`（Google Workspace ネイティブファイル等）を検知した場合は `errorCode: 'NOT_DOWNLOADABLE'` として明確な日本語メッセージを返す。
7. **HTTP エラーマッピング規則**:
   - トークン未取得（`!getAccessToken()`）→ 通信せず `errorCode: 'UNAUTHORIZED'`
   - HTTP `401` → `UNAUTHORIZED`
   - HTTP `403` → レスポンス JSON の `error.errors[0].reason` を確認:
     - `rateLimitExceeded` / `userRateLimitExceeded` / `dailyLimitExceeded` → `RATE_LIMITED`
     - `accessNotConfigured` → `API_DISABLED`
     - その他（`insufficientFilePermissions`, `forbidden` 等）→ `FORBIDDEN`
   - HTTP `404` → `NOT_FOUND`
   - HTTP `429` → `RATE_LIMITED`
   - HTTP `5xx` または `fetch` 例外 → `NETWORK_ERROR`

---

### 3.6 Google Picker サービス（`js/picker.js`: `PickerService`）

```typescript
interface PickerOpenParams {
  accessToken: string;
  apiKey: string;
  appId: string;
  origin?: string; // 既定: window.location.origin
  onPicked: (folder: { id: string; name: string }) => void;
  onCancel?: () => void;
  onFallbackToManual: (reason: string) => void;
}

interface PickerService {
  load(onStatusChange?: (loaded: boolean) => void): void;
  isLoaded(): boolean;
  openFolderPicker(params: PickerOpenParams): void;
}
```

- **動作規則**:
  - `load()` は `typeof gapi !== 'undefined'` の場合に `gapi.load('picker', { callback, onerror })` を実行。未定義時は `api.js` ロード完了後や `openFolderPicker()` 呼び出し時の遅延 `load()` 再試行も可能とする。
  - `openFolderPicker()` は `!isLoaded() || !params.apiKey || !params.appId || !params.accessToken` の場合、例外を投げず `params.onFallbackToManual(reason)` を呼び出す。
  - `PickerBuilder` 設定:
    - `DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true)`
    - `enableFeature(google.picker.Feature.SUPPORT_DRIVES)`（共有ドライブ対応）
    - `.setOAuthToken(params.accessToken)`
    - `.setDeveloperKey(params.apiKey)`
    - `.setAppId(params.appId)`
    - `.setOrigin(params.origin || window.location.origin)`
    - `.setLocale('ja')`

---

### 3.7 画面状態遷移・アプリコントローラ仕様（`js/app.js` & `index.html`）

#### UI 状態とヘッダー/オーバーレイ制御
1. **ヘッダー追加要素**:
   - **設定ボタン（歯車アイコン）**: 常時アクセス可能。GCP 設定モーダルを開く。
   - **認証ステータス/操作ボタン**:
     - `UNCONFIGURED`: 「初期設定」ボタン表示 + メインエリアにセットアップ案内カード表示。
     - `SIGNED_OUT`: 「Google でサインイン」ボタン表示 + メインエリア（またはオーバーレイ）にサインイン画面表示。
     - `AUTHENTICATED`: 「サインアウト」ボタン表示（確認不要または即時サインアウトで一覧・プレビュー内容をクリア）。
     - `EXPIRED`: 画面上部にセッション期限切れバナー（「セッションの有効期限が切れました。再認証してください」）+ 「再認証」ボタンを表示。**一覧・選択中フォルダ・検索語・プレビューは消去せず保持**し、再認証成功時に直前のフォルダ読み込み／検索を自動再開する。
2. **GCP 設定モーダル（B-1 ハイブリッド対応）**:
   - 入力フィールド:
     - `OAuth Client ID`（必須・テキスト入力）
     - `Google Picker API Key`（任意・テキスト入力、未設定時は手動入力モーダルで動作する旨を注記）
     - `GCP Project Number (App ID)`（任意・数値文字列入力）
     - `デフォルトフォルダ ID / URL`（任意・テキスト入力）
   - 各項目の出典インジケータ表示（例:「設定ファイル既定値」「ブラウザ保存値で上書き中」）。
   - アクション:
     - 「保存して適用」: `AppConfigProvider.saveConfigOverrides` 実行。`clientId` が変更された場合は `AuthService.reinit` を呼び再サインインを促す。`defaultFolderId` のみ変更され現在フォルダ未選択の場合は適用を試みる。
     - 「初期設定に戻す」: `AppConfigProvider.clearConfigOverrides` 実行後、`config.js` 既定値で再解決。
3. **自己修復（`handleFolderLoadError`）の発火条件厳格化**:
   - `errorCode` が `'NOT_FOUND' | 'FORBIDDEN' | 'TRASHED' | 'NOT_A_FOLDER' | 'INVALID_INPUT'` の**いずれかのみ**自己修復（`SafeStorage.remove(STORAGE_KEYS.LAST_FOLDER_ID)` + 1回限りの `defaultFolderId` フォールバック、なければフォルダ選択 UI）を実行する。
   - `errorCode === 'UNAUTHORIZED'` → 再認証フロー（`AuthService.handleUnauthorized()`）へルーティングし、**フォルダ設定は絶対に消去しない**。
   - `errorCode === 'NETWORK_ERROR' | 'RATE_LIMITED' | 'API_DISABLED'` → エラートースト表示のみ行い、**フォルダ設定は絶対に消去しない**。
   - URL パラメータ由来（`?folderId=...`）で失敗した場合の無限ループ防止: `hasAttemptedFallback` ガードを維持し、フォールバック時は URL を書き換えず（履歴破壊を避ける、またはメモリ上 `currentFolderId` のみ切替）、再度自動で URL 引数フォルダを読み直さないようにする。
4. **プレビュー取得の競合防止**:
   - `selectFile(file)` 内で `previewRequestId` をインクリメントし、`getHtmlFileContent` 応答時に `reqId !== currentPreviewRequestId` なら結果を破棄する。

---

## 4. テスト戦略

既存の `package.json` レス（Node.js 標準 `assert`, `fs`, `path`, `vm` のみ）の構成を維持し、`node tests/run_tests.js` および `node tests/adversarial_tests.js` で高速に自動実行できるテスト戦略を採用します。

### 4.1 単体テスト方針（`tests/run_tests.js`）
モック `fetch`、モック `localStorage`、モック GIS（`google.accounts.oauth2`）、モック Picker（`gapi.picker`）を Node.js 上で構築し、分割モジュールを直接 `require` して検証します。

1. **構文・静的条件チェック**:
   - `config.js`, `js/*.js`, `index.html` 内インライン（存在する場合）に構文エラー、LaTeX パイプ誤記（`\vert`, `\mid`）、`TODO`/`省略` が存在しないこと。
   - 旧 GAS 遺物（`コード.js`, `appsscript.json`, `.clasp.json`, `.claspignore`, `google.script.run`, `<?=`, `?>`）が一切残存していないこと。
   - `.nojekyll` が存在すること。
2. **`SafeStorage` & `AppConfigProvider` テスト**:
   - 正常系読み書き・削除、および `SecurityError` スロー環境／`localStorage` 未定義環境での安全動作。
   - ハイブリッド設定解決（`localStorage` 上書き > `config.js` 初期値 > 空）、破損 JSON 保存時の安全フォールバック、`defaultFolderId` URL 抽出・バリデーション、リセット動作。
3. **`FolderResolver` テスト**:
   - `sanitizeFolderId`: 通常 ID、`drive/folders/...`、`drive/u/0/folders/...`、`open?id=...` 抽出、不正文字・256文字超の拒否。
   - `resolveInitialFolderId`: `URL > LOCAL_STORAGE > DEFAULT > NONE` の 3層カスケード全パターン。
4. **`AuthService` テスト**:
   - `init` / `signIn` によるトークン取得と有効期限管理（60秒マージン）。
   - トークンが `localStorage` や `global`/`window` に保存されないこと。
   - `error_callback`（`popup_closed`）時の状態復帰。
   - `reinit(newClientId)` による旧トークン破棄・状態リセット。
   - `handleUnauthorized()` による `'EXPIRED'` 遷移と状態維持。
5. **`DriveApiClient` テスト（モック `fetch`）**:
   - `getFolderDetails`: `fields=id,name,mimeType,trashed&supportsAllDrives=true` 呼び出し、`mimeType !== 'application/vnd.google-apps.folder'` 時の `'NOT_A_FOLDER'` 判定、`trashed: true` 時の `'TRASHED'` 判定。
   - `getHtmlFileList`: `supportsAllDrives=true&includeItemsFromAllDrives=true`、`pageSize=1000`、`nextPageToken` 複数ページ結合、厳密フィルタ（`.html`/`.htm`/`text/html` のみ通過、`.html.bak` やフォルダ除外）、`size` 文字列→数値変換、`modifiedTime` 降順ソート。
   - `searchHtmlFiles`: `name contains`（`title` ではないこと）と `fullText contains` の構築、空白キーワード時の `getHtmlFileList` 委譲。
   - `getHtmlFileContent`: `?alt=media&supportsAllDrives=true` 呼び出し、UTF-8 HTML 本文返却、Google Workspace ネイティブ文書（`fileNotDownloadable`）時の `'NOT_DOWNLOADABLE'` 判定。
   - HTTP ステータス分類: `401`, `403`（権限不足 vs `rateLimitExceeded` vs `accessNotConfigured`）, `404`, `429`, `500`, ネットワーク例外。
6. **`PickerService` テスト（モック `gapi`）**:
   - `setOrigin` への `window.location.origin` 渡し、`setOAuthToken` 渡し、`SUPPORT_DRIVES` 有効化、`apiKey` / `appId` 未設定時の手動フォールバック。

### 4.2 結合テスト方針（`tests/run_tests.js`）
- **初期化〜認証〜フォルダ解決〜一覧表示フロー**:
  - `?folderId=` 付与状態でのサインイン完了後、`localStorage` や `defaultFolderId` より優先して対象フォルダの `files.get` + `files.list` が実行されること。
- **自己修復フローと `401` リカバリーの非干渉性**:
  - `404` / `TRASHED` / `NOT_A_FOLDER` 応答時に `SafeStorage.remove(LAST_FOLDER_ID)` が実行され、`defaultFolderId` へ 1 回限りフォールバックすること。
  - `401` 応答時および `NETWORK_ERROR` / `RATE_LIMITED` 応答時に `SafeStorage.get(LAST_FOLDER_ID)` が**削除されず保持**されること。

### 4.3 敵対的・回帰テスト観点（`tests/adversarial_tests.js`）
1. **Drive クエリインジェクション**: 検索キーワードに `'`, `\`, `or 1=1`, 改行、日本語、絵文字が含まれても `sanitizeSearchQuery` + `URLSearchParams` で安全にエスケープされ構文破壊しないこと。
2. **URL パラメータ・ファイル名 XSS**: `?folderId=';alert(1);//` やファイル名 `<img src=x onerror=alert(1)>.html` が安全に無害化されること。
3. **トークン漏洩防止検証**: `AuthService` サインイン後にモック `localStorage` 全キーおよび `global`/`window` プロパティを走査し、アクセストークン文字列が一切存在しないこと。
4. **ページネーション無限ループ・キャンセル検証**: 異常なサーバー応答（常に同じ `nextPageToken` を返し続けるモック）に対して `maxPages` 上限で必ず停止すること。またページ取得中に検索が更新された場合、途中ページでキャンセルされること。
5. **ファイル選択競合（レースコンディション）**: ファイル A の取得遅延中にファイル B を選択した場合、後から返ってきた A の応答でプレビューが上書きされないこと（`previewRequestId` 制御）。
6. **一時的障害・レート制限保護**: `403 rateLimitExceeded` や `fetch` ネットワーク切断で有効な `lastFolderId` が誤削除されないこと。

---

## 5. 実装タスク一覧 (順序定義)

### タスク [TASK-001]: 旧 GAS 関連ファイルの削除と GitHub Pages 公開基盤整備
- **ID**: TASK-001
- **目的**: 承認事項 B-2・B-4 に従い、旧 GAS バックエンド資産を完全削除し、GitHub Pages（`master` ブランチ `/`）公開用の静的基盤ファイルと初期設定テンプレートを整備する。
- **入力**: 現行リポジトリルートファイル群、`ARCHITECTURE_GITHUB_PAGES.md`（B-1, B-2, B-4 決定事項）
- **期待される結果**:
  - `コード.js`, `appsscript.json`, `.clasp.json`, `.claspignore` がリポジトリから削除されていること。
  - `.nojekyll`（空ファイル）がルートに作成されていること。
  - `config.js`（`window.APP_DEFAULT_CONFIG = { clientId: '', apiKey: '', appId: '', defaultFolderId: '' }` 形式の空テンプレート＋日本語設定コメント＋Dual Export 対応）がルートに作成されていること。
  - `.gitignore` が静的 SPA 構成に合わせて見直されていること（`gitignore.txt` については `.gitignore` との重複を確認し、不要であれば整理または報告）。
- **対象ファイル**:
  - 削除: `コード.js`, `appsscript.json`, `.clasp.json`, `.claspignore`（および要確認: `gitignore.txt`）
  - 新規: `.nojekyll`, `config.js`
  - 変更: `.gitignore`
- **依存関係**: なし（最初のタスク）
- **受け入れ基準**:
  - 削除対象 4 ファイルが存在しないこと。
  - `.nojekyll` と `config.js` がルートに存在し、`config.js` に秘密鍵や個人固有 ID が含まれておらず構文エラーがないこと。
- **検証方法**:
  - `node -e "require('./config.js')"` でエラーなく読み込まれ 4 プロパティが空文字列であることを確認。
  - ディレクトリ一覧で旧 GAS ファイル不在および `.nojekyll` 存在を確認。

---

### タスク [TASK-002]: ストレージ・設定管理・フォルダ解決モジュールの実装
- **ID**: TASK-002
- **目的**: クライアント側の基盤ロジック（`localStorage` 保護、ハイブリッド設定解決、フォルダ ID 抽出・検証、3層初期フォルダ解決）をテスト可能な独立 JS モジュールとして実装する。
- **入力**: セクション 3.1, 3.2, 3.3 の仕様、現行 `index.html` の `SafeStorage` / `getClientUrlFolderId` / `resolveInitialFolderId`、`コード.js` の `sanitizeFolderId_`
- **期待される結果**:
  - `js/storage.js`: `STORAGE_KEYS` と `SafeStorage` が実装されていること。
  - `js/folder-resolver.js`: `sanitizeFolderId`（256文字上限・`folders/`・`open?id=`・直接 ID 対応）、`trySanitizeFolderId`、`getClientUrlFolderId`、`resolveInitialFolderId`（`URL > LOCAL_STORAGE > DEFAULT > NONE`）が実装されていること。
  - `js/config.js`: `AppConfigProvider`（`loadConfig`, `saveConfigOverrides`, `clearConfigOverrides`, `getDefaultConfig`）が実装され、破損 JSON 防御・`defaultFolderId` 検証が行われること。
  - 3ファイルすべて UMD（ブラウザ名前空間 + Node `module.exports`）に対応していること。
- **対象ファイル**:
  - 新規: `js/storage.js`, `js/folder-resolver.js`, `js/config.js`
- **依存関係**: TASK-001
- **受け入れ基準**:
  - `SafeStorage` が例外スロー環境でクラッシュせず `null` / `false` を返すこと。
  - `AppConfigProvider` が `localStorage > config.js` の優先順位で設定を解決でき、不正 `defaultFolderId` の保存を拒否できること。
  - `resolveInitialFolderId` に `USER_PROPERTIES` が存在せず、3層＋`NONE` で判定すること。
- **検証方法**:
  - Node.js から各モジュールを `require()` し、主要関数の正常系・異常系を簡易実行確認（本検証は TASK-007 で自動化）。

---

### タスク [TASK-003]: GIS 認証管理モジュール（`js/auth.js`）の実装
- **ID**: TASK-003
- **目的**: Google Identity Services (GIS) Token Client を用いたブラウザ OAuth 2.0 認証・再認証・サインアウト・メモリ限定トークン管理を実装する。
- **入力**: セクション 3.4 の仕様、ADR-2、B-1 / B-3 決定事項
- **期待される結果**:
  - `js/auth.js` に `createAuthService`（`AuthService`）が実装されていること。
  - `drive.readonly` スコープのみを要求すること。
  - `accessToken` と `expiresAt` がクロージャ内に限定保持され、`localStorage` や `window` に一切出力されないこと。
  - `gsi/client` の非同期ロード待機、`callback` エラー・`error_callback`（ポップアップ閉鎖/ブロック）の双方のハンドリングが実装されていること。
  - `reinit(newClientId)` による設定変更時のトークン破棄・再初期化、`handleUnauthorized()` による `EXPIRED` 遷移、`signOut()` による `google.accounts.oauth2.revoke` 呼び出しが実装されていること。
- **対象ファイル**:
  - 新規: `js/auth.js`
- **依存関係**: TASK-001
- **受け入れ基準**:
  - `clientId` 未設定時は `UNCONFIGURED`、設定済み未ログイン時は `SIGNED_OUT` となること。
  - `signIn()` 成功後に `getValidToken()` がトークンを返し、有効期限（60秒マージン）後は `null` を返すこと。
  - トークンが永続ストレージ・グローバル変数に漏洩しないこと。
- **検証方法**:
  - Node.js でモック `google.accounts.oauth2` を注入して `init` → `signIn` → `getValidToken` → `handleUnauthorized` → `reinit` → `signOut` の状態遷移を検証。

---

### タスク [TASK-004]: Google Drive API v3 REST クライアント（`js/drive-api.js`）の実装
- **ID**: TASK-004
- **目的**: 現行 `コード.js` の Drive 操作を Google Drive API v3 直接 `fetch` 呼び出しへ置き換え、共有ドライブ・ページング・厳密 HTML 判定・エラー詳細分類を実装する。
- **入力**: セクション 1.2(1) レビュー所見、セクション 3.5 の仕様、ADR-3、`コード.js` の既存ビジネスロジック
- **期待される結果**:
  - `js/drive-api.js` に `createDriveApiClient`（および純粋ヘルパー `sanitizeSearchQuery`, `isHtmlDriveFile`, `formatDriveTimestamp`, `mapDriveHttpError`）が実装されていること。
  - `files.get` で `supportsAllDrives=true`、`fields=id,name,mimeType,trashed` を取得し、`mimeType === 'application/vnd.google-apps.folder'` と `!trashed` を厳密検証すること。
  - `files.list` で `name` フィールドを使用（`title` 不使用）、`supportsAllDrives=true&includeItemsFromAllDrives=true`、`pageSize=1000`、`nextPageToken` ループ（`maxPages` 上限・中断チェック付き）、`isHtmlDriveFile` ポストフィルタ（末尾 `.html`/`.htm`・`text/html`・非フォルダ）、`modifiedTime` 降順ソートを行うこと。
  - `files.get?alt=media&supportsAllDrives=true` で UTF-8 HTML を取得し、`fileNotDownloadable` 等を適切に分類すること。
  - HTTP `401`、`403`（権限不足 vs レート制限 vs API 未設定）、`404`、`429`、`5xx`/通信例外が正確に `DriveErrorCode` へマッピングされること。
- **対象ファイル**:
  - 新規: `js/drive-api.js`
- **依存関係**: TASK-002
- **受け入れ基準**:
  - Drive v3 クエリに旧 `title` が含まれないこと。
  - 1000件超（複数 `nextPageToken`）のフォルダでも全件取得できること。
  - `401` やレート制限 `403` と、無効フォルダ `404`/`TRASHED`/`NOT_A_FOLDER` が明確に区別されること。
- **検証方法**:
  - Node.js でモック `fetch` を注入し、クエリ URL・ページング・フィルタ・エラーマッピングの動作を確認。

---

### タスク [TASK-005]: Google Picker サービスモジュール（`js/picker.js`）の実装
- **ID**: TASK-005
- **目的**: GitHub Pages のファーストパーティオリジン環境向けに `gapi.load('picker')` 連携を抽出し、共有ドライブ対応および未設定時フォールバックを実装する。
- **入力**: セクション 3.6 の仕様、現行 `index.html` の `openGooglePicker` ロジック
- **期待される結果**:
  - `js/picker.js` に `createPickerService` が実装されていること。
  - `PickerBuilder` で `.setOrigin(window.location.origin)` を使用し、`google.script.host.origin` 依存が完全に除去されていること。
  - `DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true)` および `enableFeature(google.picker.Feature.SUPPORT_DRIVES)` が設定されていること。
  - `gapi` 未ロード・`apiKey` または `appId` 未設定・`accessToken` 欠落・ビルダー例外時に安全に `onFallbackToManual` を呼び出すこと。
- **対象ファイル**:
  - 新規: `js/picker.js`
- **依存関係**: TASK-001
- **受け入れ基準**:
  - `apiKey` または `appId` が空の場合にクラッシュせず手動モーダルフォールバックが呼ばれること。
  - Picker 構築時に `window.location.origin` と GIS アクセストークンが正しく設定されること。
- **検証方法**:
  - Node.js でモック `gapi.picker` および `window.location.origin` を用意して `openFolderPicker` とフォールバック分岐を検証。

---

### タスク [TASK-006]: `index.html` UI 刷新およびアプリコントローラ（`js/app.js`）の実装
- **ID**: TASK-006
- **目的**: `index.html` から GAS 依存コードを全撤去し、認証 UI・GCP 設定モーダル・セッション期限切れ再認証バナーを追加した上で、`js/app.js` による全モジュール統合を行う。
- **入力**: セクション 2.2, 3.7 の仕様、現行 `index.html`、TASK-001〜005 の成果物
- **期待される結果**:
  - `index.html`:
    - `<?= ... ?>` およびインライン `google.script.run` スクリプトが完全に除去されていること。
    - `<script src="https://accounts.google.com/gsi/client" async defer></script>` および `config.js` / `js/*.js` が正しい順序で読み込まれていること。
    - ヘッダーに「設定」ボタン・認証アクションボタン（サインイン/サインアウト）、メイン領域に未設定案内・サインイン案内・401 再認証バナー、新規に「GCP 設定モーダル」が実装されていること。
    - 既存の 2ペイン（PC）/ 排他切替（モバイル）、検索バー、手動フォルダ入力モーダル、`<iframe id="previewFrame" sandbox="allow-scripts allow-forms allow-same-origin">`、トースト通知が維持されていること。
    - ファイル一覧描画時の `escapeHtml` による XSS 防御が維持されていること。
  - `js/app.js`:
    - 認証状態（`UNCONFIGURED` / `SIGNED_OUT` / `AUTHENTICATED` / `EXPIRED`）に応じた UI 制御。
    - 認証完了後の 3層フォルダ解決（`URL > LOCAL_STORAGE > DEFAULT > NONE`）および有効フォルダの `SafeStorage.set` 保存。
    - 検索 400ms デバウンス、一覧取得リクエスト ID 排他制御（ページング中キャンセル含む）、プレビュー取得 `previewRequestId` 排他制御。
    - `401` 検知時に作業状態を保持したまま `EXPIRED` 状態へ遷移し、再認証完了後に自動復帰するリカバリー処理。
    - `handleFolderLoadError` の厳格化（`NOT_FOUND`/`FORBIDDEN`/`TRASHED`/`NOT_A_FOLDER`/`INVALID_INPUT` のみ `SafeStorage.remove` + 1回限りフォールバックを発火し、`UNAUTHORIZED` / `NETWORK_ERROR` / `RATE_LIMITED` ではフォルダ設定を保持）。
- **対象ファイル**:
  - 変更: `index.html`
  - 新規: `js/app.js`
- **依存関係**: TASK-002, TASK-003, TASK-004, TASK-005
- **受け入れ基準**:
  - `index.html` および `js/*.js` 全体に `google.script`・`<?= `・`USER_PROPERTIES` が含まれないこと。
  - `js/app.js` の主要フロー（認証→初期フォルダ解決→検索→プレビュー→401リカバリー→自己修復）が既存機能パリティを満たすこと。
- **検証方法**:
  - `index.html` の静的チェック + ローカル HTTP サーバー（例: `npx serve` / `python -m http.server`）でのコンソールエラー有無確認（実認証確認が可能な場合はブラウザ確認、未設定時は未設定→設定モーダル→サインイン UI 表示確認）。

---

### タスク [TASK-007]: テストスイート刷新（`tests/run_tests.js`, `tests/adversarial_tests.js`）と全件検証
- **ID**: TASK-007
- **目的**: GAS 依存となっていた既存テストスイートを新構成（GitHub Pages 静的 SPA + Drive API v3 + GIS + ハイブリッド設定）向けに全面更新し、単体・結合・敵対的テストを全件パスさせる。
- **入力**: セクション 4 のテスト戦略、現行 `tests/run_tests.js`, `tests/adversarial_tests.js`、TASK-001〜006 の成果物
- **期待される結果**:
  - `tests/run_tests.js`:
    - 構文・GAS 遺物ゼロ確認、`.nojekyll` / `config.js` 存在確認。
    - `SafeStorage`, `AppConfigProvider`, `FolderResolver`, `AuthService`, `DriveApiClient`（モック `fetch`）, `PickerService`（モック `gapi`）, `AppStateController` 結合シナリオの単体・結合テストが実装され、全件合格すること。
  - `tests/adversarial_tests.js`:
    - セクション 4.3 の全敵対的観点（クエリインジェクション、URL/ファイル名 XSS、トークン非永続化監査、ページング無限ループ/キャンセル、プレビュー競合、401/レート制限/ネットワーク障害時の誤消去防止、URL 無効 ID 時の自己修復無限ループ防止）が実装され、全件合格（FAIL/ISSUES=0）すること。
- **対象ファイル**:
  - 変更: `tests/run_tests.js`, `tests/adversarial_tests.js`
- **依存関係**: TASK-006
- **受け入れ基準**:
  - `node tests/run_tests.js` が終了コード `0` で全件合格すること。
  - `node tests/adversarial_tests.js` が `FAIL/ISSUES=0` で全件合格すること。
- **検証方法**:
  - `node tests/run_tests.js`
  - `node tests/adversarial_tests.js`

---

### タスク [TASK-008]: セットアップ・公開手順ドキュメント（`README.md`）の作成
- **ID**: TASK-008
- **目的**: 利用者・運用者が迷わず GCP プロジェクト構築、OAuth クライアント ID / Picker API キー設定、GitHub Pages（`master` ルート）公開を行えるよう `README.md` を整備する。
- **入力**: `ARCHITECTURE_GITHUB_PAGES.md`、TASK-001〜007 で確定した仕様・制約事項
- **期待される結果**:
  - ルートに `README.md` が作成され、以下が日本語で明記されていること:
    1. アプリ概要とファイル構成（`config.js`, `js/*`, `index.html`, `.nojekyll`）
    2. GCP セットアップ手順:
       - Google Drive API・Google Picker API の有効化
       - OAuth 同意画面設定（`drive.readonly` スコープ、テストユーザー登録 vs 本番公開審査の注意点）
       - OAuth 2.0 クライアント ID（ウェブアプリケーション）作成と「承認済み JavaScript 生成元」（パスなしオリジン `https://<user>.github.io` およびローカル用 `http://localhost:<port>`）の登録方法
       - Google Picker 用 API キー（HTTP リファラー制限＋API 制限）とプロジェクト番号（App ID）の取得方法
    3. アプリへの設定反映方法（ハイブリッド方式：`config.js` 編集 または UI 設定モーダル入力）
    4. GitHub Pages 公開手順（`Settings > Pages > Deploy from a branch > master / (root)`）
    5. ディープリンク共有方法（`?folderId=<ID>` / `?f=<ID>`）およびセキュリティ上の仕様（トークンはメモリ保持のみ、端末間同期なし）
    6. ローカル開発・テスト実行コマンド（`node tests/run_tests.js`, `node tests/adversarial_tests.js`）
- **対象ファイル**:
  - 新規: `README.md`
- **依存関係**: TASK-007
- **受け入れ基準**:
  - `README.md` 内のファイル名・設定キー名・テストコマンドが実装およびテスト結果と完全に一致していること。
- **検証方法**:
  - `README.md` 記載のコマンド実行と記述内容の突合確認。
