# 実装計画・タスク仕様書（フォルダ選択障害の恒久対策・アプリ内 Drive フォルダブラウザ導入）

> **文書ステータス**: Phase 2（実装計画・タスク仕様）  
> **対象設計書**: [ARCHITECTURE_FOLDER_SELECTION_FIX.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/architecture/ARCHITECTURE_FOLDER_SELECTION_FIX.md)  
> **ゲート1 ユーザー承認事項**:
> 1. 「アプリ内 Drive フォルダブラウザ ＋ 手動 ID/URL 入力」をフォルダ選択の一次手段とする構成を承認。
> 2. 補助手段（C-1）として、統合モーダル内に **「Google Picker で開く」ボタンを残置する**。ただしスマートフォン等の狭画面（幅 320px〜390px 想定）でもメインのフォルダ一覧・選択操作・入力欄を邪魔せず、折り返し崩れ・はみ出し・誤タップが起きない配置・レスポンシブ設計を徹底する。

---

## 1. アーキテクチャレビュー所見

### 1.1 実現可能性評価
承認済みアーキテクチャ設計書（[ARCHITECTURE_FOLDER_SELECTION_FIX.md](file:///c:/Users/nanko/Downloads/HttpViewer-app/docs/architecture/ARCHITECTURE_FOLDER_SELECTION_FIX.md)）と現行コードベース（[index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html)、[js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js)、[js/picker.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/picker.js)、[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js)、[js/folder-resolver.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/folder-resolver.js)、[js/config.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/config.js)、[tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js)、[tests/adversarial_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/adversarial_tests.js)）を精査した結果を以下に示します。

- **総合評価**: **承認（Feasible — 実装レベルの詳細補完を組み込み済み）**
- **評価理由**:
  - 既存の `AuthService`（`https://www.googleapis.com/auth/drive.readonly` のみ使用）と `DriveApiClient`（`fetch` + `Authorization: Bearer` 通信）はサードパーティ Cookie に一切依存せず稼働しており、同じトークン・通信基盤を用いて Drive API v3 `files.list` および `drives.list` によるアプリ内フォルダブラウザを完全静的 SPA 構成のまま実現できる。
  - `AppStateController` にはすでに `routeUnauthorizedOrAbort({ type: 'openFolderSelection' })` および `pendingRetryAction` による再認証復帰機構（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L590-L599), [L846-L849](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L846-L849)）が実装されており、フォルダブラウザからの `401` 復帰も既存設計に自然統合できる。
  - ただし、Drive API v3 のパラメータ制約・状態管理の境界・静的テスト制約・モバイル UI のレイアウトに関して、実装前に明確化すべき技術補完事項を抽出し、次項の通り仕様へ反映した。

---

### 1.2 留意事項・技術リスク（批判的検証結果）

#### (1) Drive API v3 パラメータ・境界・エラー分類の補完
1. **`drives.list` エンドポイントの `orderBy` 非対応と `pageSize` 上限**:
   - 設計書 Section 3.2 では `files.list` 側に `orderBy=folder,name` を記載しているが、共有ドライブ一覧エンドポイント `GET https://www.googleapis.com/drive/v3/drives` は `orderBy` クエリパラメータをサポートしていない。また `drives.list` の `pageSize` 上限は `100` である。
   - **対策**: `listSharedDrives` では `orderBy` を付与せず（必要であればクライアント側で名前順ソート）、`pageSize` を `1〜100` の範囲にクランプする。また `listSubfolders` / `searchFolders` の `files.list` でも対象がフォルダのみ（`mimeType = 'application/vnd.google-apps.folder'`）であるため、`orderBy=name` を指定する。
2. **`SHARED_WITH_ME` 配下のドリルダウン切替**:
   - `space === 'SHARED_WITH_ME'` の初期一覧（ルート）では `q` に `sharedWithMe = true and mimeType = 'application/vnd.google-apps.folder' and trashed = false` を用いるが、一覧内の共有フォルダを開いてサブ階層へ移動（ドリルダウン）した後は `parentId` が確定するため、`'<cleanParentId>' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false` へ切り替える必要がある。
3. **`SHARED_DRIVES` 配下の `corpora=drive` と `driveId` の必須ペア**:
   - Drive API v3 仕様上、特定共有ドライブ内を検索・一覧取得する際は `corpora=drive` と `driveId=<cleanDriveId>` および `supportsAllDrives=true&includeItemsFromAllDrives=true` を必ず同時に指定する。`parentId` が省略された場合は `driveId` 自体（共有ドライブ直下）を `parentId` とみなす。`driveId` が空のまま `space === 'SHARED_DRIVES'` で `listSubfolders` が呼ばれた場合は `INVALID_INPUT` を返す。
