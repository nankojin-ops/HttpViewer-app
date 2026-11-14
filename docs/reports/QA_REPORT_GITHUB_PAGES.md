# QA検証レポート（GitHub Pages 静的 SPA 構成）

## 1. 検証サマリー

- **検証対象**:
  - 設計書・実装計画書: [ARCHITECTURE_GITHUB_PAGES.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/architecture/ARCHITECTURE_GITHUB_PAGES.md), [IMPLEMENTATION_PLAN_GITHUB_PAGES.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/plans/IMPLEMENTATION_PLAN_GITHUB_PAGES.md)
  - 実装ファイル一式: [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html), [config.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/config.js), [js/storage.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/storage.js), [js/folder-resolver.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/folder-resolver.js), [js/config.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/config.js), [js/auth.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js), [js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js), [js/picker.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/picker.js), [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js), [README.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/README.md), [.nojekyll](file:///c:/Users/nanko/Downloads/HttpViewer-app/.nojekyll), [.gitignore](file:///c:/Users/nanko/Downloads/HttpViewer-app/.gitignore)
  - テストスイート: [tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js), [tests/adversarial_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/adversarial_tests.js)

- **テスト実施ステータス**:
  - **実行済み**:
    - 単体・結合テストスイート（`node tests/run_tests.js`: 全 27 件 PASS / 0 件 FAIL、終了コード 0）
    - 敵対的・セキュリティテストスイート（`node tests/adversarial_tests.js`: 全 11 件 PASS / 0 件 FAIL、終了コード 0）
    - Node.js 静的突合チェック（`index.html` と `js/app.js` 間の全 54 個の `getElementById` 参照 ID 整合性確認：欠損 0 件）
    - Node.js による障害モード再現スクリプト実行（`BUG-GP-001`, `BUG-GP-002`, `BUG-GP-003`, `BUG-GP-005`, `BUG-GP-008` の実動作再現を確認）
  - **検査済み**:
    - 全ソースファイル・設計書・計画書・テストコードの静的コード精査（認証ライフサイクル、Drive API v3 パラメータ、非同期競合制御、設定モーダル B-1、XSS/トークン非永続化、テストの抜け穴）
  - **推論済み**:
    - ブラウザ実環境における Tailwind CSS CDN のユーティリティ適用順、Google Identity Services (`gsi/client`) ポップアップ挙動、Google Drive API v3 実エンドポイントにおける制御文字・CORS・レート制限挙動、および `<iframe sandbox="allow-scripts allow-forms allow-same-origin">` の同一オリジン境界影響
  - **未検証**:
    - 実ブラウザ + 実 Google アカウント + 実 Google Cloud プロジェクト（GitHub Pages / `localhost`）での E2E 手動操作検証

- **総合評価**: **合格（QA クリア）** ※初回検証時は「要修正 (Action Required)」であったが、`BUG-GP-001` 〜 `BUG-GP-010` の修正および再検証により全件解消・新規回帰なしを確認（詳細: 「5. 再検証結果」参照）
  - 既存の自動テスト（27件 + 11件）はすべて合格し、GAS 遺物除去・トークン非永続化・共有ドライブ対応・Drive v3 ページング・基本的な `401` リカバリー等の主要基盤は堅実に実装されています。
  - 一方で、批判的・敵対的検証により、**認証状態遷移の競合（`BUG-GP-001`, `BUG-GP-003`, `BUG-GP-005`）**、**フォルダ切替時のプレビュー上書きレースコンディション（`BUG-GP-002`）**、**検索クリア時のデバウンス競合（`BUG-GP-004`）**、**再認証・エラー時 UI 不整合（`BUG-GP-006`, `BUG-GP-007`, `BUG-GP-008`, `BUG-GP-009`）**、および **Drive v3 クエリ境界/テストスイートのアサーション抜け穴（`BUG-GP-010`）** が検出されました。修正対応が必要です。

---

## 2. 観点別テスト結果（12大検証項目）

| # | 検証項目 | ステータス | 判定 | 主な検証内容・所見 |
| :---: | :--- | :---: | :---: | :--- |
| 1 | **機能の正確性** | 実行済み / 検査済み | **要修正** | `index.html` と `js/app.js` 間の全 54 DOM ID は完全一致。一覧・検索・3層フォルダ解決・Picker フォールバックの基本機能は正常。ただし未選択時の件数表示上書き（`BUG-GP-008`）やプレビュー失敗時の表示不整合（`BUG-GP-007`）あり。 |
| 2 | **エッジケース** | 検査済み / 推論済み | **要修正** | サイズ `0`/欠損、`.HTM` 大文字拡張子、`fileNotDownloadable`、共有ドライブ、`open?id=` URL 等は適切に処理。ただし `reloadPreview` の 0 バイト HTML 無反応、設定モーダルの必須入力空保存、検索語内の改行/制御文字扱いに課題（`BUG-GP-009`, `BUG-GP-010`）。 |
| 3 | **境界条件** | 実行済み / 検査済み | **合格（軽微指摘あり）** | `sanitizeFolderId` の 256 文字/2048 文字上限、`maxPages` 上限（20ページ）と `seenTokens` ループ検出、60 秒トークンマージンは正確に機能。不正 `modifiedTime` 混在時のフォールバック比較のみ軽微課題（`BUG-GP-010`）。 |
| 4 | **無効な入力** | 実行済み / 検査済み | **要修正** | `?folderId=';alert(1);//` や破損 JSON、不正 `appId` は適切に拒否・無害化。一方、設定モーダルで必須の `OAuth Client ID` を空にしても保存成功扱いとなる（`BUG-GP-009`）。 |
| 5 | **エラー処理** | 実行済み / 検査済み | **要修正** | `403` の理由コード分類（`rateLimitExceeded` / `accessNotConfigured` / `fileNotDownloadable` / 権限不足）および `SafeStorage` 例外遮断は優秀。ただし `openFolderSelection()` がトークン失効を `EXPIRED` へ遷移させず、`manualFolderModal` 内 `401` で再認証操作がブロックされる（`BUG-GP-006`）。 |
| 6 | **セキュリティ** | 実行済み / 検査済み / 推論済み | **条件付き合格（要エスカレーション）** | `accessToken` / `expiresAt` はクロージャ変数限定で `localStorage`/`window`/`AuthState` に非露出。`escapeHtml`・`sanitizeFolderId`・`sanitizeSearchQuery` も実装済み。ただし上流 ADR で維持した `<iframe sandbox="allow-scripts allow-forms allow-same-origin">` と外部共有 `?folderId=` 組み合わせ時の親 DOM/`localStorage` 露出リスクを Section 4 で報告。 |
| 7 | **並行性** | 実行済み / 検査済み | **要修正** | `selectFile` 同士・`files.list` ページング間の競合抑止はあるが、①GIS ロード待機中の `signOut`/`reinit` 非中断（`BUG-GP-001`）、②`applyFolder` と進行中 `selectFile` の競合（`BUG-GP-002`）、③検索デバウンスと `clearSearchBtn`/`signOut` の競合（`BUG-GP-003`, `BUG-GP-004`）が存在。 |
| 8 | **信頼性** | 実行済み / 検査済み | **要修正** | `401`/`429`/`5xx` 時に `LAST_FOLDER_ID` を保持する点は良好。一方、`SIGNED_OUT` 状態での操作が `EXPIRED` 状態へ誤遷移する致命的状態破壊（`BUG-GP-003`）および再認証中 `reinit` 時の状態残留（`BUG-GP-005`）により信頼性が損なわれる。 |
| 9 | **パフォーマンス** | 検査済み | **合格** | `fields` 限定取得、`pageSize=1000`、400ms デバウンス、ページ間キャンセル判定が適切。 |
| 10 | **データ整合性** | 実行済み / 検査済み | **要修正** | `applyFolder` 後に前フォルダのプレビューが描画される不整合（`BUG-GP-002`）、エラー時に `activeFileId`/`currentFileName` と `srcdoc` が乖離する不整合（`BUG-GP-007`）を確認。 |
| 11 | **後方互換性** | 実行済み / 検査済み | **合格** | `?folderId=` / `?f=`、`html_viewer_last_folder_id` キー、PC/モバイル 2 ペイン、`<iframe sandbox>` 属性が仕様通り維持されている。 |
| 12 | **回帰リスク** | 実行済み / 検査済み | **要修正** | 既存テストは全件合格しているが、実 DOM 配線テストや `401` 後の検索再実行アサーション、`applyFolder` 競合テストが欠落しており回帰検知網に盲点あり（`BUG-GP-010`）。 |

---

## 3. 発見された不具合・課題一覧 (Issue票)

### [BUG-GP-001]: `AuthService.signIn()` の GIS ロード待機中に `reinit()` / `signOut()` が呼ばれても中断されず、設定削除後やサインアウト後に認証ポップアップ起動・トークン取得が行われる
- **重大度**: **High**
- **関連要件/受け入れ基準**: FR-8, FR-9, NFR-2, AC-2
- **再現手順**:
  1. GIS ライブラリ（`https://accounts.google.com/gsi/client`）が遅延読み込み中（`waitForGisOAuth2` が 100ms ポーリング待機中）に、ユーザーがサインイン操作（`authService.signIn()`）を実行する。
  2. ライブラリ読み込み完了前に、ユーザーが設定モーダルから `Client ID` を空にして保存（`authService.reinit('')` → `UNCONFIGURED`）、または `authService.signOut()` を実行する。
  3. その後 `google.accounts.oauth2` がロードされる。
- **期待される動作**:
  - `init()` / `reinit()` / `signOut()` 実行時点で待機中の `waitForGisOAuth2`（および `signIn` フロー）が即座にキャンセル・中断され、後続の `initTokenClient` や `requestAccessToken` が呼ばれないこと。
- **実際の動作**:
  - `waitForGisOAuth2` 待機中は `pendingRequest` がまだ `null` であるため、`rejectPendingIfAny()` が何もせず素通りする（[js/auth.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js#L213), [L231](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js#L231), [L273-L288](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js#L273-L288), [L316](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js#L316)）。
  - ライブラリ到着後に `ensureTokenClient` が空の `client_id: ''` 等で `initTokenClient` を実行し、`requestAccessToken()` を呼び出してしまう。
- **証拠・ログ**:
  - Node.js 再現スクリプト（`waitForGisOAuth2` 待機中に `reinit('')` を実行）の出力：
    ```text
    Repro 3 (initClientIds, requestCalls, final status): [ '' ] 1 AUTHENTICATED
    ```
    `UNCONFIGURED` に戻したにもかかわらず `client_id: ''` でトークンクライアントが初期化され、状態が `AUTHENTICATED` に上書きされた。
- **考えられる原因**: **実装起因**
  - `signIn()` に世代番号（リクエスト ID / キャンセルフラグ）がなく、非同期の `waitForGisOAuth2` 完了後に状態変更有無を検証していない。
- **推奨される次の対応**: **シニアコーダー修正**
  - `auth.js` 内に認証要求トークン/世代カウンタ（`authGeneration` 等）を導入し、`init` / `reinit` / `signOut` / 新規 `signIn` の度にインクリメントして、古い待機タイマーおよび `.then()` 以降の `initTokenClient` / `requestAccessToken` 実行を確実に中断・破棄する。

---

### [BUG-GP-002]: `applyFolder` 実行時に進行中のプレビュー取得（`currentPreviewRequestId`）が無効化されず、旧フォルダの HTML が新フォルダのプレビュー欄へ描画される
- **重大度**: **High**
- **関連要件/受け入れ基準**: FR-1, FR-4, NFR-4, AC-3, AC-5
- **再現手順**:
  1. フォルダ A を開き、サイズの大きい（または回線遅延のある）HTML ファイル `file_A` をクリックしてプレビュー取得を開始する（`selectFile(file_A)` 実行中）。
  2. `file_A` の `getHtmlFileContent` 応答が返る前に、Google Picker または手動入力モーダルでフォルダ B へ切り替える（`applyFolder('f2', 'Folder 2')`）。
  3. フォルダ B の画面に切り替わりプレビューがリセットされた後、遅延していた `file_A` の応答が返却される。
- **期待される動作**:
  - フォルダ切り替え時点で古いプレビュー要求は無効化され、後から届いた `file_A` の応答は破棄されること。
- **実際の動作**:
  - `clearWorkingViewState()`（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L561)）では `currentPreviewRequestId++` を行っているが、`applyFolder()`（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L569-L582)）では `currentPreviewRequestId` をインクリメントしていない。
  - そのため `selectFile` 内の `reqId !== currentPreviewRequestId` チェック（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L695)）を通過し、`previewFrame.srcdoc` に旧フォルダの HTML が書き込まれ、`status` も「表示中」へ上書きされる（さらに `emptyState` は `resetPreview()` で再表示されたまま背面へ書き込まれるか、`401` 等のエラー時は旧ファイル起因のエラー通知が出る）。
