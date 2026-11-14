# ソフトウェア監査・最終レビュー報告書（GitHub Pages 移行・GAS バックエンド廃止）

> **監査対象**: `HttpViewer-app`（GitHub Pages 静的 SPA 移行・GAS バックエンド廃止）  
> **参照設計書**: [ARCHITECTURE_GITHUB_PAGES.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/architecture/ARCHITECTURE_GITHUB_PAGES.md)  
> **参照実装計画書**: [IMPLEMENTATION_PLAN_GITHUB_PAGES.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/plans/IMPLEMENTATION_PLAN_GITHUB_PAGES.md)  
> **参照実装報告書**: [IMPLEMENTATION_REPORT_GITHUB_PAGES.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/reports/IMPLEMENTATION_REPORT_GITHUB_PAGES.md)  
> **参照QA報告書**: [QA_REPORT_GITHUB_PAGES.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/reports/QA_REPORT_GITHUB_PAGES.md)

---

## 1. 総合リリース推奨判定

- **判定結果**: **条件付き承認 (Conditional Release Approval)**
- **判定理由サマリー**:
  - 承認済み方針（案B：GAS バックエンド完全廃止・GitHub Pages 静的 SPA 構成、B-1 ハイブリッド設定、B-2 旧 GAS ファイル完全削除、B-3 `localStorage` のみ、B-4 `master` ルート公開）および上流設計書・実装計画書の各要件に対して、実装コード一式は高い品質・凝集度・セキュリティ境界を維持して正確に実装されていることを確認した。
  - QA 工程で検出された `BUG-GP-001` 〜 `BUG-GP-010` の全 10 件についても、ソースコード精査および独立実行した自動テスト（`node -c` 全 10 ファイルエラー 0 件、`node tests/run_tests.js` 全 31 件合格、`node tests/adversarial_tests.js` 全 16 件合格）により、回帰なく解消されていることを直接確認した。コードレベルのリリース阻害欠陥（Defect）は **0 件** である。
  - 一方で、本ワークスペースにおける自動検証はすべて **Node.js 上のモック環境（モック `fetch` / モック `localStorage` / モック GIS / モック `gapi.picker`）** によるものであり、**実ブラウザ・実 Google Cloud プロジェクト・GitHub Pages 実配信環境における E2E 動作確認（AC-1〜AC-8 の実環境検証）が未検証**である。したがって、本番公開前のステージング（ローカル HTTP サーバーまたは GitHub Pages）における実環境 E2E 確認の完了をリリース条件として「条件付き承認」とする。

---

## 2. 準拠性監査

### 要件定義・受け入れ基準（AC-1〜AC-11）への準拠状況

