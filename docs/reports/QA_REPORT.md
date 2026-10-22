# QA検証レポート

## 1. 検証サマリー

- **テスト実施ステータス**:
  - **実行済み**:
    - 単体・結合テストスイート（`tests/run_tests.js`、全26件 PASS）
    - 批判的・敵対的テストスイート（`tests/adversarial_tests.js`、11項目実行：6件 PASS、5件 FAIL/課題検出）
    - 構文解析・静的解析（Node.js V8 ランタイム構文チェック、予約語・パイプ記号エスケープ確認）
  - **検査済み**:
    - `コード.js` のロジック精査（`sanitizeFolderId_`, `doGet`, `getAppConfig`, `saveLastFolderId`, `clearLastFolderId`, `getHtmlFileList`, `searchHtmlFiles`）
    - `index.html` のロジック精査（`SafeStorage`, `resolveInitialFolderId`, `handleFolderLoadError`, `executeSearch`, `applyFolder`, `initializeApp`, DOMバインド）
  - **推論済み**:
    - 本番 Google Apps Script 実行環境（`script.googleusercontent.com` サンドボックス iframe）におけるクオータ制限および CHIPS/サードパーティCookie遮断下での挙動
  - **未検証**:
    - 実機（複数の物理端末・実Googleアカウント環境）でのエンドツーエンド手動ブラウジング検証（ステージング環境/実デプロイ後フェーズ）

- **総合評価**: **要修正 (Action Required)**
  - 基本機能（正常系・標準フォールバックカスケード）は高い完成度で実装されているものの、障害モード（敵対的入力、一時的ネットワーク障害、自己修復の判定漏れ、テンプレート展開時の構文破壊）において、ユーザーデータ消失や画面ホワイトアウト、回復不能なエラー状態に陥る重大な欠陥が 5 件検出されました。シニアコーダーによる修正対応が必要です。

---

## 2. 観点別テスト結果（12大検証項目）

| # | 検証項目 | ステータス | 判定 | 主な検証内容・所見 |
| :---: | :--- | :---: | :---: | :--- |
| 1 | **機能の正確性** | 実行済み | **合格** | AC-1〜AC-5 の標準シナリオ（カスケード解決、UserProperties への保存・復元、localStorage のフォールバック）は要件通り正しく動作することを確認。 |
| 2 | **エッジケース** | 実行済み | **要修正** | Google Drive URL の `open?id=...` 形式が考慮されておらず、手動入力モーダルで弾かれる（BUG-004）。 |
| 3 | **境界条件** | 実行済み | **合格** | 空文字、空白のみ、極小値、PropertiesService の上限境界等を検証。`resolveInitialFolderId` の優先順位カスケードは境界値でも正確に機能。 |
| 4 | **無効な入力** | 実行済み | **要修正** | クエリパラメータに改行文字等が含まれていた場合、インラインスクリプトの文字列リテラル構文が破壊され JS が完全停止する（BUG-003）。 |
| 5 | **エラー処理** | 実行済み | **要修正** | 不正なフォルダIDが渡された際、エラーメッセージの不一致により自己修復がトリガーされず、回復不能な停止状態に陥る（BUG-001）。 |
| 6 | **セキュリティ** | 実行済み | **要修正** | `doGet(e)` で受け取った `folderId` を未サニタイズのままクライアント側インライン `<script>` に埋め込んでおり、テンプレートインジェクション・構文破壊リスクが存在する（BUG-003）。 |
| 7 | **並行性** | 実行済み | **要修正** | `applyFolder` における `saveLastFolderId` が順序制御なしで非同期実行されるため、素早いフォルダ切り替え時に古い状態が上書きされるレースコンディションが存在する（BUG-005）。 |
| 8 | **信頼性** | 実行済み | **要修正** | 一時的な通信障害（タイムアウトや瞬断）でも無条件に `handleFolderLoadError` が呼ばれ、正常に保存されていたフォルダ設定が誤消去される（BUG-002）。 |
| 9 | **パフォーマンス** | 検査済み | **合格** | 初期設定取得は 1 RTT で完了し、`executeSearch` のデバウンス（400ms）および最新リクエストID管理が機能しており過剰な負荷は抑制されている。 |
| 10 | **データ整合性** | 実行済み | **要修正** | ネットワーク瞬断時の不要なデータ削除（BUG-002）および並行保存時の競合（BUG-005）によりデータ不整合のリスクがある。 |
| 11 | **後方互換性** | 実行済み | **合格** | 既存の `getAppConfig` フィールドおよび各種コンテンツ取得 API のシグネチャ・互換性は完全に維持されている。 |
| 12 | **回帰リスク** | 実行済み | **合格** | Google Picker 連携、手動入力モーダル、全文検索、HTMLプレビュー（srcdoc）、レスポンシブ切り替えの全機能が正常に保持されている。 |