- **証拠・ログ**:
  - Node.js 再現スクリプト出力：
    ```text
    Repro 2 (previews after applyFolder): [ '__RESET__', '<h1>OLD_FOLDER_FILE_A</h1>' ]
    ```
- **考えられる原因**: **実装起因**
  - `applyFolder` における `resetPreview()` 呼び出し時の `currentPreviewRequestId` インクリメント漏れ。
- **推奨される次の対応**: **シニアコーダー修正**
  - `applyFolder()`（または `ui.resetPreview()` を伴う状態リセット処理）内で必ず `currentPreviewRequestId++` を実行し、`adversarial_tests.js` の `ADV-CON-002` に「プレビュー取得中のフォルダ切り替え」ケースを追加する。

---

### [BUG-GP-003]: 未認証（`SIGNED_OUT` / `UNCONFIGURED` / `AUTHENTICATING`）状態での `executeSearch` 等呼び出しが `handleUnauthorized()` を発火し、`SIGNED_OUT` から `EXPIRED` へ誤遷移する
- **重大度**: **High**
- **関連要件/受け入れ基準**: FR-8, NFR-5, AC-2, AC-8
- **再現手順**:
  1. サインイン状態で検索欄（`#searchInput`）に文字を入力する（400ms デバウンスタイマーがセットされる）。
  2. 400ms 以内にヘッダーの「サインアウト」ボタンをクリックし、`SIGNED_OUT` 状態へ遷移させる（一覧とプレビューがクリアされ、`#authOverlay` のサインイン案内が表示される）。
  3. 直後に 400ms デバウンスタイマーが満了し、`controller.executeSearch(val)` が発火する。