| 基準ID | 内容 | 監査結果（証拠・確認範囲） | 準拠状況 |
| :--- | :--- | :--- | :---: |
| **AC-1** | GitHub Pages 単体動作・GAS 非依存 | 旧 GAS ファイル（`コード.js`, `appsscript.json`, `.clasp.json`, `.claspignore`, `gitignore.txt`）の完全削除、`.nojekyll`（0 バイト）配置、`index.html` および `js/*.js` に `google.script` / `<?= ... ?>` / `USER_PROPERTIES` が残存しないことを静的検査およびテストで確認。実 GitHub Pages 配信確認のみ未実施。 | 実装準拠（実配信未検証） |
| **AC-2** | OAuth 2.0 サインイン (`drive.readonly`) | `js/auth.js` にて `DEFAULT_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'` のみを指定し、GIS `initTokenClient` によるポップアップ認証・`callback`/`error_callback`・GIS 非同期ロード待機を実装。実 Google アカウントポップアップのみ未検証。 | 実装準拠（実ブラウザ未検証） |
| **AC-3** | フォルダ選択（Picker & 手動入力） | `js/picker.js` で `.setOrigin(effectiveOrigin)`（既定 `window.location.origin`）・`SUPPORT_DRIVES`・未設定/未ロード時手動フォールバックを実装。`index.html` + `js/app.js` で手動入力モーダルと `sanitizeFolderId` を実装。実 Picker 表示のみ未検証。 | 実装準拠（実 Picker 未検証） |
| **AC-4** | HTML 一覧表示 & 本文検索 | `js/drive-api.js` で `supportsAllDrives=true` / `includeItemsFromAllDrives=true`、`pageSize=1000` + `nextPageToken` ループ、`name contains` + `fullText contains`（`title` 不使用）、`isHtmlDriveFile` 厳密フィルタ、有効日時優先の降順ソート、400ms デバウンス検索を実装。実 Drive API 通信のみ未検証。 | 実装準拠（実 API 未検証） |
| **AC-5** | HTML プレビュー & レスポンシブ UI | `js/drive-api.js` の `files.get?alt=media` と `js/app.js` の `previewFrame.srcdoc` 代入、`switchMobileView`（768px 境界）および `index.html` の `<iframe id="previewFrame" sandbox="allow-scripts allow-forms allow-same-origin">` を確認。実ブラウザ描画のみ未検証。 | 実装準拠（実ブラウザ未検証） |
| **AC-6** | URL クエリパラメータ優先 (`?folderId=` / `?f=`) | `js/folder-resolver.js` の `getClientUrlFolderId` および `resolveInitialFolderId`（`URL > LOCAL_STORAGE > DEFAULT > NONE`）を実装し、`AppStateController` 結合テストで優先適用を確認済み。 | 準拠 |
| **AC-7** | 前回フォルダ復元 (`localStorage`) | `js/storage.js`（キー `html_viewer_last_folder_id`）と `js/app.js`（`applyFolder` / `executeSearch` 成功時保存・`bootstrapInitialFolder` 復元）を実装し、モック結合テストで確認済み。 | 準拠 |
| **AC-8** | トークン期限切れリカバリー (`401`) | `js/drive-api.js` で `401` およびトークン欠如を `'UNAUTHORIZED'` に分類。`js/app.js` の `routeUnauthorizedOrAbort` によりフォルダ設定と作業状態（`currentFolderId` / 検索語 / プレビュー）を保持したまま `EXPIRED` 状態へ遷移し、再認証後に `pendingRetryAction` を自動再開することを確認済み。 | 準拠 |
| **AC-9** | 無効フォルダ自己修復 | `js/app.js` の `SELF_HEAL_ERROR_CODES`（`NOT_FOUND`, `FORBIDDEN`, `TRASHED`, `NOT_A_FOLDER`, `INVALID_INPUT`）のみ `LAST_FOLDER_ID` 削除 + `hasAttemptedFallback` ガード付き 1 回限りのデフォルトフォールバックを実行。`401` / `429` / `403 rateLimitExceeded` / `5xx` では削除しないことを `ADV-REC-001` / `ADV-REC-002` で確認済み。 | 準拠 |
| **AC-10** | `localStorage` 遮断時の例外保護 | `js/storage.js` の `SafeStorage` が `get` / `set` / `remove` すべてを `try-catch` で保護し、`SecurityError` 送出時・`localStorage` 未定義時でも `null` / `false` を返して継続動作することをテストで確認済み。 | 準拠 |
| **AC-11** | 機密情報の非露出・XSS・クエリインジェクション対策 | 配信ファイル全体に `client_secret` 記述なし。`accessToken` / `expiresAt` は `js/auth.js` クロージャ変数のみに保持され `localStorage` / `AuthState` / `window` に非露出。`escapeHtml`、`sanitizeFolderId`（256 文字/2048 文字上限）、`sanitizeSearchQuery`（制御文字正規化・`\`/`'` エスケープ）を実装し、`ADV-INJ-001` / `ADV-XSS-001` / `ADV-XSS-002` / `ADV-SEC-001` / `ADV-SEC-002` で確認済み。 | 準拠 |

