# QA検証レポート（フォルダ選択障害の恒久対策・アプリ内 Drive フォルダブラウザ導入）

> **検証対象**:
> - システムアーキテクチャ設計書: [ARCHITECTURE_FOLDER_SELECTION_FIX.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/architecture/ARCHITECTURE_FOLDER_SELECTION_FIX.md)
> - 実装計画・タスク仕様書: [IMPLEMENTATION_PLAN_FOLDER_SELECTION_FIX.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/plans/IMPLEMENTATION_PLAN_FOLDER_SELECTION_FIX.md)
> - 実装・検証完了報告書: [IMPLEMENTATION_REPORT_FOLDER_SELECTION_FIX.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/reports/IMPLEMENTATION_REPORT_FOLDER_SELECTION_FIX.md)
> - 実装ファイル: [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html), [js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js), [js/picker.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/picker.js), [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js)
> - テストスイート: [tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js), [tests/adversarial_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/adversarial_tests.js)

---

## 1. 検証サマリー（再検証後・最終版）

- **テスト実施ステータス**:
  - **実行済み**:
    - ワークスペース全 `.js` ファイル（10 ファイル）に対する `node -c` 構文チェック（終了コード `0`、エラー 0 件）
    - 単体・結合テスト `node tests/run_tests.js`（全 **39** 件中 **39** 件合格 / 0 件失敗、終了コード `0`）
    - 敵対的・セキュリティ・回帰テスト `node tests/adversarial_tests.js`（**PASS=22, FAIL/ISSUES=0**、終了コード `0`）
    - QA 再現・追加境界検証スクリプト `qa_repro.js` 再実行（修正前検出の `[BUG-001]` 3 パターンおよび `[BUG-003]` がすべて解消されたことを実測確認、加えて `PickerService` `dispose()` 例外・空 `docs` 境界および `DriveApiClient` 境界ケースの安全動作を確認）
  - **検査済み**:
    - [js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js)、[js/picker.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/picker.js)、[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js)、[index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html) の全実装ロジック、CSS クラス（`[BUG-002]` の `flex-shrink-0` 適用・`scrollTop` リセット）、XSS エスケープ、DOM イベント結線、テストカバレッジを静的解析
    - Google Drive API v3 仕様との整合性確認（`corpora=allDrives` + `orderBy=name`、`sharedWithMe` + `supportsAllDrives`/`includeItemsFromAllDrives`、共有ドライブ ID とルートフォルダ ID の扱い）
  - **未検証**:
    - 実ブラウザ（Chrome シークレットモード / サードパーティ Cookie ブロック環境、実 Google OAuth トークン、実 Google Drive API 通信）および実機モバイルビューポート（幅 320px〜390px）での目視・インタラクション確認（Node.js 環境にブラウザ DOM がないため）
    - `mountBrowserApp()` の実ブラウザ DOM 上でのイベント委譲・フォーカス移動の E2E 動作
- **総合評価**: **合格（QA クリア）**
  - 初回検証で検出した `[BUG-001]`（High）、`[BUG-002]`（Medium）、`[BUG-003]`（Medium）の 3 件および主要な自動テストギャップはすべてシニアコーダーにより修正・補強され、再検証および回帰テスト全件に合格した。

---

## 2. 観点別テスト結果（12大検証項目）