- **期待される動作**:
  - 既に `SIGNED_OUT`（または `UNCONFIGURED` / `AUTHENTICATING`）である場合は `EXPIRED`（セッション期限切れ）へ遷移せず、検索処理を安全にスキップするかサインインを促すにとどめること。またサインアウト時に保留中の検索デバウンスタイマーはキャンセルされること。
- **実際の動作**:
  - `executeSearch`（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L612-L615)）、`selectFile`（[L681-L684](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L681-L684)）、`submitManualFolder`（[L813-L816](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L813-L816)）がいずれも `!authService.getValidToken()` のみで無条件に `authService.handleUnauthorized()` を呼び出す。
  - `handleUnauthorized()`（[js/auth.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js#L348-L358)）は現在ステータスを確認せず `status = 'EXPIRED'` を設定するため、`SIGNED_OUT` から `EXPIRED` へ逆戻りする。
  - 結果として `renderAuthState` が `#authOverlay` を非表示にし（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L367-L373)）、サインアウト直後の空画面に「セッションの有効期限が切れました。作業中の状態は保持されています。」バナーが出現する。
- **証拠・ログ**:
  - Node.js 再現スクリプト出力：
    ```text
    Repro 1 (status after executeSearch while SIGNED_OUT): EXPIRED
    ```
- **考えられる原因**: **実装起因**
  - 「認証済み状態からのトークン期限切れ」と「未ログイン状態でのトークン不在」が区別されておらず、さらに `mountBrowserApp` 側の `searchDebounceTimer` がサインアウト時にクリアされていない。
- **推奨される次の対応**: **シニアコーダー修正**
  - `handleUnauthorized()` は `AUTHENTICATED` または `EXPIRED`（あるいは既存の認証試行が切れた場合）のみ `EXPIRED` に遷移させ、`SIGNED_OUT` / `UNCONFIGURED` / `AUTHENTICATING` を上書きしないようガードする。併せて `executeSearch` / `selectFile` / `submitManualFolder` 側およびサインアウト時のデバウンスタイマー破棄を整備する。

---