### システムアーキテクチャ・ユーザー承認方針への準拠状況
- **案B（完全サーバーレス静的 SPA）**: 準拠。GAS 依存をすべて排除し、ブラウザから GIS / Google Picker / Drive API v3 へ直接通信する構造が `ARCHITECTURE_GITHUB_PAGES.md` のシステム境界図通り実装されている。
- **B-1（ハイブリッド設定）**: 準拠。`config.js`（空テンプレート `APP_DEFAULT_CONFIG`）と `js/config.js`（`AppConfigProvider`：`localStorage > config.js > ''` の解決・出典情報・差分オーバーライド保存・`clientId` 必須検証・リセット）および `index.html` の「GCP 接続設定」モーダルが仕様通り実装されている。
- **B-2（旧 GAS ファイル完全削除）**: 準拠。`git status -s` にて `コード.js`, `appsscript.json`, `gitignore.txt` の削除（`D`）を確認し、`.clasp.json`, `.claspignore` もワークスペース内に存在しないことを確認した。
- **B-3（`localStorage` のみ・最小権限維持）**: 準拠。`drive.appdata` スコープは追加せず、`drive.readonly` のみで完結している。
- **B-4（`master` ルート公開）**: 準拠。ルートに 0 バイトの `.nojekyll`、`index.html`、`config.js`、`js/*.js` が配置され、`README.md` にも `master` / `/ (root)` の公開手順が明記されている。

### 実装計画書（TASK-001〜TASK-008）への準拠状況
- `TASK-001` 〜 `TASK-008` の成果物構成・スクリプト読み込み順（`config.js` → `js/storage.js` → `js/folder-resolver.js` → `js/config.js` → `js/auth.js` → `js/drive-api.js` → `js/picker.js` → `js/app.js`）・UMD デュアルエクスポート方式・日本語コメントおよびドキュメント規約まで忠実に準拠している。

---

## 3. 品質・技術的負債監査

### コード品質 / 保守性 / シンプルさ
- 各モジュールは IIFE + UMD（`module.exports` と `window.HttpViewer` 名前空間）で統一されており、ビルドツール不要の GitHub Pages 運用と Node.js 自動テストの両立を最小限の複雑性で実現している。
- 重複ロジックの排除も適切に行われている（例：`js/drive-api.js` の `getHtmlFileList` と `searchHtmlFiles` が共通の `fetchHtmlFilesInternal` を再利用、`js/app.js` の `routeUnauthorizedOrAbort` / `cancelPendingSearch` / `rollbackPreviewSelection` による状態操作の集約）。
- すべてのファイルにプレースホルダー（`TODO` / `省略`）や LaTeX 誤記（`\vert` / `\mid`）が存在せず、JSDoc およびコメント・エラーメッセージは自然で丁寧な日本語で統一されている。

### 結合度と凝集度
- **高凝集**:
  - `js/storage.js`: 例外遮断ストレージ操作とキー定数に専念。
  - `js/folder-resolver.js`: フォルダ ID 抽出・検証・3 層優先解決の純粋ロジックに専念。
  - `js/config.js`: ハイブリッド設定の読み込み・検証・差分保存・リセットに専念。
  - `js/auth.js`: GIS 待機・トークンライフサイクル・世代管理・メモリ限定保持に専念。
  - `js/drive-api.js`: Drive API v3 REST 通信・ページング・クエリ構築・エラー分類に専念。
  - `js/picker.js`: Google Picker 構築とフォールバック判定に専念。
  - `js/app.js`: DOM アダプター（`createDomUiAdapter`）と状態調停コントローラ（`createAppController`）を分離し、UI モックによる結合テストを可能にしている。
- **低結合**: すべてのサービスモジュールがオプション注入（`fetchImpl`, `getGoogleOAuth2`, `getGapi`, `getGooglePicker`, `storage`, `ui` 等）をサポートしており、外部環境への密結合がない。