4. **`sanitizeFolderId` と `'root'` の境界**:
   - 現行 [js/folder-resolver.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/folder-resolver.js#L48) の `sanitizeFolderId` は `/^[a-zA-Z0-9_-]+$/` を許容するため、`'root'` 文字列自体は通過する。`listSubfolders` では `space === 'MY_DRIVE'` かつ `parentId` 未指定または `'root'` の場合に `'root'` を使用し、それ以外の `parentId` および `driveId` は必ず `sanitizeFolderId` を通して検証失敗時に `{ success: false, errorCode: 'INVALID_INPUT', error }` を返す（例外をそのまま外部へ投げない）。
5. **`searchFolders` の空キーワード境界**:
   - `DriveApi.sanitizeSearchQuery(keyword)` の結果が空文字になった場合は、無条件の全フォルダ列挙クエリを発行せず `{ success: false, errorCode: 'INVALID_INPUT', error: '検索キーワードを入力してください。' }` を返す。また UI 側で検索欄が空になった場合は自動的に現在の空間・階層の一覧表示へ復帰させる。
6. **共通エラー分類（`mapDriveHttpError`）の再利用**:
   - 既存の `mapDriveHttpError`（[js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js#L92-L160)）をそのまま利用し、`401` (`UNAUTHORIZED`)、`403` レート制限 (`RATE_LIMITED`) / API 無効 (`API_DISABLED`) / 権限不足 (`FORBIDDEN`)、`404` (`NOT_FOUND`)、`429` (`RATE_LIMITED`)、`5xx`・通信エラー (`NETWORK_ERROR`) を一貫して分類する。

#### (2) `AppStateController` 状態整合性・`401` 復帰・レースコンディション対策
1. **既存作業状態（`currentFolderId` / `activeFileId` / `LAST_FOLDER_ID`）の保護**:
   - フォルダブラウザで空間切替・ドリルダウン・検索・ページ読み込みを行っている間は「仮ブラウズ状態」に留め、ユーザーが明示的にフォルダを確定するまで **`currentFolderId`・`activeFileId`・プレビュー表示・`localStorage`（`LAST_FOLDER_ID`）を一切変更しない**。
   - 確定時のみモーダルを閉じて既存の `applyFolder(folder.id, folder.name)` を呼び出す。
2. **モーダル内 `401` 発生時の UI 閉鎖と自動再オープン**:
   - 現行 [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html) ではモーダルが `z-50`、ヘッダーが `z-40`、`#expiredBanner` が `z-30` である。統合モーダルが開いたまま `401` が返却されると、再認証バナーやヘッダーの「再認証」ボタンがモーダル背面で隠れ操作不能になる。
   - そのため、ブラウザ操作中（および事前トークン確認時）に `UNAUTHORIZED` を検知したら、**即座に統合モーダルを閉じ**、進行中のブラウズリクエストを無効化した上で `routeUnauthorizedOrAbort({ type: 'openFolderSelection' })` を実行する。再認証完了後は既存の `handleAuthStateChange`（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js#L846-L849)）により `openFolderSelection()` が自動再起動される。
3. **レースコンディション防止（リクエスト世代管理）**:
   - 既存の `currentSearchRequestId` / `currentPreviewRequestId` と同じパターンで **`folderBrowseRequestId`** を導入する。
   - `openFolderSelection()` 起動時、空間切替時、階層移動時、検索実行時、モーダル閉鎖時、および `clearWorkingViewState()` 時に `folderBrowseRequestId++` を行い、古い非同期レスポンスがモーダル UI を上書きすることを防止する。
   - サインアウト・`clientId` 変更時の `clearWorkingViewState()` でも統合モーダルを閉じる処理を必ず含める。
4. **Google Picker 補助起動のモーダル重ね順と復帰**:
   - 統合モーダル内から「Google Picker で開く」をクリックした際、統合モーダルは裏で開いたまま維持する（Google Picker のダイアログは `document.body` 直下に高 `z-index` で表示される）。
   - `onPicked(folder)` 時のみ統合モーダルを閉じて `applyFolder(folder.id, folder.name)` を実行し、`onCancel()` 時は統合モーダルをそのまま残して別手段ですぐ選択継続できる状態を保つ。`onFallbackToManual(reason)` 時は直接入力タブへ切り替えてトースト等で案内する。
   - Picker 起動ボタンの表示可否は、毎回モーダルを開く時点および `gapiScript` の `load` 完了イベント時に `resolvedConfig && resolvedConfig.isPickerConfigured && pickerService.isLoaded()` を再評価して更新する。

#### (3) `tests/run_tests.js` 静的整合性テストおよびモック UI 後方互換の絶対維持
1. **DOM ID 整合性チェック（[tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js#L241-L266)）**:
   - `tests/run_tests.js` は `js/app.js` 内の全 `getElementById('...')`（正規表現抽出・コメント内含む）が `index.html` の `id="..."` に存在することを検証している。
   - **遵守事項**: `js/app.js` に記述するすべての `getElementById` 引数は `index.html` に実在させ、存在しない ID をコメント等にも書かない。また、既存の `#manualFolderModal`、`#folderIdInput`、`#closeModalBtn`、`#cancelModalBtn`、`#submitFolderBtn` の ID は維持する。
2. **スクリプト読み込み順序チェック・禁止文字列チェック（[tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js#L197-L239)）**:
   - 既存 8 ファイルの `<script>` 読み込み順序と `sandbox="allow-scripts allow-forms allow-same-origin"` を変更せず維持する。新規 JS ファイル分割は行わず、既存モジュール構成（`js/drive-api.js`, `js/picker.js`, `js/app.js`）内で責務を整理して実装リスクを最小化する。
   - 全対象ファイルで `\vert`、`\mid`、`// TODO`、`// 省略`、`google.script` を含めない。
3. **モック UI 後方互換性（ADR-9）**:
   - `tests/run_tests.js` の `createTrackingMockUi` および `tests/adversarial_tests.js` の `createNoopUi` は `openManualFolderModal` / `closeManualFolderModal` のみを実装している。
   - `AppStateController` の `openFolderSelection()` では `typeof ui.openFolderSelectorModal === 'function'` の有無を確認し、未定義の場合は既存の `ui.openManualFolderModal(currentFolderId)` へフォールバックすることで、`BUG-GP-006` / `BUG-GP-008` / `ADV-REC-002` を含む既存全テストとの完全互換を保つ。

#### (4) モバイル（幅 320px〜390px）での統合モーダルレスポンシブ設計
1. **全体枠・内部スクロール分離**:
   - モーダル本体に `max-h-[90vh] flex flex-col overflow-hidden` を適用し、ヘッダー・タブ・空間切替・検索・パンくずを上部に固定、フッターを下部に固定、**フォルダ一覧リスト部分のみを `flex-1 min-h-0 overflow-y-auto touch-scroll` で内部スクロール**させる。これにより狭い画面でも決定ボタンや閉じるボタンが画面外に押し出されない。
2. **「Google Picker で開く」ボタンの邪魔にならない配置（ゲート1 承認事項）**:
   - メインのフォルダ一覧・検索欄・入力欄・主要ボタン（「このフォルダを選択」「フォルダを適用」「キャンセル」）を一切圧迫しないよう、モーダル最下部のフッター内に独立した補助導線エリア（主要アクション行の下段、または PC 幅では左端寄せ・モバイルでは折り返し下段配置）を設け、控えめなテキストリンク風補助ボタン（例：`border border-slate-200` 無しの軽量テキストボタン、または極薄セカンダリリンク風 `text-xs text-slate-500 hover:text-blue-600 py-1.5 px-2`）として配置する。
   - モバイル幅（320px〜390px）でボタン同士が横並びに詰まって折り返し崩れ・誤タップを起こさないよう、フッターは `flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between` 構成とし、上段（右側）に主要操作、下段（左側）に Picker 補助導線を分離する。
3. **パンくずリスト・フォルダ行の狭画面対応**:
   - パンくずは `flex items-center gap-1 overflow-x-auto whitespace-nowrap` として横はみ出しを防ぎ、各セグメント名には `max-w-[130px] sm:max-w-[200px] truncate` を設定する。
   - フォルダ行は左側「フォルダアイコン＋名称（タップで中を開く）」と右側「選択ボタン（独立したタップ領域、`flex-shrink-0`）」を明確に分離し、320px 幅でも名称が省略表示（`truncate`）されてボタンが押し出されないようにする。

---

### 1.3 アーキテクトへのエスカレーション有無
- **エスカレーション**: **なし**
- **判断根拠**: 上流の決定事項（ADR-7〜ADR-9、ゲート1 承認事項 1・2）との矛盾は一切なく、抽出した技術的留意事項（`drives.list` の `orderBy` 非対応・`pageSize` 上限、`SHARED_WITH_ME` ドリルダウン切替、モーダル `401` 閉鎖、レース防止、モバイルレイアウト細部）はすべてアーキテクチャ境界内の実装仕様として解決可能である。

---

## 2. 影響範囲・変更対象ファイル一覧

### 2.1 変更対象ファイル一覧

| ファイルパス | 操作 | 概要・責務 | 影響度 |
| :--- | :---: | :--- | :---: |
| [js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js) | **変更** | `DRIVE_DRIVES_API_BASE` 追加、`listSubfolders` / `listSharedDrives` / `searchFolders` メソッドの実装とエクスポート | 高 |
| [js/picker.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/picker.js) | **変更** | `activePicker` インスタンス保持、`disposeActivePicker()` による再起動前・`PICKED`・`CANCEL`・エラー時破棄処理の追加 | 中 |
| [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html) | **変更** | `#manualFolderModal` を統合フォルダ選択モーダル（ブラウザタブ・直接入力タブ・モバイル配慮フッター・Picker 補助ボタン）へ拡張、設定モーダル補足文言の整合更新 | 高 |
| [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js) | **変更** | `DomUiAdapter` の統合モーダル描画・制御メソッド追加、`AppStateController` のフォルダブラウザ状態管理・`openFolderSelection()` 改修・`401`/競合制御・`mountBrowserApp()` イベント結線 | 高 |
| [tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js) | **変更** | `DriveApiClient` 新規 3 メソッド・`PickerService.dispose()`・`AppStateController` 統合フォルダ選択フローの単体/結合テスト追加 | 高 |
| [tests/adversarial_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/adversarial_tests.js) | **変更** | フォルダブラウザ XSS・クエリインジェクション・階層移動/検索レースコンディション・`401`/一時障害時の状態保全テスト追加 | 高 |

※ [js/folder-resolver.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/folder-resolver.js)、[js/config.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/config.js)、[js/auth.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/auth.js)、[js/storage.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/storage.js)、[config.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/config.js) は現行仕様のまま変更不要（既存 API を再利用する）。

### 2.2 依存関係・後方互換性への考慮事項
- **スクリプト依存 DAG の不変性**: `<script>` 読み込み順序（`config.js` → `storage.js` → `folder-resolver.js` → `config.js` → `auth.js` → `drive-api.js` → `picker.js` → `app.js`）は一切変更しない。
- **`UiAdapter` インターフェース互換性**:
  - `DomUiAdapter` には `openFolderSelectorModal` / `closeFolderSelectorModal` 等を追加するが、既存の `openManualFolderModal` / `closeManualFolderModal` / `getManualFolderInput` も引き続き公開し、モック UI が新メソッドを持たない場合は `openManualFolderModal` にフォールバックする。
- **ハイブリッド設定（B-1）との互換性**:
  - `AppConfigProvider` の `clientId` / `apiKey` / `appId` / `defaultFolderId` スキーマおよび `isPickerConfigured` 判定はそのまま維持する。`apiKey` / `appId` が未設定でもアプリ内フォルダブラウザと直接入力の双方が即座に動作する。

---

## 3. インターフェース・データ構造仕様

### 3.1 `DriveApiClient` 拡張仕様（[js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js)）

```typescript
interface DriveFolderItem {
  id: string;
  name: string;
  driveId: string;        // 共有ドライブ配下時は該当ドライブID、マイドライブ等は ''
  isSharedDrive: boolean; // listSharedDrives 由来なら true、files.list 由来なら false
}

interface FolderBrowsePage {
  items: DriveFolderItem[];
  nextPageToken: string | null;
}

interface CancelSignal {
  isCancelled?: () => boolean;
}
```

#### 追加メソッドシグネチャとパラメータ仕様

1. **`listSubfolders(params, signal)`**
   - 引数 `params`:
     - `space`: `'MY_DRIVE' | 'SHARED_DRIVES' | 'SHARED_WITH_ME'`（省略時は `'MY_DRIVE'`）
     - `parentId?: string`
     - `driveId?: string`
     - `pageToken?: string`
     - `pageSize?: number`（デフォルト `100`、`1〜1000` にクランプ）
   - 挙動仕様:
     - `space === 'MY_DRIVE'`: `targetParent = (!params.parentId || params.parentId === 'root') ? 'root' : sanitizeFolderId(params.parentId)`。`q = "'<targetParent>' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"`。
     - `space === 'SHARED_DRIVES'`: `driveId` 必須（`sanitizeFolderId(params.driveId)`）。`targetParent = params.parentId ? sanitizeFolderId(params.parentId) : cleanDriveId`。`q = "'<targetParent>' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"`。さらに `corpora=drive` と `driveId=<cleanDriveId>` を付与。
     - `space === 'SHARED_WITH_ME'`:
       - `params.parentId` 未指定時: `q = "sharedWithMe = true and mimeType = 'application/vnd.google-apps.folder' and trashed = false"`。
       - `params.parentId` 指定時（共有フォルダ内のドリルダウン）: `cleanParent = sanitizeFolderId(params.parentId)` とし、`q = "'<cleanParent>' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"`。
     - 共通付与パラメータ: `fields=nextPageToken,files(id,name,driveId)`, `orderBy=name`, `pageSize=<clamped>`, `supportsAllDrives=true`, `includeItemsFromAllDrives=true`, 必要に応じ `pageToken`。
     - 返却値: `{ success: true, data: { items, nextPageToken }, items, nextPageToken }` または `{ success: false, errorCode, error }`（キャンセル時は `{ success: false, cancelled: true, error }`）。

2. **`listSharedDrives(params, signal)`**
   - 引数 `params`: `{ pageToken?: string, pageSize?: number }`（デフォルト `100`、`1〜100` にクランプ）
   - エンドポイント: `GET https://www.googleapis.com/drive/v3/drives`
   - 付与パラメータ: `fields=nextPageToken,drives(id,name)`, `pageSize=<clamped>`, 必要に応じ `pageToken`（※ `orderBy` は付与しない）。
   - 変換: 各要素を `{ id, name: d.name || '(名称未設定)', driveId: d.id, isSharedDrive: true }` に正規化。
   - 返却値: `FolderBrowsePage` 形式（`data`, `items`, `nextPageToken`）。

3. **`searchFolders(params, signal)`**
   - 引数 `params`: `{ keyword: string, pageToken?: string, pageSize?: number }`（デフォルト `100`、`1〜1000` にクランプ）
   - 入力検証: `cleanKeyword = sanitizeSearchQuery(params.keyword)`。空文字なら `{ success: false, errorCode: 'INVALID_INPUT', error: '検索キーワードを入力してください。' }` を返却。
   - クエリ `q`: `"mimeType = 'application/vnd.google-apps.folder' and trashed = false and name contains '<cleanKeyword>'"`
   - 付与パラメータ: `fields=nextPageToken,files(id,name,driveId)`, `corpora=allDrives`, `orderBy=name`, `pageSize=<clamped>`, `supportsAllDrives=true`, `includeItemsFromAllDrives=true`, 必要に応じ `pageToken`。

4. **エクスポート追加（[js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js)）**:
   - インスタンス返却オブジェクトへ `listSubfolders`, `listSharedDrives`, `searchFolders` を追加。
   - モジュール定数 `DRIVE_DRIVES_API_BASE` もテスト検証用に公開する。

---

### 3.2 `PickerService` 拡張仕様（[js/picker.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/picker.js)）

- 内部変数 `activePicker` を保持し、ヘルパー `disposeActivePicker()` を定義する：
  - `activePicker` が存在し `typeof activePicker.dispose === 'function'` の場合のみ `try { activePicker.dispose(); } catch (e) { console.warn(...); }` を実行し、`activePicker = null` に戻す。
- `disposeActivePicker()` の呼び出しタイミング：
  1. `openFolderPicker()` で新規インスタンスを `builder.build()` / `setVisible(true)` する前
  2. `setCallback` で `Action.PICKED` または `Action.CANCEL` を受信した直後（コールバック実行と連動し確実に破棄）
  3. `try { ... } catch` による構築・表示失敗時
- 外部 API（`load`, `isLoaded`, `openFolderPicker`）の引数・コールバック契約は完全維持。

---

### 3.3 統合フォルダ選択モーダル UI / DOM ID 仕様（[index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html) & `DomUiAdapter`）

#### (1) モーダル構造・レスポンシブ配置（幅 320px〜PC 対応）

```text
+-------------------------------------------------------------------+
| [ヘッダー: 固定] フォルダを選択                             [×]  |
+-------------------------------------------------------------------+
| [タブ切替: 固定]  [ ドライブから選択 ]  |  [ ID / URL を直接入力 ]  |
+-------------------------------------------------------------------+
| ▼ タブ1: ドライブから選択 (browserPanel)                          |
|  [空間切替: 3等分/折り返し可] マイドライブ | 共有ドライブ | 共有  |
|  [検索欄] 🔍 フォルダ名で検索...                       [×] [検索] |
|  [パンくず: 横スクロール可] マイドライブ > 階層A > 階層B          |
|  +-------------------------------------------------------------+  |
|  | [内部スクロール領域: flex-1 min-h-0 overflow-y-auto]        |  |
|  |  📁 サブフォルダ名 (タップで開く)                [ 選択 ]   |  |
|  |  📁 長いフォルダ名は省略表示 truncate...         [ 選択 ]   |  |
|  |  [ さらに読み込む ] (nextPageToken 存在時)                  |  |
|  +-------------------------------------------------------------+  |
|-------------------------------------------------------------------|
| ▼ タブ2: ID / URL を直接入力 (manualPanel) ※初期は hidden         |
|  説明文 + #folderIdInput + 補足ヒント                             |
+-------------------------------------------------------------------+
| [フッター: 固定 / モバイル縦分離]                                 |
|  (上段・主要操作)        [キャンセル]  [このフォルダを選択 / 適用] |
|  (下段・補助導線 ※設定済&ロード済時のみ表示)                       |
|   Google Picker で開く (補助・外部ウィンドウ)                     |
+-------------------------------------------------------------------+
```

#### (2) DOM ID 契約一覧（`index.html` と `js/app.js` 間の完全一致対象）

- **既存維持 ID**:
  - `#manualFolderModal`（統合モーダルルート）
  - `#closeModalBtn`（右上 `×` ボタン）
  - `#cancelModalBtn`（フッター「キャンセル」ボタン）
  - `#folderIdInput`（直接入力テキストボックス）
  - `#submitFolderBtn`（直接入力タブ「フォルダを適用」ボタン）
- **新規追加 ID（統合モーダル内要素）**:
  - `#folderModalTabBrowser`（タブ: ドライブから選択）
  - `#folderModalTabManual`（タブ: ID / URL を直接入力）
  - `#folderBrowserPanel`（ブラウザタブ本体コンテナ）
  - `#folderManualPanel`（直接入力タブ本体コンテナ）
  - `#folderSpaceMyDriveBtn`（空間切替: マイドライブ）
  - `#folderSpaceSharedDrivesBtn`（空間切替: 共有ドライブ）
  - `#folderSpaceSharedWithMeBtn`（空間切替: 共有アイテム）
  - `#folderSearchInput`（フォルダ名検索入力）
  - `#clearFolderSearchBtn`（フォルダ検索クリアボタン）
  - `#folderSearchSubmitBtn`（フォルダ検索実行ボタン）
  - `#folderBreadcrumbs`（パンくずリスト描画先）
  - `#folderBrowserList`（フォルダ一覧・ローディング・エラー描画先）
  - `#folderLoadMoreWrap` / `#folderLoadMoreBtn`（「さらに読み込む」ボタン枠とボタン）
  - `#selectCurrentFolderBtn`（現在表示中の階層フォルダ確定ボタン — ルート以外の階層表示時に有効化）
  - `#openGooglePickerWrap` / `#openGooglePickerBtn`（補助導線: Google Picker 起動ボタン枠とボタン）

#### (3) `DomUiAdapter` 追加メソッド仕様（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js)）

- `openFolderSelectorModal(options)`:
  - `options`: `{ initialTab?: 'browser'|'manual', initialManualValue?: string, pickerAvailable?: boolean }`
  - `#manualFolderModal` を表示し、タブ・Picker 補助ボタン可視性を初期化。
- `closeFolderSelectorModal()`: `#manualFolderModal` を非表示化（既存 `closeManualFolderModal` と同一対象を閉じる）。
- `switchFolderModalTab(tab)`: `'browser'` / `'manual'` のアクティブスタイル・表示パネル・フッター確定ボタン（`#selectCurrentFolderBtn` vs `#submitFolderBtn`）を切り替え。
- `setPickerTriggerVisible(visible)`: `#openGooglePickerWrap` の `hidden` クラスを制御。
- `renderFolderBrowserState(viewState)`:
  - `viewState`: `{ space, breadcrumbs, items, hasMore, isLoading, isLoadingMore, errorMessage, searchKeyword, canSelectCurrentFolder }`
  - 空間ボタンのアクティブ表示更新、検索入力/クリアボタン同期、パンくず描画（`escapeHtml` 適用・`data-breadcrumb-index` 付与）、フォルダ行描画（`escapeHtml` 適用・行内「開く」領域と「選択」ボタン分離）、ローディング/空状態/エラー時「再試行」ボタン描画、「さらに読み込む」ボタン制御、`#selectCurrentFolderBtn` の `disabled` 制御を一括で反映。

---

### 3.4 `AppStateController` フォルダブラウザ状態とコールバック仕様（[js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js)）

```typescript
interface BreadcrumbEntry {
  id: string;        // 'root' | driveId | folderId | '' (仮想ルート)
  name: string;
  driveId: string;
}

interface FolderBrowserState {
  activeTab: 'browser' | 'manual';
  space: 'MY_DRIVE' | 'SHARED_DRIVES' | 'SHARED_WITH_ME';
  breadcrumbs: BreadcrumbEntry[];
  items: DriveFolderItem[];
  nextPageToken: string | null;
  searchKeyword: string;
  isLoading: boolean;
  isLoadingMore: boolean;
  errorMessage: string;
}
```

- **コントローラ公開メソッド追加（結合テスト・ブラウザバインド兼用）**:
  - `openFolderSelection()`（統合モーダル対応 UI なら `openFolderSelectorModal` + `MY_DRIVE` 初期ロード、非対応モック UI なら `openManualFolderModal`）
  - `switchFolderBrowserSpace(space)`
  - `openFolderBrowserItem(item)`（サブフォルダまたは共有ドライブへドリルダウン）
  - `navigateFolderBreadcrumb(index)`（指定パンくず階層へ復帰）
  - `searchBrowserFolders(keyword)`（空なら現在階層の再取得、非空なら `driveApi.searchFolders`）
  - `loadMoreBrowserFolders()`（`nextPageToken` による次ページ追記取得）
  - `retryFolderBrowser()`（エラー時の同一条件再試行）
  - `confirmBrowserFolder(folder)`（モーダル閉鎖 + `applyFolder(folder.id, folder.name)`）
  - `confirmCurrentBrowserFolder()`（`breadcrumbs` 末尾の現在階層フォルダで確定、仮想ルートでは無効）
  - `openGooglePickerFromModal()`（トークン確認後 `pickerService.openFolderPicker` 起動）
  - `getFolderBrowserState()`（テスト検証用のスナップショット返却）

---

## 4. テスト戦略

### 4.1 単体テスト方針（[tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js)）
1. **静的整合性・構文・規約検証（セクション 1 維持）**:
   - `js/app.js` 内の全 `getElementById` と `index.html` 内の `id` の完全一致。
   - `<script>` 読み込み順序、`sandbox` 属性維持、`\vert`/`\mid`/`TODO`/`省略`/`google.script` 不在。
2. **`DriveApiClient` フォルダブラウズ系（セクション 6 拡張）**:
   - `listSubfolders`: `MY_DRIVE` (`'root'` / 特定 ID)、`SHARED_DRIVES` (`corpora=drive` + `driveId` + `supportsAllDrives=true`)、`SHARED_WITH_ME`（ルート `sharedWithMe = true` およびサブフォルダ `'<id>' in parents`）、`nextPageToken` 返却、`INVALID_INPUT`、キャンセル中断、HTTP エラー分類（`401`/`403`/`404`/`429`/`500`）。
   - `listSharedDrives`: `/drive/v3/drives` 呼び出し、`pageSize` の `1〜100` クランプ、`orderBy` パラメータが付与されないこと、`isSharedDrive: true` 正規化。
   - `searchFolders`: `corpora=allDrives`、空白・改行エスケープ、空文字時 `INVALID_INPUT`。
3. **`PickerService` ライフサイクル（セクション 7 拡張）**:
   - 連続起動時に前回インスタンスの `dispose()` が呼ばれること、`PICKED` / `CANCEL` 時に `dispose()` が呼ばれること、`dispose` 未実装モックでも例外が起きないこと。

### 4.2 結合テスト方針（[tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js) セクション 8 拡張）
- **統合モーダルでの一次選択フロー**:
  - `openFolderSelectorModal` を備えたモック UI を用い、`openFolderSelection()` 実行時に Google Picker ではなく統合モーダルが開き、`listSubfolders(MY_DRIVE, 'root')` が呼ばれること。
  - 共有ドライブ切替（`listSharedDrives`）→ ドライブ内ドリルダウン（`listSubfolders(SHARED_DRIVES, driveId)`）→ フォルダ確定（`confirmBrowserFolder`）でモーダルが閉じ `applyFolder` により HTML ファイル一覧が取得されること。
  - フォルダ名検索（`searchBrowserFolders`）および「さらに読み込む」（`loadMoreBrowserFolders`）で `items` が追記されること。
- **Google Picker 補助利用とフォールバック**:
  - `openGooglePickerFromModal()` で `onPicked` が呼ばれればモーダルが閉じて `applyFolder` が実行されること。
  - `onCancel` 時はモーダルが維持され `currentFolderId` が維持されること。
  - `onFallbackToManual` 時は手動入力タブへ切り替わり通知されること。
- **`401` 再認証自動復帰**:
  - フォルダブラウズ中（`listSubfolders` / `listSharedDrives` / `searchFolders`）に `401` が返った際、モーダルが即座に閉じ、`authService.getState().status === 'EXPIRED'` へ遷移し、再認証完了後に `openFolderSelection()` が自動再開すること。
- **既存モック UI 後方互換**:
  - `openManualFolderModal` のみを持つ既存モック UI（`createTrackingMockUi` / `createNoopUi`）では引き続き `openManualFolderModal` が呼ばれ、既存全 31 件が 100% 合格すること。

### 4.3 回帰・セキュリティ・敵対的テスト観点（[tests/adversarial_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/adversarial_tests.js)）
- **XSS 防御**: 悪意あるフォルダ名・共有ドライブ名（`<img src=x onerror=alert(1)>`, `"><script>alert(1)</script>`）を `escapeHtml` および `DomUiAdapter`（簡易 DOM モック）で描画した際、生の HTML タグが挿入されないこと。
- **クエリインジェクション防御**: `searchFolders` への `' or 1=1 \\\n\r` 注入がエスケープされること、`listSubfolders` への不正 `parentId` / `driveId`（`abc' or '1'='1` 等）が `INVALID_INPUT` で拒否されること。
- **レースコンディション防御**: 階層移動・空間切替・検索を連続実行し、古いリクエストを遅延解決させた場合でも最新リクエストの結果のみが採用されること。モーダルを閉じた後に遅延応答が到着しても状態や UI を更新しないこと。
- **トークン非漏洩・設定誤消去防止**: フォルダブラウズ中の `401` / `429` / `500` 発生時に、既に表示中の `currentFolderId` および `localStorage` の `LAST_FOLDER_ID` が削除されないこと。

---

## 5. 実装タスク一覧 (順序定義)

### タスク [TASK-001]: `DriveApiClient` フォルダブラウズ・検索 API 拡張
- **ID**: TASK-001
- **目的**: サードパーティ Cookie 非依存のアプリ内フォルダブラウザを実現するため、`DriveApiClient` に子フォルダ一覧取得・共有ドライブ一覧取得・フォルダ名検索の 3 メソッドを追加する。
- **入力**:
  - [js/drive-api.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/drive-api.js)
  - [js/folder-resolver.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/folder-resolver.js)（`sanitizeFolderId`）
  - Section 3.1 のインターフェース仕様
- **期待される結果**:
  - `DRIVE_DRIVES_API_BASE = 'https://www.googleapis.com/drive/v3/drives'` が定義されている。
  - `listSubfolders`、`listSharedDrives`、`searchFolders` が実装・公開され、すべて既存の `requireValidToken()`・`executeFetch()`・`mapDriveHttpError()`・`signal.isCancelled()` を利用している。
  - `drives.list` には `orderBy` を付与せず、`pageSize` が `1〜100` にクランプされている。
  - `SHARED_DRIVES` 時は `corpora=drive&driveId=<id>`、`searchFolders` 時は `corpora=allDrives` が付与されている。
- **対象ファイル**: `js/drive-api.js`
- **依存関係**: なし（先行タスクなし）
- **受け入れ基準**:
  - 不正 `parentId` / `driveId` および空 `keyword` に対して例外スローではなく `errorCode: 'INVALID_INPUT'` を返すこと。
  - `MY_DRIVE` / `SHARED_DRIVES` / `SHARED_WITH_ME`（ルート＆ドリルダウン）で正しい Drive API URL・`q` が構築されること。
  - キャンセルシグナル検知時に `{ success: false, cancelled: true }` を返すこと。
- **検証方法**: `node -e "const d = require('./js/drive-api.js'); console.log(typeof d.createDriveApiClient({getAccessToken:()=>'x'}).listSubfolders);"` および TASK-006 で追加する単体テスト実行。

---

### タスク [TASK-002]: `PickerService` インスタンスライフサイクル管理改善
- **ID**: TASK-002
- **目的**: 補助手段として Google Picker を複数回開閉した際の古い `<iframe>`・RPC 残留および競合を防ぐため、`picker.dispose()` によるインスタンス破棄処理を導入する。
- **入力**:
  - [js/picker.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/picker.js)
  - Section 3.2 の仕様
- **期待される結果**:
  - `activePicker` 変数がクロージャ内に保持され、安全ガード付き `disposeActivePicker()` が実装されている。
  - 新規起動前、`Action.PICKED` 時、`Action.CANCEL` 時、および `catch` 節で `disposeActivePicker()` が呼ばれる。
  - `dispose` メソッドを持たないテストモックに対してもエラーを発生させない。
- **対象ファイル**: `js/picker.js`
- **依存関係**: なし
- **受け入れ基準**:
  - 既存の `openFolderPicker` シグネチャおよび `onFallbackToManual` フォールバック条件が維持されていること。
  - `tests/run_tests.js` セクション 7 の既存テストが引き続きすべて合格すること。
- **検証方法**: `node tests/run_tests.js` 実行（セクション 7 合格確認）および TASK-006 の `dispose` 検証テスト。

---

### タスク [TASK-003]: 統合フォルダ選択モーダル UI 構築（PC・モバイルレスポンシブ対応）
- **ID**: TASK-003
- **目的**: 既存の `#manualFolderModal` を「アプリ内 Drive フォルダブラウザ ＋ ID/URL 直接入力 ＋ Google Picker 補助起動ボタン」を統合したモーダルへ拡張し、モバイル（幅 320px〜390px）でも破綻しない UI を構築する。
- **入力**:
  - [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html)（現行 `#manualFolderModal`, `#settingsModal`）
  - Section 3.3 の DOM ID 契約・レイアウト仕様
  - ゲート1 ユーザー承認事項（「Google Picker で開く」ボタンの邪魔にならないレスポンシブ配置）
- **期待される結果**:
  - `#manualFolderModal` が `max-h-[90vh] flex flex-col` 構造となり、フォルダ一覧エリア（`#folderBrowserList`）のみが `flex-1 min-h-0 overflow-y-auto touch-scroll` で内部スクロールする。
  - タブ切替（`#folderModalTabBrowser`, `#folderModalTabManual`）、空間切替 3 ボタン、検索欄、パンくず（`overflow-x-auto`）、一覧、さらに読み込むボタンが定義されている。
  - フッターはモバイルで主要操作（「このフォルダを選択」/「フォルダを適用」/「キャンセル」）と補助導線（「Google Picker で開く」テキストリンク風ボタン）が縦に分離され、狭い幅でも折り返し崩れ・はみ出し・誤タップが起きない。
  - 既存の ID（`#manualFolderModal`, `#closeModalBtn`, `#cancelModalBtn`, `#folderIdInput`, `#submitFolderBtn`）および `<script>` 読み込み順序、`iframe sandbox` 属性がすべて維持されている。
  - 設定モーダルの `apiKey` 補足説明文（374行目付近）も、アプリ内フォルダブラウザ利用可能である実態に合わせて違和感のない文言へ調整されている。
- **対象ファイル**: `index.html`
- **依存関係**: なし（ただし ID 名は TASK-004/005 と厳密一致させること）
- **受け入れ基準**:
  - Section 3.3(2) に列挙した全 ID が `index.html` に一意に存在すること。
  - `tests/run_tests.js` セクション 1 の静的チェックが全件合格すること。
- **検証方法**: `node tests/run_tests.js` 実行（セクション 1 全件合格）およびブラウザ開発者ツールでの幅 320px / 375px / 1280px 表示確認。

---

### タスク [TASK-004]: `DomUiAdapter` 統合フォルダ選択モーダル操作・描画メソッド実装
- **ID**: TASK-004
- **目的**: [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html) に追加した統合フォルダ選択モーダルの各要素を操作・描画するためのメソッドを `createDomUiAdapter` に実装し、XSS 防御と既存 `UiAdapter` 後方互換性を両立する。
- **入力**:
  - [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js)（`createDomUiAdapter`, `escapeHtml`）
  - TASK-003 で定義した DOM ID 一覧
  - Section 3.3(3) のメソッド仕様
- **期待される結果**:
  - `openFolderSelectorModal`, `closeFolderSelectorModal`, `switchFolderModalTab`, `setPickerTriggerVisible`, `renderFolderBrowserState` が `createDomUiAdapter` から公開されている。
  - フォルダ名・共有ドライブ名・パンくず名・エラーメッセージの描画にすべて `escapeHtml`（または `textContent`）が適用されている。
  - 既存の `openManualFolderModal(initialValue)` は統合モーダルを `'manual'` タブで開く形に、`closeManualFolderModal()` は統合モーダルを閉じる形に保たれ、既存インターフェースとの互換性が維持されている。
  - 参照するすべての `doc.getElementById('...')` が [index.html](file:///c:/Users/nanko/Downloads/HttpViewer-app/index.html) に実在している。
- **対象ファイル**: `js/app.js`
- **依存関係**: TASK-003
- **受け入れ基準**:
  - `tests/run_tests.js` の DOM ID 整合性チェックが合格すること。
  - フォルダ一覧行において「行タイトル領域クリック（`data-action="open"`）」と「選択ボタンクリック（`data-action="select"`）」がイベント委譲または要素別リスナーで安全に識別可能であること。
- **検証方法**: `node tests/run_tests.js` 実行（セクション 1 合格）および XSS エスケープ確認テスト。

---

### タスク [TASK-005]: `AppStateController` 統合フォルダ選択制御・レース防止・DOM イベント結線
- **ID**: TASK-005
- **目的**: `AppStateController` にフォルダブラウザの状態管理・非同期取得制御・`401` 自動復帰・`openFolderSelection()` 改修・Picker 補助連携・イベントバインドを組み込む。
- **入力**:
  - [js/app.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/js/app.js)（`createAppController`, `mountBrowserApp`）
  - TASK-001 (`DriveApiClient`), TASK-002 (`PickerService`), TASK-004 (`DomUiAdapter`)
  - Section 3.4 の状態モデル・メソッド仕様および Section 1.2(2) の整合性ルール
- **期待される結果**:
  - `openFolderSelection()` は認証確認後、`typeof ui.openFolderSelectorModal === 'function'` ならば統合モーダルを開いて `MY_DRIVE` (`'root'`) を取得し、未定義（テストモック UI 等）の場合は既存の `ui.openManualFolderModal(currentFolderId)` にフォールバックする。
  - `folderBrowseRequestId` により連続クリック・空間切替・検索連続入力時の古い非同期レスポンスが確実に破棄される。
  - ブラウズ中または事前トークン切れで `UNAUTHORIZED` となった場合、モーダルを閉じて `routeUnauthorizedOrAbort({ type: 'openFolderSelection' })` を呼び、再認証後に統合モーダルが自動再開する。
  - `clearWorkingViewState()`（サインアウト / `clientId` 変更）時にもモーダル閉鎖とリクエスト無効化が行われる。
  - `mountBrowserApp()` で全ボタン・入力・パンくず・フォルダ行クリックおよび `gapiScript` ロード後の Picker ボタン表示更新がバインドされている（検索入力にはデバウンスを適用し、モーダル閉鎖時はデバウンスタイマーをクリアする）。
- **対象ファイル**: `js/app.js`
- **依存関係**: TASK-001, TASK-002, TASK-004
- **受け入れ基準**:
  - 既存の全結合テスト・敵対的テスト（`tests/run_tests.js` 31件 + `tests/adversarial_tests.js` 16件）がリグレッションゼロで全件合格すること。
  - フォルダ確定まで `currentFolderId` / `activeFileId` / `LAST_FOLDER_ID` が変更されないこと。
- **検証方法**: `node tests/run_tests.js` および `node tests/adversarial_tests.js` の全件実行。

---

### タスク [TASK-006]: 単体・結合・敵対的テストの拡充と総合検証
- **ID**: TASK-006
- **目的**: 新規追加したフォルダブラウズ API・Picker `dispose`・統合フォルダ選択フロー・XSS/インジェクション/競合/`401` 復帰のすべてを自動テストとして恒久化し、全テストスイートの合格を確認する。
- **入力**:
  - [tests/run_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/run_tests.js)
  - [tests/adversarial_tests.js](file:///c:/Users/nanko/Downloads/HttpViewer-app/tests/adversarial_tests.js)
  - Section 4 のテスト戦略
- **期待される結果**:
  - `tests/run_tests.js` に `listSubfolders` / `listSharedDrives` / `searchFolders` の単体テスト、`PickerService.dispose()` 検証テスト、`AppStateController` 統合フォルダ選択（マイドライブ・共有ドライブ・検索・ページング・`401` 復帰・Picker 補助・手動入力切替）の結合テストが追加されている。
  - `tests/adversarial_tests.js` にフォルダ名/共有ドライブ名 XSS 防御、クエリインジェクション/不正 ID 拒否、ブラウズ連続操作レースコンディション、`401`/`429`/`500` 時の既存 `LAST_FOLDER_ID` 保全テストが追加されている。
  - 両テストファイルが終了コード `0` で全件合格する。
- **対象ファイル**: `tests/run_tests.js`, `tests/adversarial_tests.js`
- **依存関係**: TASK-001 〜 TASK-005
- **受け入れ基準**:
  - `node tests/run_tests.js` 全件合格（0 失敗）。
  - `node tests/adversarial_tests.js` 全件合格（0 失敗）。
  - モックを排したブラウザ実機/ローカルサーバー確認観点（3PC ブロック・シークレットモード・幅 320px/375px モバイル表示）がチェックリストとして実施可能な状態になっていること。
- **検証方法**:
  - `node tests/run_tests.js`
  - `node tests/adversarial_tests.js`
