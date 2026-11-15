# ソフトウェア監査・最終レビュー報告書

> **監査対象**: フォルダ選択障害の恒久対策・アプリ内 Drive フォルダブラウザ導入  
> **対象設計書**: [ARCHITECTURE_FOLDER_SELECTION_FIX.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/architecture/ARCHITECTURE_FOLDER_SELECTION_FIX.md)  
> **対象実装計画**: [IMPLEMENTATION_PLAN_FOLDER_SELECTION_FIX.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/plans/IMPLEMENTATION_PLAN_FOLDER_SELECTION_FIX.md)  
> **実装報告書**: [IMPLEMENTATION_REPORT_FOLDER_SELECTION_FIX.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/reports/IMPLEMENTATION_REPORT_FOLDER_SELECTION_FIX.md)  
> **QA 検証レポート**: [QA_REPORT_FOLDER_SELECTION_FIX.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/reports/QA_REPORT_FOLDER_SELECTION_FIX.md)  
> **監査対象ソース**: [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html), [js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js), [js/picker.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/picker.js), [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js), [js/auth.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js), [tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js), [tests/adversarial_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/adversarial_tests.js)

---

## 1. 総合リリース推奨判定
- **判定結果**: **条件付き承認**
- **判定理由サマリー**:
  - 要件定義（一次手段のサードパーティ Cookie 非依存化、ゲート 1 承認事項の「Google Picker で開く」補助導線残置とモバイル狭画面配慮、最小権限 `drive.readonly` 維持、トークン非永続化、XSS/クエリインジェクション防御、既存機能・テストとの後方互換性）および承認済みアーキテクチャ（ADR-7〜ADR-9）・実装計画書に完全準拠していることを確認した。
  - QA で検出された 3 件の不具合（`[BUG-001]`、`[BUG-002]`、`[BUG-003]`）はすべてコード上で適切に解消されており、QA による再検証（「合格（QA クリア）」）と回帰テストの補強も完了している。
  - 監査担当者による独立検証として全 10 件の `.js` ファイルに対する `node -c` 構文チェック（終了コード `0`）、[tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js)（全 39 件中 39 件合格、0 件失敗、終了コード `0`）、および [tests/adversarial_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/adversarial_tests.js)（`PASS=22, FAIL/ISSUES=0`、終了コード `0`）を確認した。
  - ただし、Node.js 環境の制約上、**実ブラウザ環境（サードパーティ Cookie ブロック / シークレットモード、実 Google OAuth 認証および実 Google Drive API v3 通信、幅 320px〜390px モバイルビューポートでの表示、`mountBrowserApp()` の実 DOM イベント結線）は未検証**であるため、公開・本番展開前に実ブラウザでの最終疎通確認を完了することを条件として承認する。

---