---

## 3. 発見された不具合・課題一覧 (Issue票)

### [BUG-001]: 不正・無効なフォルダID形式保存時の自己修復機能不全による永久停止
- **重大度**: **High**
- **関連要件/受け入れ基準**: FR-3, AC-6 (無効フォルダのリカバリー)
- **再現手順**:
  1. 不正な文字列（例: 記号を含む `invalid!id#test` や Drive URLのパース崩れ）が何らかの理由で `UserProperties` または `localStorage` に保存される（または URL引数で渡される）。
  2. Web App を起動またはリロードする。
  3. `initializeApp` から `getHtmlFileList('invalid!id#test')` が実行される。
  4. サーバー側（`コード.js`）は `sanitizeFolderId_` 内で例外をスローし、`{ success: false, error: '無効なフォルダID形式です。英数字のIDまたはドライブURLを入力してください。' }` を返却する。
  5. クライアント側（`index.html`）の `executeSearch` がレスポンスを受信する。
- **期待される動作**:
  - 保存されたフォルダが無効であるため、`handleFolderLoadError` が呼び出され、無効なプロパティが削除された上で、デフォルトフォルダへの切り替えまたはフォルダ選択ダイアログが安全に表示されること。
- **実際の動作**:
  - `executeSearch` 内の自己修復判定条件が `response.error.includes('指定されたフォルダ') || response.error.includes('ゴミ箱')` となっており、返却された `'無効なフォルダID形式です...'` や `'フォルダIDが指定されていません。'` にマッチしない。
  - 結果として `handleFolderLoadError` が呼び出されず、エラートーストを表示したまま処理が停止する。
  - 保存情報が消去されないため、ユーザーがブラウザをリロードしても毎回同じ無効IDを読み込み、永久にエラー停止（デッドロック）状態となる。
- **証拠・ログ**:
  - `tests/adversarial_tests.js` (ADV-REC-001) にて実証：
    ```text
    [FAIL/ISSUE] ADV-REC-001: 無効フォルダID形式が保存されていた場合の自己修復（AC-6）
           Error: エラーメッセージ "無効なフォルダID形式です。英数字のIDまたはドライブURLを入力してください。" は "指定されたフォルダ" にも "ゴミ箱" にも一致しないため、handleFolderLoadError が呼ばれず自己修復が発動しません。結果として無効な設定が削除されず永久エラーに陥ります。
    ```
- **考えられる原因**: **実装起因**
  - エラーの種別判定をサーバー側特定文字列の部分一致に依存しており、バリデーションエラーのメッセージパターンが網羅されていない。
- **推奨される次の対応**: **シニアコーダー修正**
  - `executeSearch` のエラー判定において、フォルダの取得失敗エラー（`getHtmlFileList` の失敗全般、または無効形式エラー含む）が発生した場合に確実に `handleFolderLoadError` を呼び出すよう条件を改修する。

---

### [BUG-002]: 一時的ネットワーク障害時における有効な前回フォルダ情報の誤破棄（データ消失）
- **重大度**: **High**
- **関連要件/受け入れ基準**: FR-1, FR-3, NFR-2, AC-6
- **再現手順**:
  1. ユーザーが正常なフォルダIDを保存して運用している。
  2. Web App 起動時、Wi-Fiの瞬断や Google サーバーの一時的なビジーにより、`getHtmlFileList` の RPC 通信がタイムアウトまたはネットワークエラーとなる。
  3. `initializeApp` 内の `google.script.run...getHtmlFileList` の `withFailureHandler` が発火する。
- **期待される動作**:
  - 一時的な通信障害であるため、エラートースト（「通信エラーが発生しました。再試行してください」）を表示し、保存されている正常なフォルダ設定（`UserProperties` および `SafeStorage`）は破棄せずに保持すること。