### エラーハンドリング・セキュリティ
- **エラー分類の正確さ**: `401`（認証切れ）と `403` の詳細理由（`rateLimitExceeded` / `userRateLimitExceeded` / `dailyLimitExceeded` → `RATE_LIMITED`、`accessNotConfigured` → `API_DISABLED`、`fileNotDownloadable` → `NOT_DOWNLOADABLE`、その他 → `FORBIDDEN`）、`404`、`429`、`5xx`/通信例外が適切に区別されており、一時障害や認証切れで保存済みフォルダが誤消去される欠陥を防いでいる。
- **非同期競合・状態遷移保護**: `js/auth.js` の `authGeneration` / `clientGeneration` / `cancelGisWaitIfAny`、`js/drive-api.js` の `signal.isCancelled()`、`js/app.js` の `currentSearchRequestId` / `currentPreviewRequestId` / `cancelPendingSearch()` により、高速操作・タイムアウト・設定変更時のレースコンディションが丁寧に抑止されている。
- **セキュリティ防衛線**: `accessToken` / `expiresAt` のクロージャ隔離に加え、`js/drive-api.js` L188 で `fetch.bind(globalThis)` を初期化時に束縛しているため、後から `window.fetch` を差し替えてトークンを奪取する攻撃経路も遮断されている。ただし、`<iframe sandbox="allow-scripts allow-forms allow-same-origin">` に関する既知の信頼境界リスクは次節「リスク」に明記する。

### テスト網羅性・適切性（監査人による独立実行結果）
本監査において、以下のコマンドをワークスペース上で直接実行し、全件合格を自身の目で確認した。

1. **全 `.js` ファイル構文チェック（`node -c`）**:
   - 対象: `config.js`, `js/storage.js`, `js/folder-resolver.js`, `js/config.js`, `js/auth.js`, `js/drive-api.js`, `js/picker.js`, `js/app.js`, `tests/run_tests.js`, `tests/adversarial_tests.js`（計 10 ファイル）
   - 結果: 終了コード `0`（`ALL_SYNTAX_OK`、エラー 0 件）
2. **禁止文字列および `.nojekyll` 確認**:
   - `index.html`, `config.js`, `js/*.js` に `google.script`, `USER_PROPERTIES`, `client_secret`, `\vert`, `\mid`, `TODO` が含まれないことを確認。`.nojekyll` が `0` バイトで存在することを確認。
3. **単体・結合テスト（`node tests/run_tests.js`）**:
   - 結果: 終了コード `0` — `テスト結果: 全 31 件中 31 件合格, 0 件失敗`
   - 範囲: 構文・静的資産・DOM ID 整合性（`js/app.js` 内 `getElementById` と `index.html` の突合）・GAS 廃止チェック（5 件）、`SafeStorage`（3 件）、`FolderResolver`（4 件）、`AppConfigProvider`（3 件）、`AuthService`（5 件）、`DriveApiClient`（4 件）、`PickerService`（2 件）、`AppStateController` 結合シナリオ及び `BUG-GP-006`〜`BUG-GP-010` 回帰検証（5 件）。
4. **敵対的・セキュリティ・境界値テスト（`node tests/adversarial_tests.js`）**:
   - 結果: 終了コード `0` — `QA Adversarial Suite Finished: PASS=16, FAIL/ISSUES=0`
   - 範囲: Drive クエリインジェクション無害化、URL パラメータ/ファイル名 XSS 防御、長大入力拒否、トークン非永続化・非露出、静的ファイル機密/GAS 遺物ゼロ確認、GIS ロード待機中断（`BUG-GP-001`）、サインアウト後検索による `EXPIRED` 誤遷移防止（`BUG-GP-003`）、`AUTHENTICATING` 中の `reinit` 状態クリアと旧ポップアップ干渉防止（`BUG-GP-005`）、無限ページネーション停止、ページングキャンセル、プレビュー競合・フォルダ切替時遅延描画防止（`BUG-GP-002`）、検索デバウンス競合防止（`BUG-GP-004`）、一時障害/401 時設定保持、1 回限り自己修復停止。