| # | 検証観点 | ステータス | 結果サマリー |
| :---: | :--- | :---: | :--- |
| 1 | **機能の正確性** | 合格 | `DriveApiClient` 3メソッド、`PickerService`、`DomUiAdapter`、`AppStateController`（`SHARED_WITH_ME` ドリルダウンおよび `confirmCurrentBrowserFolder` 含む）が要件通り動作することを確認済み。 |
| 2 | **エッジケース** | 合格 | `drives` 欠損・空配列・`name` 欠損、空白/制御文字のみの検索、`docs: []` での `PICKED`、`0` バイト HTML 等が安全に処理されることを確認済み。 |
| 3 | **境界条件** | 合格 | `pageSize` クランプ（`0` -> `1`, `500` -> `100`）、パンくず階層増加時の `flex-shrink-0` 付与（[BUG-002] 解消）、新規読み込み時の `scrollTop = 0` リセットを確認済み。 |
| 4 | **無効な入力** | 合格 | 不正 `parentId`/`driveId`（クエリ文字列、数値型、空文字）、無効 `space`、空検索キーワードに対し例外を投げず `INVALID_INPUT` で返却されることを確認済み。 |
| 5 | **エラー処理** | 合格 | `401`/`403`(各種 reason)/`404`/`429`/`500`/ネットワーク例外分類、および `PickerService` で `dispose()` が例外を投げた場合の安全継続を確認済み。 |
| 6 | **セキュリティ** | 合格 | `escapeHtml` による一覧・パンくず・検索語・エラーメッセージの無害化、クエリの `\`, `'`, 制御文字エスケープ、`drive.readonly` 最小権限、トークン非永続化を確認。 |
| 7 | **並行性** | 合格 | `folderBrowseRequestId`・`manualFolderRequestId`・デバウンス発火時状態更新と保留タイマーキャンセルにより、デバウンス中競合（[BUG-001]）および閉鎖後遅延適用（[BUG-003]）が防止されることを確認済み。 |
| 8 | **信頼性** | 合格 | `401` 検知時のモーダル即閉鎖・`EXPIRED` 遷移・再認証後の `openFolderSelection()` 自動再開、および一時障害時の `currentFolderId` / `LAST_FOLDER_ID` 保全を確認済み。 |
| 9 | **パフォーマンス** | 合格 | オンデマンド取得、`pageSize=100` ページング、デバウンス検索（350ms）、タブ切替・別操作時の保留デバウンスキャンセルを確認済み。 |
| 10 | **データ整合性** | 合格 | 確定前（ブラウズ中）は `currentFolderId` / `LAST_FOLDER_ID` を変更せず、デバウンス待機中の `loadMore` / `openFolderBrowserItem` / `confirmCurrentBrowserFolder` でも `space` / `breadcrumbs` / `items` の整合性が維持されることを確認済み。 |
| 11 | **後方互換性** | 合格 | `openManualFolderModal` のみを持つ既存モック UI（`createTrackingMockUi`, `createNoopUi`）へのフォールバック、`index.html` の `<script>` 読込順序・`iframe sandbox` 属性維持を確認済み。 |
| 12 | **回帰リスク** | 合格 | `tests/run_tests.js` 全 39 件 + `tests/adversarial_tests.js` 全 22 件が全件合格。`SHARED_WITH_ME`、`confirmCurrentBrowserFolder`、`DomUiAdapter` クラス切替/`flex-shrink-0`/`scrollTop`、`ADV-CON-006`/`ADV-CON-007` も自動テスト化済み。 |

---

## 3. 不具合・課題の再検証ステータス (Issue 票追跡)