### [BUG-GP-004]: 検索クリア（`clearSearchBtn`）および更新（`refreshBtn`）操作時に保留中の 400ms 検索デバウンスタイマーがキャンセルされず、全件一覧が古い検索結果で上書きされる
- **重大度**: **Medium**
- **関連要件/受け入れ基準**: FR-3, NFR-4
- **再現手順**:
  1. `#searchInput` に `"test"` と入力する（400ms 後に `executeSearch("test")` を呼ぶタイマーが登録される）。
  2. 400ms 経過前に `#clearSearchBtn`（クリアボタン）をクリックする。
  3. クリア処理は即座に `ui.clearSearchInput()` と `controller.executeSearch('')` を呼び出し、全件一覧を取得する。
  4. 数百ミリ秒後、未キャンセルの `searchDebounceTimer` が発火し、`controller.executeSearch('test')` を後から実行する。
- **期待される動作**:
  - クリア操作または更新操作の時点で保留中の `searchDebounceTimer` が `clearTimeout` され、後から古い検索語で上書きされないこと。
- **実際の動作**:
  - `#searchInput` の `input` リスナー（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1000)）では `clearTimeout(searchDebounceTimer)` を行っているが、`#clearSearchBtn`（[L1008-L1012](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1008-L1012)）および `#refreshBtn`（[L1016-L1018](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1016-L1018)）では `clearTimeout(searchDebounceTimer)` を呼んでいない。
  - 後発の `executeSearch('test')` の方が新しい `requestId` を得るため、検索欄が空のまま `"test"` の絞り込み結果が表示され続ける。
- **証拠・ログ**:
  - [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1007-L1019) の静的コード検査で確認。
- **考えられる原因**: **実装起因**
  - クリア／更新ハンドラにおけるデバウンスタイマー解除漏れ。
- **推奨される次の対応**: **シニアコーダー修正**
  - `#clearSearchBtn` および `#refreshBtn` のクリックハンドラ冒頭に `clearTimeout(searchDebounceTimer);` を追加する。

---

### [BUG-GP-005]: `EXPIRED` → `AUTHENTICATING` 遷移中に設定モーダルから `clientId` を変更（`reinit`）すると、旧アカウントの画面状態（フォルダ・プレビュー HTML・保留アクション）がクリアされず残留する
- **重大度**: **Medium**
- **関連要件/受け入れ基準**: FR-8, FR-9, NFR-2
- **再現手順**:
  1. アカウント/プロジェクト A でサインインし、機密 HTML をプレビュー表示中にトークンが期限切れ（`EXPIRED`）になる（または `pendingRetryAction` が設定される）。
  2. ユーザーが「再認証」をクリックして `AUTHENTICATING` 状態になる（ポップアップ表示中もヘッダーの歯車ボタン `#openSettingsBtn` は `z-40` で操作可能）。
  3. ユーザーが歯車ボタンから設定モーダルを開き、`OAuth Client ID` を別の値へ変更して保存する（`authService.reinit(newClientId)` 実行 → `SIGNED_OUT` へ遷移）。
- **期待される動作**:
  - `reinit()` により別クライアント設定へ切り替わった際は、`clearWorkingViewState()` が実行され、前のフォルダ ID・検索欄・ファイル一覧・`previewFrame.srcdoc`・`pendingRetryAction` が確実に破棄されること。
- **実際の動作**:
  - `handleAuthStateChange`（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L748-L754)）が `if (prevStatus === 'AUTHENTICATED' || prevStatus === 'EXPIRED')` の場合のみ `clearWorkingViewState()` を呼び出している。
  - `EXPIRED` から一旦 `AUTHENTICATING` を経て `reinit` された場合は `prevStatus` が `'AUTHENTICATING'` であるため `clearWorkingViewState()` が実行されず、前状態のフォルダ ID や `previewFrame.srcdoc`、`pendingRetryAction` が残存する。
  - 加えて `js/auth.js`（[L121-L188](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js#L121-L188)）の `initTokenClient` コールバックが「自身が生成された `tokenClient` / リクエスト世代」を照合していないため、`reinit` 後に旧ポップアップを閉じると新クライアントの `pendingRequest` を誤って reject する可能性がある。
- **証拠・ログ**:
  - Node.js 再現スクリプト出力：
    ```text
    Repro 6 (clearWorkingViewState calls on reinit during AUTHENTICATING, remaining folder): 0 f1
    ```
- **考えられる原因**: **実装起因**
  - `handleAuthStateChange` が直前 1 ステップの状態名（`prevStatus`）のみに依存してクリア判定を行っている点、および `tokenClient` コールバックの世代検証欠如。
- **推奨される次の対応**: **シニアコーダー修正**
  - `handleAuthStateChange` で `UNCONFIGURED` / `SIGNED_OUT` 遷移時に `currentFolderId` や `activeFileId` が存在する場合（または `prevStatus === 'AUTHENTICATING'` で作業状態が残っている場合）も確実に `clearWorkingViewState()` を実行する（あるいは `reinit` 呼び出し側で明示クリアする）。また `auth.js` の `callback` / `error_callback` にクライアント世代チェックを導入する。

---

### [BUG-GP-006]: トークン失効状態での「フォルダ切り替え」操作が再認証フローに遷移せず、また手動フォルダモーダル（`z-50`）表示中に `401` が発生すると再認証バナー/ボタンが操作不能になる
- **重大度**: **Medium**
- **関連要件/受け入れ基準**: FR-8, NFR-5, AC-8
- **再現手順**:
  - **ケース A（自然失効後のフォルダ切り替え）**:
    1. サインイン後 59 分以上経過（`getValidToken()` が `null` を返す状態）した状態で、ヘッダーのフォルダ名（`#changeFolderBtn`）をクリックする。
  - **ケース B（手動フォルダモーダル内での `401`）**:
    1. `#manualFolderModal`（`z-50`）を開いた状態でトークンが期限切れになり、フォルダ ID を入力して「フォルダを適用」を押す。
- **期待される動作**:
  - ケース A: `authService.handleUnauthorized()` が呼ばれ、セッション期限切れバナー（`EXPIRED` 状態）および「再認証」導線が表示されること。
  - ケース B: `401` 検知時にモーダルを閉じるかモーダル内から再認証を実行でき、再認証後に指定フォルダへ適用されること。
- **実際の動作**:
  - ケース A: `openFolderSelection()`（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L782-L786)）が `handleUnauthorized()` を呼ばずにエラートーストのみを出すため、ヘッダーのボタンは「サインアウト」のままで `#expiredBanner` も表示されない。
  - ケース B: `submitManualFolder`（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L813-L817), [L827-L831](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L827-L831)）は `401` 時に `#manualFolderModal` を閉じないため、`z-50` のモーダル背景が `z-40` のヘッダーと `z-30` の `#expiredBanner` を覆い隠し、ユーザーがモーダルを自力で閉じるまで再認証ボタンをクリックできない。