### 長期的運用リスク・技術的負債
- ビルドツールや外部 npm 依存を持たない（`package.json` レス）構成は、GitHub Pages でのゼロ維持コストという目標に合致しており、長期的なビルド破損リスクが低い。
- 一方で、Google Cloud Console の仕様変更（OAuth 同意画面審査要件や GIS/Picker API の挙動変更）およびブラウザのサードパーティ/ポップアップ規制は外部要因であり、運用手順（[README.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/README.md)）に沿った実環境での疎通確認が継続運用の前提となる。

---

## 4. 指摘事項一覧 (区分別)

### [欠陥 / Defect]
- **該当なし（0 件）**
  - 要件・設計・実装・テストの突合において、仕様違反や動作不良は確認されなかった。

### [リスク / Risk]

1. **実ブラウザ・実 Google Cloud 環境での E2E 動作が未検証（リリース前提条件）**
   - **証拠**: [QA_REPORT_GITHUB_PAGES.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/reports/QA_REPORT_GITHUB_PAGES.md#L20-L21), [L331](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/reports/QA_REPORT_GITHUB_PAGES.md#L331) および [tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js), [tests/adversarial_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/adversarial_tests.js)（すべて Node.js モックによる検証）。
   - **影響**: Google Cloud Console 上の「承認済み JavaScript 生成元」（パスなしオリジン登録）、API キーの HTTP リファラー制限、OAuth 同意画面のテストユーザー登録、実ブラウザ上での GIS ポップアップ承認、実 Google Drive API v3 の `name contains '.html'` / `fullText contains` / 共有ドライブ / CORS 応答、実 Google Picker の表示はモックでは再現しきれないため、実環境での疎通確認なしに公開すると初回設定や実通信で不具合が顕在化する恐れがある。
   - **関連要件**: AC-1 〜 AC-8、NFR-2、NFR-4。

2. **`<iframe sandbox="allow-scripts allow-forms allow-same-origin">` と未信頼 `?folderId=` 組み合わせ時の同一オリジン信頼境界リスク（設計踏襲・残存リスク）**
   - **証拠**: [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html#L217-L221) の `sandbox="allow-scripts allow-forms allow-same-origin"`、および [ARCHITECTURE_GITHUB_PAGES.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/architecture/ARCHITECTURE_GITHUB_PAGES.md#L458-L460), [QA_REPORT_GITHUB_PAGES.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/reports/QA_REPORT_GITHUB_PAGES.md#L283-L290)。
   - **影響**: OAuth アクセストークン自体は `js/auth.js` クロージャ変数内に隔離され、`js/drive-api.js` L188 で `fetch.bind(globalThis)` を保持しているためトークン直接窃取リスクは低減されている。しかし、`allow-scripts` と `allow-same-origin` の併用により、第三者から共有された `?folderId=` 等で悪意ある HTML をプレビューした場合、iframe 内スクリプトから `window.parent.document`（偽 UI 描画等）や `window.parent.localStorage`（`html_viewer_app_config` / `html_viewer_last_folder_id` の読み書き）へ技術的にアクセス可能である。「信頼できる自身のドライブ内 HTML を閲覧する」現行前提を逸脱した運用をする場合にリスクが顕在化する。
   - **関連要件 / 設計原則**: NFR-2、ADR 品質特性（セキュリティ）。

3. **外部 CDN（Tailwind CSS / GIS / Google API Loader）の可用性・ブラウザブロック依存**
   - **証拠**: [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html#L7-L11)。
   - **影響**: 広告ブロッカーや企業ネットワーク制限等により `accounts.google.com/gsi/client` や `apis.google.com/js/api.js`、`cdn.tailwindcss.com` が遮断された場合、認証失敗エラーやレイアウト崩れが発生する（GIS はタイムアウトエラー通知、Picker は手動入力フォールバックで緩和済み）。
   - **関連要件**: NFR-1、NFR-5。

### [改善提案 / Suggestion]

1. **ハイブリッド設定（`js/config.js`）で `config.js` に任意項目既定値がある場合の空値入力時挙動の補足**
   - **証拠**: [js/config.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/config.js#L199-L205) にて `val !== '' && val !== defaults[key]` のみ `diffOverrides` に保存する実装（[IMPLEMENTATION_PLAN_GITHUB_PAGES.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/plans/IMPLEMENTATION_PLAN_GITHUB_PAGES.md#L202) の仕様に準拠）。
   - **内容**: `config.js` に `apiKey` や `defaultFolderId` が事前配布されている環境で、ユーザーが設定モーダルからその欄を空にして保存しても `config.js` 側の既定値が再度採用される。不具合ではないが、将来的に「配布された `defaultFolderId` や `apiKey` を個別ブラウザで無効化したい」運用が生じた場合は、空上書き用フラグまたは UI 説明の追加を検討するとより親切である。

2. **`js/drive-api.js` におけるレスポンス由来 `folder.id` の防御的検証**
   - **証拠**: [js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js#L311-L330) にて `getFolderDetails(folderIdOrUrl)`（内部で `sanitizeFolderId` 実行）を通過後、API 応答 JSON の `folder.id` を用いて `baseQuery` を構築している。
   - **内容**: 実質的には同一 ID が返るため問題ないが、多層防御の観点から `folder.id` に対してもクエリ結合前に形式チェック（`/^[a-zA-Z0-9_-]+$/`）を行うとさらに堅牢になる。

3. **実ブラウザ DOM イベント配線の自動 E2E 化（任意拡張）**
   - **証拠**: [tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js#L241-L266) で `getElementById` の ID 存在網羅は確認されているが、`mountBrowserApp()` 自体の実 DOM イベント発火テストは `package.json` レス構成のため未実施。
   - **内容**: 現状の手動 E2E 確認で十分カバー可能だが、将来継続的に機能追加する場合は Playwright 等によるブラウザ E2E テストの追加が保守性向上に寄与する。

### [アーキテクチャ上の懸念事項 / Architectural Concern]
- **該当なし（0 件）**
  - 上流のアーキテクチャ決定（ADR-1〜ADR-6、案B、B-1〜B-4）は一貫性を保っており、設計上の破綻や矛盾は認められない（`<iframe sandbox>` 境界については既知の設計前提として上記リスク 2 に整理済み）。

---

## 5. リリース条件・推奨される次の手順（条件付き承認）

本判定は**条件付き承認**であるため、差し戻しは行わず、GitHub Pages 本番運用開始前に以下の実環境確認チェックリストを完了することを推奨する。

1. **Google Cloud Console 設定の確認**:
   - Google Drive API および（Picker 利用時は）Google Picker API が有効化されていること。
   - OAuth 2.0 クライアント ID（ウェブアプリケーション）の「承認済み JavaScript 生成元」に、パスなしのオリジン（例：`https://<username>.github.io`、および検証用の `http://localhost:8080`）が登録されていること。
   - Picker 用 API キーを使用する場合、HTTP リファラー制限と Google Picker API のみの API 制限が設定されていること。
2. **実ブラウザ・実アカウントでの E2E 疎通確認**（[README.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/README.md) の手順に従って実施）:
   - ローカル HTTP サーバー（`http://localhost:8080`）または GitHub Pages（`master` / `/ (root)`）上で以下を目視・操作確認すること：
     1. `config.js` 空状態での「初期設定が必要です」表示 → 「GCP 接続設定」モーダルでの `Client ID` 保存 → 「サインイン」画面遷移。
     2. 「Google でサインイン」による GIS ポップアップ同意とトークン取得（コンソールエラーなし）。
     3. Google Picker ダイアログ表示（または `apiKey`/`appId` 空時の手動入力モーダルフォールバック）によるフォルダ切替、共有ドライブ内フォルダの動作確認。
     4. HTML ファイル一覧の更新日時降順表示、ファイル名・本文（`fullText`）検索、検索クリア、PC 2 ペイン / モバイル画面切替、HTML プレビュー表示・再読込。
     5. `?folderId=<ID>` / `?f=<ID>` ディープリンク優先、リロード後の `localStorage` からの前回フォルダ復元（再度サインイン後）。
     6. サインアウト操作による一覧・プレビューのクリア。