- **実際の動作**:
  - `initializeApp` の `withFailureHandler` が無条件に `handleFolderLoadError(currentFolderId, err.message)` を呼び出す（`index.html` 803行目）。
  - `handleFolderLoadError` 内で `SafeStorage.remove` および `google.script.run.clearLastFolderId()` が即座に実行され、正常に保存されていたユーザーの前回フォルダ情報が完全に消去されてしまう。
- **証拠・ログ**:
  - `tests/adversarial_tests.js` (ADV-REC-002) にて実証：
    ```javascript
    // index.html: 802-805行目
    .withFailureHandler(function(err) {
      handleFolderLoadError(currentFolderId, err.message);
    })
    ```
- **考えられる原因**: **実装起因**
  - 「フォルダの永続的無効化（404/削除/権限なし）」と「一時的なトランスポート層の通信エラー」の区別を行わずに一律で自己修復（消去）ハンドラーへルーティングしている。
- **推奨される次の対応**: **シニアコーダー修正**
  - `initializeApp` の `getHtmlFileList` における `withFailureHandler` では `handleFolderLoadError` を呼ばず、通常の通信エラー通知（`showErrorToast`）とステータス更新のみを行うよう分離する。

---

### [BUG-003]: `doGet(e)` のクエリパラメータ検証欠如によるJS構文エラー発生および画面ホワイトアウト
- **重大度**: **High**
- **関連要件/受け入れ基準**: FR-4, NFR-2, AC-5, セキュリティ
- **再現手順**:
  1. 悪意のあるユーザーまたは不正なリンク（改行コード `%0A` や `%0D` を含むクエリパラメータ）からアクセスする。
     例: `https://script.google.com/.../exec?folderId=12345%0Aalert(1)%0A`
  2. サーバーサイドの `doGet(e)` が実行される。
  3. `doGet` はパラメータをサニタイズせず `template.urlFolderId = rawUrlFolderId.trim()` としてテンプレートを評価する。
  4. クライアント側 `index.html` の `<script>` タグ内に `const SERVER_URL_FOLDER_ID = '12345\nalert(1)';` がそのまま展開される。
- **期待される動作**:
  - 不正な文字を含むクエリパラメータはサーバー側で破棄または安全にサニタイズされ、クライアント側スクリプトが正常に実行されること。
- **実際の動作**:
  - JavaScript の文字列リテラル内部に改行コードが挿入され、ブラウザが `Uncaught SyntaxError: Invalid or unexpected token` を発生させる。
  - `<script>` ブロック全体の解析・実行が中断し、`SafeStorage`、`initializeApp`、各種イベントリスナーが一切初期化されず、画面が完全にホワイトアウト（クラッシュ）する。
- **証拠・ログ**:
  - `tests/adversarial_tests.js` (ADV-SEC-001) にて実証：
    ```text
    [FAIL/ISSUE] ADV-SEC-001: doGet での改行混入によるテンプレートJS構文エラー破壊の検証
           Error: JavaScript構文エラーが発生しました: Invalid or unexpected token。改行を含むURLパラメータによりクライアント側スクリプトが完全停止（ホワイトアウト）します。
    ```
- **考えられる原因**: **実装起因**
  - `doGet` でのクエリパラメータバリデーションの欠落、および `<script>` 内への生テンプレート変数展開方式（インライン文字列リテラル結合）の脆弱性。
- **推奨される次の対応**: **シニアコーダー修正**
  - サーバー側の `doGet(e)` において、クエリパラメータを `sanitizeFolderId_` または英数字・ハイフン・アンダースコアの正規表現で厳格に検証し、形式に合致しない場合は空文字列を渡すように修正する。

---

### [BUG-004]: Google Drive `open?id=` 形式 URL の入力拒否
- **重大度**: **Medium**
- **関連要件/受け入れ基準**: FR-1, AC-1, エッジケース
- **再現手順**:
  1. 手動フォルダ入力モーダルを開く。
  2. Google ドライブで一般的に共有される URL 形式 `https://drive.google.com/open?id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7` を入力して適用を押す。
  3. `submitManualFolder` から `getFolderDetails` が呼び出される。
- **期待される動作**:
  - `open?id=` 形式からフォルダID `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7` が抽出され、フォルダが正常に適用されること。