- **証拠・ログ**:
  - [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L782-L786), [L813-L831](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L813-L831) および [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html#L96), [L290](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html#L290) の静的コード検査で確認。
- **考えられる原因**: **実装起因**
  - `openFolderSelection()` における期限切れ状態遷移漏れ、およびモーダル重ね順（`z-50`）と `401` バナー（`z-30`）の操作導線考慮不足。
- **推奨される次の対応**: **シニアコーダー修正**
  - `openFolderSelection()` で `!token` かつ `status === 'AUTHENTICATED' || status === 'EXPIRED'` の場合は `handleUnauthorized()` を呼ぶようにし、`submitManualFolder()` で `UNAUTHORIZED` 時は `ui.closeManualFolderModal()` を実行してから再認証へ誘導する。

---

### [BUG-GP-007]: `selectFile()` 失敗時に表示中ファイル名・リスト選択ハイライトと `previewFrame.srcdoc` 内容が不整合になる（および初回 `401` 時に空のプレビューバーが出現する）
- **重大度**: **Medium**
- **関連要件/受け入れ基準**: FR-4, NFR-5
- **再現手順**:
  1. `file_1.html` を正常にプレビュー表示する（`previewFrame.srcdoc` に `file_1.html` の内容が表示されている）。
  2. 続けて Google ドキュメントに `.html` 名を付けたファイル（`403 fileNotDownloadable`）または存在しない/権限喪失ファイル `file_2.html`（`404` / `401`）をクリックする。
- **期待される動作**:
  - 取得に失敗した場合、プレビュー表示領域のタイトル・ハイライト・`srcdoc` の間に矛盾が生じないこと（エラー表示へ切り替えるか、直前の有効状態をロールバックして維持すること）。また初回選択（`currentRawHtml === ''`）で `401`/エラーになった場合は、空のまま `#previewActions`（「再読込」ボタン）や `#emptyState` 非表示状態を残さないこと。
- **実際の動作**:
  - `selectFile()`（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L688-L692)）は `getHtmlFileContent` 呼び出し前に `activeFileId = file.id`、`ui.highlightActiveFile(file.id)`、`ui.showPreviewLoading(file.name)`（`currentFileName` 書換、`#emptyState` 非表示、`#previewActions` 表示）を確定させてしまう。
  - API 応答が失敗（[L710-L718](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L710-L718)）してもロールバックしないため、画面上部のファイル名は `file_2.html`、プレビュー中身は前の `file_1.html`（または初回時は真っ白で「再読込」ボタンのみ表示・クリックしても `if (currentRawHtml)` で無反応）となる。
- **証拠・ログ**:
  - [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L687-L719), [L838-L845](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L838-L845) の静的コード検査で確認。
- **考えられる原因**: **実装起因**
  - 楽観的 UI 更新（`activeFileId` / `currentFileName` / `emptyState` 非表示）に対するエラー時ロールバック処理の欠如。
- **推奨される次の対応**: **シニアコーダー修正**
  - `selectFile()` で直前の `prevActiveFileId` 等を保持し、非成功時はハイライト・ファイル名・`emptyState`/`previewActions` 表示を復元（または `resetPreview()`）する。また 0 バイト HTML ファイルでも再読込できるよう `reloadPreview()` の判定を `activeFileId !== null` 等に見直す。

---

### [BUG-GP-008]: フォルダ未選択時・自己修復停止時の件数表示 `'フォルダを選択してください'` が直後の `renderFileList([])` によって `'0 件のファイル'` で上書きされる
- **重大度**: **Low**
- **関連要件/受け入れ基準**: FR-1, FR-6
- **再現手順**:
  1. `LAST_FOLDER_ID`・`defaultFolderId`・URL パラメータがすべて空の状態でサインインする（`bootstrapInitialFolder`）、または無効フォルダと無効デフォルトフォルダで自己修復が停止する（`handleFolderLoadError`）。
- **期待される動作**:
  - フォルダ未選択状態の案内文言 `'フォルダを選択してください'` が左ペインのカウント欄に表示されること。
- **実際の動作**:
  - [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L604-L605) および [L732-L733](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L732-L733) で `ui.setFileCountText('フォルダを選択してください')` を実行した直後に `ui.renderFileList([], activeFileId, selectFile)` を呼び出しており、`renderFileList` 内の `fileCountText.textContent = '0 件のファイル';`（[L216](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L216)）が即座に上書きする。
- **証拠・ログ**:
  - Node.js 再現スクリプト出力：
    ```text
    Repro 4 (fileCountTexts sequence when no folder): [ 'フォルダを選択してください', '0 件のファイル' ]
    ```
- **考えられる原因**: **実装起因**
  - `renderFileList` の副作用（`fileCountText` の無条件更新）と呼び出し順序の逆転。