## 2. 準拠性監査
- **要件定義・受け入れ基準への準拠状況**: **準拠**
  - **不具合の恒久解消（AC-1〜AC-4）**: [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1255-L1283) の `openFolderSelection()` は Google Picker を排他起動せず、統合フォルダ選択モーダル（デフォルトはアプリ内フォルダブラウザ、タブ切替で ID/URL 直接入力が常時利用可能）を開く構造へ改修されている。アプリ内ブラウザは `MY_DRIVE` / `SHARED_DRIVES` / `SHARED_WITH_ME` の 3 空間切替、階層移動、パンくず復帰、フォルダ名検索、ページネーション（`nextPageToken`）に対応し、すべて既存の `Authorization: Bearer` `fetch` 通信基盤で完結しているためサードパーティ Cookie に依存しない。
  - **ゲート 1 ユーザー承認事項への準拠（AC-5 / NFR-5）**: [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html#L420-L459) にて、「Google Picker で開く（補助）」ボタン（`#openGooglePickerWrap` / `#openGooglePickerBtn`）をモーダルフッターの下段に `border-t` で縦分離配置し、主要操作（「キャンセル」「このフォルダを選択」「フォルダを適用」）や一覧スクロール領域（`flex-1 min-h-0 overflow-y-auto touch-scroll`）を圧迫しないレスポンシブ設計としている。ボタン表示も `isPickerAvailableNow()`（`isPickerConfigured && pickerService.isLoaded()`）に基づき動的に制御される（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1111-L1125)）。また [js/picker.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/picker.js#L26-L39), [L193-L243](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/picker.js#L193-L243) で `activePicker` 保持と `disposeActivePicker()` が実装され、再起動前・`PICKED`・`CANCEL`・例外時に `dispose()` が安全に実行される。
  - **最小権限・非永続化（AC-6 / NFR-2）**: [js/auth.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js#L13) の `DEFAULT_SCOPE` は `'https://www.googleapis.com/auth/drive.readonly'` のまま変更されておらず、トークンはクロージャ変数にのみ保持されている。
  - **後方互換性（FR-4 / NFR-6）**: [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html#L220), [L588-L595](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html#L588-L595) の `iframe sandbox="allow-scripts allow-forms allow-same-origin"` および 8 本の `<script>` 読み込み順序は維持されている。また `openFolderSelection()` にはモック UI 後方互換分岐（`typeof ui.openFolderSelectorModal !== 'function'` 時に `ui.openManualFolderModal(currentFolderId)` へフォールバック）が維持されている。

- **システムアーキテクチャへの準拠状況**: **準拠**
  - **ADR-7（一次手段のアプリ内フォルダブラウザ移行）**: `DriveApiClient` に `listSubfolders` / `listSharedDrives` / `searchFolders` を追加し、`AppStateController` と `DomUiAdapter` で統合モーダルを制御する構成が設計書通り実装されている。
  - **ADR-8（Picker `dispose()` 導入と統合モーダル内配置）**: `PickerService` の外部シグネチャを破壊せず内部ライフサイクル管理のみ強化し、統合モーダルからの補助起動と `CANCEL` 時モーダル維持・フォールバック時タブ切替が実装されている。
  - **ADR-9（`UiAdapter` 契約・既存テスト互換維持）**: `DomUiAdapter` が既存の `openManualFolderModal` / `closeManualFolderModal` / `getManualFolderInput` を引き続き公開しつつ、新メソッドを追加している。

- **実装計画書への準拠状況**: **準拠**
  - `TASK-001`〜`TASK-006` で定義された全対象ファイル、DOM ID 契約（全 22 ID が [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html) に一意に存在）、Drive API v3 パラメータ制約（`drives.list` での `orderBy` 非付与・`pageSize` `1〜100` クランプ、`SHARED_DRIVES` での `corpora=drive` + `driveId` ペア指定、`SHARED_WITH_ME` ドリルダウン時の `'id' in parents` 切替）、およびモバイル対応レイアウト仕様が逸脱なく実装されている。

---

## 3. 品質・技術的負債監査
- **コード品質 / 保守性 / シンプルさ**: **良好**
  - [js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js#L221-L313) では `executeBrowseFetch`、`clampPageSize`、`normalizeFolderItem`、`isCancelledSignal`、`cancelledResult`、`invalidInputResult` として共通ロジックが適切に抽出されており、新規 3 メソッド間および既存メソッドとの重複が抑えられている。
  - [js/picker.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/picker.js#L26-L39) の `disposeActivePicker()` は、対象が `dispose` メソッドを持たない場合や `dispose()` が例外を投げた場合も警告ログ出力のみで安全に継続する防御的設計となっている。
  - 全対象ファイルで構文エラー、LaTeX パイプ誤記（`\vert`, `\mid`）、`TODO` / 省略コメント、旧 GAS 遺物は一切存在しない。
  - 将来的な保守性観点では、[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js) が 1,889 行規模になっているため、今後のさらなる機能拡張時にはモジュール分割の余地がある（ただし今回は `<script>` 読み込み順序制約の保護のため単一ファイル内に収めた判断は妥当）。

- **結合度と凝集度**: **良好**
  - `DriveApiClient`（通信・クエリ構築・エラー分類）、`PickerService`（Picker API ライフサイクル管理）、`DomUiAdapter`（DOM 描画・クラス操作・エスケープ）、`AppStateController`（状態管理・レース制御・認証リカバリー調停）、`mountBrowserApp`（イベント委譲・デバウンス結線）の責務境界が明確に分離されている。
  - フォルダブラウザ中の操作は `folderBrowserState` 内に閉じ込められており、確定時（`confirmBrowserFolder` / `submitManualFolder` 成功時 / `onPicked`）まで `currentFolderId`・`activeFileId`・`LAST_FOLDER_ID` を変更しないため、既存プレビュー／検索状態との不要な結合・副作用が遮断されている。

- **エラーハンドリング・セキュリティ**: **良好**
  - **XSS 防御**: [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L538-L611) で検索語、パンくず名称、エラーメッセージ、フォルダ名、共有ドライブ名のすべてに `escapeHtml()` が適用されている。
  - **クエリインジェクション防御**: [js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js#L650-L791) で `parentId` / `driveId` には `sanitizeFolderId()`（不正時は例外スローせず `INVALID_INPUT` 返却）、検索語には `sanitizeSearchQuery()`（空文字時は `INVALID_INPUT` 返却）が漏れなく適用されている。
  - **並行性・レースコンディション対策**:
    - `folderBrowseRequestId` による一覧取得の順序逆転・モーダル閉鎖後反映の防止（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1176-L1221)）。
    - **QA 指摘 `[BUG-001]` 解消**: `scheduleFolderBrowserSearch`（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1364-L1373)）はデバウンス発火直前に `folderBrowserState.searchKeyword` を更新する方式へ修正され、タブ切替・スペース切替・階層移動・ページ追加読込・再試行・現在階層確定・モーダル閉鎖の各操作で `cancelPendingFolderSearch()` が実行される。
    - **QA 指摘 `[BUG-003]` 解消**: `manualFolderRequestId`（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L792), [L872](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L872), [L1157](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1157), [L1287-L1289](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1287-L1289), [L1473-L1478](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1473-L1478)）により、モーダル閉鎖・タブ切替・別フォルダ適用後に到着した遅延 `getFolderDetails` 応答（成功・エラーとも）が確実に破棄される。
  - **`401` 再認証リカバリー**: ブラウズ中の `401 UNAUTHORIZED` 検知時に `closeFolderModalSafe()` で `z-50` モーダルを閉じて背面の再認証バナー／ヘッダーボタン操作を可能にし、`routeUnauthorizedOrAbort({ type: 'openFolderSelection' })` により再認証後に自動再開する（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1168-L1174), [L1241-L1245](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1241-L1245)）。

- **テスト網羅性・適切性**: **良好（独立検証済み）**
  - 監査担当者による独立実行結果は以下の通り：
    - **全 `.js` ファイル構文チェック（`node -c`）**: 10 ファイルすべてエラー 0 件（終了コード `0`）
    - **単体・結合テスト（`node tests/run_tests.js`）**: 全 **39 件中 39 件合格, 0 件失敗**（終了コード `0`）
      - 静的整合性・DOM ID 一意性検証、`DriveApiClient` 3 メソッド単体テスト、`PickerService.dispose()` テスト、統合モーダル結合テスト（`MY_DRIVE` / `SHARED_DRIVES` / `SHARED_WITH_ME` ドリルダウン / `confirmCurrentBrowserFolder` / Picker 補助 / `401` 自動再開）、および `DomUiAdapter` クラス切替・`flex-shrink-0`（`[BUG-002]` 解消）・`scrollTop = 0` リセット検証を含む。
    - **敵対的・セキュリティ・回帰テスト（`node tests/adversarial_tests.js`）**: **PASS=22, FAIL/ISSUES=0**（終了コード `0`）
      - `ADV-XSS-003`、`ADV-INJ-002`、`ADV-CON-005`、`ADV-REC-003` に加え、`[BUG-001]` 回帰テスト `ADV-CON-006` および `[BUG-003]` 回帰テスト `ADV-CON-007` が網羅されている。
  - また、[QA_REPORT_FOLDER_SELECTION_FIX.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/reports/QA_REPORT_FOLDER_SELECTION_FIX.md) にて QA エンジニアの再検証（「合格（QA クリア）」、39 件 / 22 件 / `qa_repro.js` 全件クリア）が確認されている。

- **長期的運用リスク・技術的負債**: **低（許容範囲・実ブラウザ最終確認が必要）**
  - 新規外部ライブラリ依存はなく、既存の静的配信構成（GitHub Pages）を維持している。
  - Google Picker の 3PC 依存問題からは脱却済みであり、仮に Google が将来 Picker の埋め込み制約をさらに厳格化してもアプリ内フォルダブラウザおよび手動入力で 100% 業務継続可能。

---

## 4. 指摘事項一覧 (区分別)

### [欠陥 / Defect]
- **該当なし**（QA で検出された `[BUG-001]`〜`[BUG-003]` はすべて修正・回帰テスト追加・再検証済みであり、監査時点の実装コードに新規の欠陥は確認されなかった）。

### [リスク / Risk]
1. **実ブラウザ・実 Google Drive API / GIS 環境での動作未検証リスク（リリース前確認条件）**
   - **指摘内容**: Node.js テスト環境にはブラウザ DOM および外部ネットワークがないため、実際のブラウザ上での挙動が自動テストで検証されていない。
   - **証拠**: [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1619-L1872) の `mountBrowserApp()`、および [IMPLEMENTATION_REPORT_FOLDER_SELECTION_FIX.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/reports/IMPLEMENTATION_REPORT_FOLDER_SELECTION_FIX.md#L37-L38)、[QA_REPORT_FOLDER_SELECTION_FIX.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/reports/QA_REPORT_FOLDER_SELECTION_FIX.md#L23-L25) の未検証項目記録。
   - **影響**: 実 Google Drive API v3（特に共有ドライブ一覧・`SHARED_WITH_ME`・大量フォルダ時のページング）、3PC ブロック環境、およびモバイル実機（幅 320px〜390px）の Tailwind CSS 描画やタップ操作で予期しないレイアウト細部・イベント委譲の齟齬が顕在化する可能性がある。
   - **対応方針**: 本番公開（またはマージ完了）前の最終確認として、実ブラウザ（通常環境＋シークレットモード＋モバイル幅 320px/375px DevTools）でフォルダブラウズ・検索・選択・`401` 復帰・Picker 補助起動の疎通確認を実施すること。

2. **Google Picker 表示中の外部状態リセットに対する強制破棄手段の不在（Low）**
   - **指摘内容**: `PickerService` が `dispose()` を公開インターフェースとして外部へ露出していない。
   - **証拠**: [js/picker.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/picker.js#L248-L252) の返却オブジェクトが `{ load, isLoaded, openFolderPicker }` のみであり、[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L853-L868) の `clearWorkingViewState()` からアクティブな Picker を外部破棄できない。
   - **影響**: Google Picker ダイアログ表示中に外部契機でサインアウト等が発生した場合、Picker 画面は残存する（ただし通常は Picker のフルスクリーンオーバーレイがアプリ操作を覆うため競合リスクは極小であり、次回 `openFolderPicker()` 呼び出し時には `disposeActivePicker()` で破棄される）。

3. **`submitManualFolder` エラー後のキャンセル操作時におけるヘッダーステータス表示残留（Low・既存仕様踏襲）**
   - **指摘内容**: 直接入力タブで存在しないフォルダ ID 等を適用し検証エラーとなった直後にモーダルをキャンセルして閉じると、既存のファイル一覧が表示中であってもヘッダーのステータスバッジが「エラー」のまま残る。
   - **証拠**: [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1474), [L1490-L1492](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L1490-L1492) にて `ui.setStatus('エラー', 'bg-rose-500')` を設定しているが、モーダルキャンセル時（`closeFolderModalSafe`）には直前の正常ステータスへ復元していない。
   - **影響**: 既存フォルダ一覧やプレビューの閲覧機能自体は正常に動作し実害はないが、視覚上の状態表示が実態と一時的にズレる。

### [改善提案 / Suggestion]
1. **将来拡張を見据えた [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js) のモジュール分割検討**
   - **指摘内容**: 今回の機能追加により [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js) は 1,889 行となっている。今回は `<script>` 読み込み順序テスト互換性のため既存ファイル内で整理する方針が採用され妥当であったが、今後さらに UI や機能が拡張される場合は `DomUiAdapter`（UI 層）と `AppStateController`（状態調停層）のファイル分離を検討すると保守性・テスト可読性がさらに向上する。
2. **`submitManualFolder` 検証エラー後のステータス復元検討**
   - **指摘内容**: 上記リスク #3 について、今後 UX を洗練させる段階で「直接入力の検証エラー後にモーダルをキャンセルして閉じた場合、既に有効なフォルダを読み込み済みであればステータス表示を『準備完了』または『表示中』相当へ戻す」改善を検討できる（今回のリリース阻害要因ではない）。

### [アーキテクチャ上の懸念事項 / Architectural Concern]
- **該当なし**（ADR-7〜ADR-9 の設計判断は最小権限・サードパーティ Cookie 非依存性・後方互換性のすべてにおいて整合しており、破綻は認められない）。

---

## 5. 推奨される差し戻し先 (差し戻し判定の場合)
- 判定が「**条件付き承認**」のため、差し戻しは不要。上記リスク #1（実ブラウザ・実 Drive API・モバイル幅 320px/375px での最終動作確認）をリリース前確認チェックリストとして実施した上でリリースすることを推奨する。