- **実際の動作**:
  - `sanitizeFolderId_` の正規表現が `/folders\/([a-zA-Z0-9_-]+)/` のみとなっているため、`open?id=` 形式にマッチしない。
  - 全体のURLがそのままバリデーション正規表現 `/^[a-zA-Z0-9_-]+$/` に送られ、「無効なフォルダID形式です。英数字のIDまたはドライブURLを入力してください。」とエラー表示されて拒否される。
- **証拠・ログ**:
  - `tests/adversarial_tests.js` (ADV-INP-001) にて実証：
    ```text
    [FAIL/ISSUE] ADV-INP-001: open?id= 形式の Google Drive URL の受付可否
           Error: 無効なフォルダID形式です。英数字のIDまたはドライブURLを入力してください。
    ```
- **考えられる原因**: **実装起因**
  - ドライブURLパース正規表現の網羅性不足。
- **推奨される次の対応**: **シニアコーダー修正**
  - `sanitizeFolderId_` の正規表現を拡張し、`folders\/([a-zA-Z0-9_-]+)` に加えて `[?&]id=([a-zA-Z0-9_-]+)` 形式のパラメータも抽出できるように修正する。

---

### [BUG-005]: 連続フォルダ切り替え時における非同期保存（`saveLastFolderId`）のレースコンディション
- **重大度**: **Low**
- **関連要件/受け入れ基準**: FR-1, NFR-3, AC-1, 並行性
- **再現手順**:
  1. ユーザーがフォルダAを選択した直後、素早く別のフォルダBを選択する。
  2. `applyFolder` により `saveLastFolderId(A)` と `saveLastFolderId(B)` がほぼ同時に GAS サーバーへ非同期送信される。
  3. ネットワーク遅延やサーバー処理時間のばらつきにより、後発の `saveLastFolderId(B)` が先に完了し、先発の `saveLastFolderId(A)` が遅れて後から完了する。
- **期待される動作**:
  - 最後にユーザーが意図して選択したフォルダBが永続化されること。
- **実際の動作**:
  - 遅れて完了したリクエストAによってサーバー側の `PropertiesService.getUserProperties()` がフォルダAで上書きされる。
  - 次回起動時、直近のフォルダBではなく、以前に選んだフォルダAが復元されてしまう。
- **証拠・ログ**:
  - `index.html` 617-626 行目において、`saveLastFolderId` のリクエスト順序管理やタイムスタンプ・シーケンス制御が存在しないことを確認。
- **考えられる原因**: **アーキテクチャ・設計起因**
  - 非ブロッキング・非同期保存（Fire-and-Forget）を採用した際の並行リクエスト制御方針の未規定。
- **推奨される次の対応**: **シニアコーダー修正**
  - `applyFolder` 内で保存用シーケンスIDまたはタイムスタンプをクライアント側で管理し、最新のリクエストのみを反映する、または保存処理に簡易なデバウンスを導入する。

---

## 4. エスカレーション事項

### 1. アーキテクトへの報告: 一時的通信障害と自己修復（消去）の境界規定
- **内容**:
  - アーキテクチャ設計書 FR-3 および受け入れ基準 AC-6 では「アクセス不可となった場合、無効な保存データを自動消去（クリーンアップ）」と規定されています。
  - 今回の実装において、一時的なネットワーク切断やサーバー瞬断（`withFailureHandler`）時にもクリーンアップが発動して有効な設定が消失するバグ（BUG-002）が発見されました。
  - 今後同様の設計を行う際の指針として、「サーバー側から明確な存在確認エラー（HTTP 404 / Drive NotFound / Trashed）が返却された場合のみ消去を実行し、トランスポート層エラーは再試行または警告にとどめる」という例外区分の原則をアーキテクチャ標準に追記することを推奨します。

---

## 5. 次のステップ（推奨アクション）

1. **シニアコーダーへの修正依頼**:
   - `docs/reports/QA_REPORT.md` に記載された BUG-001 〜 BUG-005 の修正。
   - 特に High 重大度の BUG-001（自己修復判定）、BUG-002（ネットワーク障害時の誤消去防止）、BUG-003（`doGet` パラメータサニタイズ）を最優先で対応。
2. **回帰検証**:
   - 修正完了後、`tests/run_tests.js` および `tests/adversarial_tests.js` の全テストが合格（FAIL=0）することを確認。
3. **コードレビュアー監査（Phase 5）**:
   - QA修正確認完了後、最終コード監査へ移行。