- **推奨される次の対応**: **シニアコーダー修正**
  - `renderFileList([], ...)` の後に `ui.setFileCountText('フォルダを選択してください')` を呼ぶか、`renderFileList` に空時メッセージ指定オプションを設ける。

---

### [BUG-GP-009]: GCP 設定モーダル（ハイブリッド B-1）の保存バリデーション・リセットエラー検知・項目単位上書きに不整合がある
- **重大度**: **Low**
- **関連要件/受け入れ基準**: FR-9
- **再現手順**:
  1. **必須項目の空保存**: `config.js` が空の環境で、設定モーダル（`OAuth Client ID *` と必須マーク付き）を開き、`OAuth Client ID` を空のまま（例: `API Key` のみ入力、またはすべて空にして）「保存して適用」をクリックする。
  2. **ストレージ削除失敗時のリセット**: `localStorage.removeItem` が例外を投げる状態で「初期設定に戻す」をクリックする。
  3. **一部項目の変更**: `config.js` に `clientId` と `apiKey` が既定設定されている状態で、モーダルから `defaultFolderId` のみを変更して「保存して適用」をクリックする。
- **期待される動作**:
  - (1) 必須マーク付き項目の空保存で「設定を保存しました」という成功トースト直後に「初期設定が必要です」画面へ落ちる矛盾が起きないようバリデーションまたは明確なメッセージが出ること。
  - (2) `clearConfigOverrides` が `false` を返した場合はエラー通知を行うこと。
  - (3) 既定値と同値の項目まで `localStorage` へコピー上書きせず、真にユーザーが変更した項目のみ上書きすること（管理者による将来の `config.js` 更新を阻害しない）。
- **実際の動作**:
  - (1) `saveConfigOverrides`（[js/config.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/config.js#L158-L221)）は `clientId` の必須チェックを行わないため、空保存でも「設定を保存しました」と成功トーストを出した直後に `reinit('')` で `UNCONFIGURED` 画面へ遷移する。
  - (2) `resetSettings()`（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L896-L899)）は `clearConfigOverrides(storage)` の戻り値（`boolean`）を確認せず常に `'初期設定に戻しました'` トーストを表示する。
  - (3) モーダル初期表示で全 4 欄に解決済み値（`config.js` 由来含む）を流し込み、保存時に全 4 欄を `STORAGE_KEYS.APP_CONFIG` に保存するため、1 項目変えただけで全項目が「ブラウザ保存値で上書き中」になる。