### [BUG-001]: `scheduleFolderBrowserSearch` のデバウンス待機中における状態不整合（**解消済み**）
- **初回検出時重大度**: High（実装起因）
- **修正内容の確認**:
  - [js/app.js#L1364-L1373](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1364-L1373): `scheduleFolderBrowserSearch` は `pendingKeyword` をローカルクロージャに保持し、デバウンスタイマー発火時のみ `folderBrowserState.searchKeyword = pendingKeyword;` を更新して `fetchFolderBrowserPage` を呼ぶ方式へ変更された。
  - [js/app.js#L1286](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1286), [L1376](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1376), [L1384](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1384), [L1397](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1397): `switchFolderModalTab` / `loadMoreBrowserFolders` / `retryFolderBrowser` / `confirmCurrentBrowserFolder` の各操作で `cancelPendingFolderSearch()` が確実に実行される。
- **再検証結果（実行済み）**:
  - `ADV-CON-006`（[tests/adversarial_tests.js#L943-L1040](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/adversarial_tests.js#L943-L1040)）および `qa_repro.js` 再実行にて以下を確認：
    - ケース A: `loadMore q: 'root' in parents ...`, `corpora: null`, `pageToken: my_p2` でマイドライブ次ページ取得を維持。
    - ケース B: `space: "SHARED_DRIVES"`, `breadcrumbs: [共有ドライブ, hit_search(driveId: drv_shared_1)]` へ正常遷移。
    - ケース C: デバウンス待機中の `confirmCurrentBrowserFolder()` が `INVALID_INPUT` で拒否されず確定処理へ進行。

---

### [BUG-002]: パンくず末尾 `<span>` および検索結果 `<span>` の `flex-shrink-0` 欠落（**解消済み**）
- **初回検出時重大度**: Medium（実装起因）
- **修正内容の確認**:
  - [js/app.js#L538-L541](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L538-L541): 検索結果ラベル `<span>` および検索語 `<span>` に `flex-shrink-0` が付与された。
  - [js/app.js#L552](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L552): 末尾の現在階層 `<span>` に `flex-shrink-0` が付与された。
  - [index.html#L383](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html#L383): 初期静的マークアップの `<span>` にも `max-w-[130px] sm:max-w-[200px] truncate flex-shrink-0` が統一適用された。
  - 併せて [js/app.js#L569-L571](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L569-L571) で新規読み込み時（`isLoading && !isLoadingMore`）に一覧スクロール位置（`scrollTop = 0`）をリセットする改善も実装された。
- **再検証結果（検査済み・テスト実行済み）**:
  - [tests/run_tests.js#L1831-L1946](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js#L1831-L1946) の `DomUiAdapter` テストで `flex-shrink-0`・クラス切替・`scrollTop = 0` リセットが全件合格。

---

### [BUG-003]: `submitManualFolder` 通信中のモーダル閉鎖後遅延応答による上書き（**解消済み**）
- **初回検出時重大度**: Medium（実装起因）
- **修正内容の確認**:
  - [js/app.js#L792](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L792), [L1473-L1478](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1473-L1478): `manualFolderRequestId` を導入し、`submitManualFolder` 解決時に世代不一致なら `{ success: false, cancelled: true }` を返して処理を破棄。
  - [js/app.js#L872](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L872), [L1157](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1157), [L1287-L1289](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1287-L1289): `closeFolderModalSafe()`（モーダル閉鎖および `clearWorkingViewState()`）、`applyFolder()`（別フォルダ確定）、`switchFolderModalTab('browser')` の各時点で `manualFolderRequestId++` により進行中リクエストを無効化。
- **再検証結果（実行済み）**:
  - `ADV-CON-007`（[tests/adversarial_tests.js#L1042-L1122](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/adversarial_tests.js#L1042-L1122)）および `qa_repro.js` 再実行にて、モーダル閉鎖後に遅延到着した成功応答（フォルダ上書き抑止）および 404 エラー応答（トースト・エラー表示抑止）がともに破棄されることを確認済み。

---

## 4. 残存課題・未検証事項（リスク管理メモ）

重大度 High / Medium の不具合は残存していない。リリース前に実環境で確認を推奨する未検証項目および軽微補足（Low）は以下の通り：

1. **未検証項目（環境制約による）**:
   - 実ブラウザ（Chrome シークレットモード / 3PC ブロック環境、Safari ITP 等）での実 Google OAuth 認証および実 Google Drive API（マイドライブ・共有ドライブ・共有アイテム・フォルダ検索・ページング・`401` 再認証）の動作確認。
   - 実機またはブラウザ DevTools モバイルビューポート（幅 320px / 375px / 1280px）でのレイアウト・タップ操作・`mountBrowserApp()` DOM イベント委譲の最終目視確認。
2. **軽微な仕様補足（Low・ブロッカーではない）**:
   - `PickerService` は外部 `dispose()` を公開していないため、Google Picker ダイアログ表示中に外部要因でサインアウト等が起きた場合はモーダルのみ閉じる仕様（通常は Picker が全面を覆うため操作競合リスクは極小）。
   - `submitManualFolder` で 404 等の検証エラー（ヘッダーステータスが「エラー」表示）になった後、そのままモーダルをキャンセルして閉じるとヘッダーステータスが「エラー」のまま残る（既存実装踏襲）。

---

## 5. 再検証で実行したコマンドと実測値

1. **構文チェック (`node -c`)**:
   - 全 10 個の `.js` ファイル（`config.js`, `js/*.js`, `tests/*.js`）: 終了コード `0`、エラー 0 件
2. **単体・結合テスト (`node tests/run_tests.js`)**:
   - 終了コード `0` — **全 39 件中 39 件合格, 0 件失敗**
3. **敵対的・セキュリティ・回帰テスト (`node tests/adversarial_tests.js`)**:
   - 終了コード `0` — **PASS=22, FAIL/ISSUES=0**
4. **QA 再現スクリプト再実行 (`qa_repro.js`)**:
   - 終了コード `0` — `[BUG-001]`（1-A/1-B/1-C）および `[BUG-003]` の修正完了を確認