- **証拠・ログ**:
  - [js/config.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/config.js#L158-L221)、[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L865-L904)、[index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html#L349) の静的検査で確認。
- **考えられる原因**: **実装起因**
  - B-1 ハイブリッド設定の UI 保存時の差分抽出・結果検査の不足。
- **推奨される次の対応**: **シニアコーダー修正**
  - `resetSettings()` での `clearConfigOverrides` 戻り値検査、`clientId` 空入力時の挙動明確化（警告または入力検証）、および `config.js` 既定値と一致する項目のオーバーライド抑制を検討・修正する。

---

### [BUG-GP-010]: Drive API v3 境界値（改行検索・無効日時ソート）およびテストスイートの結合検証不足（DOM 配線・401 検索再開未検証）
- **重大度**: **Low**
- **関連要件/受け入れ基準**: FR-2, FR-3, NFR-6
- **再現手順**:
  1. **Drive API クエリ/日時境界**: `searchHtmlFiles` に改行 `\n` / `\r` を含む文字列を渡す（例: コピペ時の末尾改行等）、または `modifiedTime` が欠損・不正文字列のファイルと正常 ISO 日時ファイルが混在する一覧を取得する。
  2. **テスト抜け穴**: [tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js#L860-L871) の `401` 再認証テストは `authService.getState().status === 'AUTHENTICATED'` と `controller.getCurrentFolderId()` のみ確認し、直前の検索語 `'abc'` が再実行されたかをアサートしていない。また `createDomUiAdapter` / `mountBrowserApp` / `saveSettings` / `resetSettings` / `signOut` の結合テストが存在しない。
- **期待される動作**:
  - 検索クエリの制御文字（`\r`, `\n` 等）は空白正規化または安全に処理され、日時不正ファイルはソート末尾へ安定配置されること。
  - 自動テストが DOM ID 整合性、`401` 後の保留アクション（検索・プレビュー・手動フォルダ）の実際の再実行、および設定変更フローを検証すること。
- **実際の動作**:
  - `sanitizeSearchQuery`（[js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js#L27-L34)）は `\` と `'` のみエスケープし、`\n` / `\r` をそのまま `q` に埋め込む（Drive API v3 側で `400 Bad Request` となるリスク）。
  - `collected.sort`（[js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js#L433-L441)）は片方の `Date.parse` が `NaN` の場合に文字列比較 `a.modifiedTime < b.modifiedTime` へフォールバックするため、`'invalid'` 等が `'2026-...'` より上位（新しい扱い）に並ぶ。
  - `getHtmlFileContent`（[js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js#L517)）はインターフェース定義にある `data.fileName` を常に `''` で返す。
  - `tests/run_tests.js` および `tests/adversarial_tests.js` に DOM 整合性・`401` 再実行内容・`saveSettings`/`resetSettings` の検証が欠落している。
- **証拠・ログ**:
  - [js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js#L27-L34), [L433-L441](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js#L433-L441), [tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js#L860-L871) の検査で確認。
- **考えられる原因**: **実装起因**
- **推奨される次の対応**: **シニアコーダー修正**
  - `sanitizeSearchQuery` での制御文字（`\r`, `\n` → 空白）正規化、`collected.sort` での `NaN` 時 `0` 扱い徹底、および `tests/run_tests.js` / `tests/adversarial_tests.js` への抜け穴補強を実施する。

---

## 4. エスカレーション事項

### 1. アーキテクト・セキュリティ確認事項: `<iframe sandbox="allow-scripts allow-forms allow-same-origin">` と外部共有 `?folderId=` リンクの信頼境界
- **種別**: セキュリティ / アーキテクチャ仕様上の残存リスク（推論済み・確認事項）
- **内容**:
  - 上流設計書（[ARCHITECTURE_GITHUB_PAGES.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/architecture/ARCHITECTURE_GITHUB_PAGES.md#L458-L460)）および実装計画書（[IMPLEMENTATION_PLAN_GITHUB_PAGES.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/plans/IMPLEMENTATION_PLAN_GITHUB_PAGES.md#L66)）では、現行 GAS 仕様を踏襲して `<iframe id="previewFrame" sandbox="allow-scripts allow-forms allow-same-origin">` を維持し、その防御線として「アクセストークンを `localStorage` や `window` に置かずクロージャ変数内に閉じ込める」設計を採用しています。
  - 実装精査の結果、`accessToken` のクロージャ隔離に加えて `DriveApiClient` も初期化時点で `fetch.bind(globalThis)` を束縛しているため（[js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js#L185)）、`iframe` 内スクリプトから後から `window.parent.fetch` を差し替えてトークンを横取りする経路は遮断されています。
  - **しかし**、`allow-scripts` と `allow-same-origin` を併用する仕様上、第三者から共有された `?folderId=<他者のフォルダID>` を開いて悪意ある HTML をプレビューした場合、その HTML 内のスクリプトは同一オリジンとして `window.parent.document`（DOM 改ざん・偽の再認証モーダル表示・`openSettingsModal` 操作等）や `window.parent.localStorage`（`html_viewer_app_config` / `html_viewer_last_folder_id` の読み書き）へ技術的にアクセス可能です。
- **推奨事項**:
  - 本アプリは「信頼できる自身のドライブ内 HTML をプレビューする」前提で現行仕様を維持していますが、**外部ユーザーから渡された `?folderId=` リンクを開く運用**を想定する場合は、将来的に `sandbox="allow-scripts allow-forms"`（`allow-same-origin` 除去）への厳格化、または外部由来フォルダへの警告表示をアーキテクト判断として検討することを推奨します。

### 2. 未検証項目（実ブラウザ・実 GCP 環境 E2E テスト）の引き継ぎ
- **内容**:
  - Node.js モック環境でのテストは完了していますが、実際の Google Cloud Console 設定（承認済み JavaScript 生成元、API キーの HTTP リファラー制限）、`https://accounts.google.com/gsi/client` ポップアップのブラウザブロック挙動、Drive API v3 実データ（日本語ファイル名・共有ドライブ・`fullText` 検索・1000 件超ページング）は本環境の制約上未検証です。
- **推奨事項**:
  - 上記 `BUG-GP-001` 〜 `BUG-GP-010` の修正後、`http://localhost:8080` または GitHub Pages ステージング環境にて実アカウントによる E2E チェックリスト検証を実施してください。

---

## 5. 再検証結果（修正確認・QAクリア判定）

シニアコーダーによる `BUG-GP-001` 〜 `BUG-GP-010` の全 10 件の修正およびテストスイート拡充を受け、修正後の実装ファイル（[js/auth.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js), [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js), [js/config.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/config.js), [js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js), [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html)）およびテストスイート（[tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js), [tests/adversarial_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/adversarial_tests.js)）に対する再検証を実施しました。

### 5.1 再検証テスト実行サマリー
- **実行済み**:
  - `node tests/run_tests.js`: **全 31 件中 31 件合格、0 件失敗**（終了コード 0）
    - 内訳: Suite 1 (5件: `DOM ID 整合性チェック` 含む), Suite 2 (3件), Suite 3 (4件), Suite 4 (3件: `BUG-GP-009` 含む), Suite 5 (5件: `BUG-GP-003` 含む), Suite 6 (4件: `BUG-GP-010` ソート・検索正規化含む), Suite 7 (2件), Suite 8 (5件: `BUG-GP-010` 401リトライ `'abc'`・`BUG-GP-006`・`BUG-GP-007`・`BUG-GP-008 & BUG-GP-009` 含む)
  - `node tests/adversarial_tests.js`: **PASS=16, FAIL/ISSUES=0**（終了コード 0）
    - 実行ケース: `ADV-INJ-001`, `ADV-XSS-001`, `ADV-XSS-002`, `ADV-INP-001`, `ADV-SEC-001`, `ADV-SEC-002`, `ADV-AUTH-001` (`BUG-GP-001`), `ADV-AUTH-002` (`BUG-GP-003`), `ADV-AUTH-003` (`BUG-GP-005`), `ADV-PAG-001`, `ADV-CON-001`, `ADV-CON-002`, `ADV-CON-003` (`BUG-GP-002`), `ADV-CON-004` (`BUG-GP-004`), `ADV-REC-001`, `ADV-REC-002`
- **検査済み**:
  - `js/auth.js`, `js/app.js`, `js/config.js`, `js/drive-api.js`, `index.html` の全行コード検査により、全 10 件の修正実装および周辺状態遷移・非同期競合・エッジケースの回帰（デグレード）がないことを確認。

### 5.2 Issue 別解消確認結果

| Issue ID | 修正対象ファイル | 解消内容の確認結果（コード検査・テスト確認） | 判定 |
|---|---|---|---|
| **BUG-GP-001** | [js/auth.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js) | `authGeneration`, `clientGeneration`, `activeWaitHandle`, `cancelGisWaitIfAny()` により `init`/`reinit`/`signOut`/`signIn` 時に旧 `waitForGisOAuth2` ポーリングを中断・reject し、`signIn` 完了時にも `reqGeneration !== authGeneration || !currentClientId` を検証することで世代跨ぎ上書きを防止（`ADV-AUTH-001` PASS）。 | **解消済み** |
| **BUG-GP-002** | [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js) | `applyFolder()` にて `currentPreviewRequestId++` をインクリメントし、`hasLoadedPreview = false` / `lastLoadedFileName = ''` / `currentRawHtml = null` をリセットすることで、フォルダ切替時の遅延プレビュー応答による旧内容上書きを防止（`ADV-CON-003` PASS）。 | **解消済み** |
| **BUG-GP-003** | [js/auth.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js), [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js) | `AuthService.handleUnauthorized()` の遷移条件を `AUTHENTICATED` / `EXPIRED` に限定。`routeUnauthorizedOrAbort()` および `handleAuthAction` (`signOut`) の `cancelPendingSearch()`、`clearWorkingViewState()`、`handleAuthStateChange` により、`SIGNED_OUT` / `UNCONFIGURED` への不正遷移と `pendingAction` 残留を解消（Suite 5 / `ADV-AUTH-002` PASS）。 | **解消済み** |
| **BUG-GP-004** | [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js) | `createAppController` 内に `scheduleSearch` / `cancelPendingSearch` を実装し、`#clearSearchBtn` と `#refreshBtn` のハンドラから `controller.cancelPendingSearch()` を呼び出すことでデバウンスタイマーの遅延発火を抑止（`ADV-CON-004` PASS）。 | **解消済み** |
| **BUG-GP-005** | [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js), [js/auth.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js) | `handleAuthStateChange` での `hasRemainingViewState` 判定、設定保存 (`saveSettings`)・リセット (`resetSettings`) 時の `authService.reinit` 前の明示的 `clearWorkingViewState()` 実行、および `ensureTokenClient` の `callback` / `error_callback` における `boundClientGen !== clientGeneration` / `pendingRequest.generation !== authGeneration` ガードにより完全遮断（`ADV-AUTH-003` PASS）。 | **解消済み** |
| **BUG-GP-006** | [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js) | `openFolderSelection()` に `routeUnauthorizedOrAbort({ type: 'openFolderSelection' })` を組み込み `handleAuthStateChange` で復帰実行するよう修正。また `submitManualFolder()` にて `routeUnauthorizedOrAbort` 前に `ui.closeManualFolderModal()` を実行するよう改善（Suite 8 PASS）。 | **解消済み** |
| **BUG-GP-007** | [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js) | `selectFile()` での `prevActiveId` / `prevFileName` / `prevHasLoaded` の退避および失敗時 `rollbackPreviewSelection()`（`ui.restorePreviewHeader` 使用）により選択状態の不整合を解消。さらに `hasLoadedPreview` フラグ導入により 0 バイト HTML ファイルでの再読み込み (`reloadPreview()`) 不可問題を解消（Suite 8 PASS）。 | **解消済み** |
| **BUG-GP-008** | [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js) | `renderFileList(..., emptyCountText)` を追加し、`handleFolderLoadError` および `bootstrapInitialFolder` の未選択時表示に `'フォルダを選択してください'` を明示指定（Suite 8 PASS）。 | **解消済み** |
| **BUG-GP-009** | [js/config.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/config.js), [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js) | `saveConfigOverrides()` が空 `clientId` を拒否し、`defaults` と異なる非空値のみを差分保存（差分がなければキー削除）する仕様へ修正。さらに `resetSettings()` が `clearConfigOverrides(storage)` の真偽値戻り値を検証し失敗時にエラー通知するよう修正（Suite 4 / Suite 8 PASS）。 | **解消済み** |
| **BUG-GP-010** | [js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js), [tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js), [tests/adversarial_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/adversarial_tests.js) | `sanitizeSearchQuery` で `[\r\n\t\x00-\x1f\x7f]+` を空白正規化＋trim、`collected.sort` で不正/欠損 `modifiedTime` を末尾配置、`getHtmlFileContent(fileId, fileName)` のメタデータ伝播を実装。さらに `run_tests.js` へ DOM ID 整合性チェックおよび `401` リトライ時の検索クエリ（`'abc'`）検証を追加（Suite 1 / Suite 6 / Suite 8 PASS）。 | **解消済み** |

### 5.3 回帰検証および残存リスク（引き継ぎ事項）
- **回帰検証結果**: 再検証対象の 5 つのプロダクションファイル（`js/auth.js`, `js/app.js`, `js/config.js`, `js/drive-api.js`, `index.html`）および 2 つのテストファイルにおいて、新たな不具合やデグレードは検出されませんでした。
- **アーキテクチャ上の確認事項（継続）**: セクション 4.1 に記載した `<iframe id="previewFrame" sandbox="allow-scripts allow-forms allow-same-origin">` と未信頼 `?folderId=` 組み合わせのリスクは設計上の ADR 判断であり実装バグではありませんが、運用要件に応じて引き続き認識を共有してください。
- **未検証範囲（継続）**: Node.js モック環境での自動検証（31 件 + 16 件）は全件合格していますが、実ブラウザおよび実 Google Cloud プロジェクト（GitHub Pages / `localhost`）における Google Identity Services ポップアップ、API キー HTTP リファラー制限、Drive API v3 実通信の E2E 動作確認は環境制約上未検証のため、デプロイ前にステージング確認を実施してください。

### 5.4 最終 QA 判定
- **判定**: **合格（QA クリア）**
  - `BUG-GP-001` 〜 `BUG-GP-010` の全 10 件が解消され、自動テスト（単体/結合 31 件・敵対的 16 件）がすべて合格、新規回帰なしを確認しました。

