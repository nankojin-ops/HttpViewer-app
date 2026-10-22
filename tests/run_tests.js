/**
 * 単体・結合テストスイート
 * TASK-001 〜 TASK-005 の実装内容および受け入れ基準を網羅的に検証
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passCount = 0;
let failCount = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${err.message}`);
    failCount++;
  }
}

function describe(suiteName, fn) {
  console.log(`\n=== ${suiteName} ===`);
  fn();
}

// ----------------------------------------------------
// 1. 構文チェック (Syntax Verification)
// ----------------------------------------------------
describe('1. 構文チェック (Syntax Verification)', () => {
  it('コード.js が構文エラーなく解析できること', () => {
    const codeJs = fs.readFileSync(path.join(__dirname, '../コード.js'), 'utf8');
    assert.doesNotThrow(() => {
      new vm.Script(codeJs, { filename: 'コード.js' });
    });
  });

  it('index.html 内のJavaScriptが構文エラーなく解析できること', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    // <script>タグ内のJSを抽出（サーバーサイドテンプレートタグ <?= ... ?> をモック値に置換）
    const scriptMatches = indexHtml.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi);
    assert.ok(scriptMatches && scriptMatches.length > 0, 'スクリプトタグが存在すること');

    scriptMatches.forEach((scriptTag, idx) => {
      let scriptContent = scriptTag.replace(/<script[\s\S]*?>/i, '').replace(/<\/script>/i, '');
      // テンプレート記法をテスト用ダミー値に置換
      scriptContent = scriptContent.replace(/<\?=[\s\S]*?\?>/g, 'mock_template_val');
      assert.doesNotThrow(() => {
        new vm.Script(scriptContent, { filename: `index.html script[${idx}]` });
      }, `index.html script[${idx}] has syntax error`);
    });
  });

  it('パイプ記号が正しく半角記号（| または ||）として記述されていること', () => {
    const codeJs = fs.readFileSync(path.join(__dirname, '../コード.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    assert.strictEqual(codeJs.includes('\\vert'), false, 'コード.js に LaTeX の \\vert が含まれていないこと');
    assert.strictEqual(codeJs.includes('\\mid'), false, 'コード.js に LaTeX の \\mid が含まれていないこと');
    assert.strictEqual(indexHtml.includes('\\vert'), false, 'index.html に LaTeX の \\vert が含まれていないこと');
    assert.strictEqual(indexHtml.includes('\\mid'), false, 'index.html に LaTeX の \\mid が含まれていないこと');
  });

  it('未実装を示すプレースホルダー（TODO等）が存在しないこと', () => {
    const codeJs = fs.readFileSync(path.join(__dirname, '../コード.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    assert.strictEqual(/\/\/\s*TODO/i.test(codeJs), false, 'コード.js に TODO が含まれていないこと');
    assert.strictEqual(/\/\/\s*TODO/i.test(indexHtml), false, 'index.html に TODO が含まれていないこと');
    assert.strictEqual(/\/\/\s*省略/i.test(codeJs), false, 'コード.js に 省略 が含まれていないこと');
    assert.strictEqual(/\/\/\s*省略/i.test(indexHtml), false, 'index.html に 省略 が含まれていないこと');
  });
});

// ----------------------------------------------------
// 2. サーバーサイド単体テスト (コード.js)
// ----------------------------------------------------
// GAS環境のモックコンテキストを構築
const createGasContext = () => {
  const userPropertiesStore = new Map();
  const scriptPropertiesStore = new Map();

  const mockUserProps = {
    getProperty: (key) => userPropertiesStore.get(key) || null,
    setProperty: (key, val) => userPropertiesStore.set(key, String(val)),
    deleteProperty: (key) => userPropertiesStore.delete(key),
    getProperties: () => Object.fromEntries(userPropertiesStore)
  };

  const mockScriptProps = {
    getProperty: (key) => scriptPropertiesStore.get(key) || null,
    setProperty: (key, val) => scriptPropertiesStore.set(key, String(val)),
    deleteProperty: (key) => scriptPropertiesStore.delete(key),
    getProperties: () => Object.fromEntries(scriptPropertiesStore)
  };

  const evaluatedTemplates = [];

  const mockHtmlService = {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createTemplateFromFile: (fileName) => {
      const tpl = {
        fileName: fileName,
        urlFolderId: '',
        evaluate: function() {
          evaluatedTemplates.push({ ...this });
          return {
            setTitle: function() { return this; },
            addMetaTag: function() { return this; },
            setXFrameOptionsMode: function() { return this; }
          };
        }
      };
      return tpl;
    }
  };

  const mockScriptApp = {
    getOAuthToken: () => 'mock-oauth-token-12345'
  };

  const context = {
    PropertiesService: {
      getUserProperties: () => mockUserProps,
      getScriptProperties: () => mockScriptProps
    },
    HtmlService: mockHtmlService,
    ScriptApp: mockScriptApp,
    DriveApp: {},
    console: console,
    _userPropertiesStore: userPropertiesStore,
    _scriptPropertiesStore: scriptPropertiesStore,
    _evaluatedTemplates: evaluatedTemplates
  };

  const codeJs = fs.readFileSync(path.join(__dirname, '../コード.js'), 'utf8');
  vm.createContext(context);
  vm.runInContext(codeJs, context);

  return context;
};

describe('2. サーバーサイド単体テスト (コード.js)', () => {

  it('sanitizeFolderId_: 通常の英数字ID、Drive URLを正しく抽出・検証できること', () => {
    const ctx = createGasContext();
    assert.strictEqual(ctx.sanitizeFolderId_('1234567890abcdef_XYZ-abc'), '1234567890abcdef_XYZ-abc');
    assert.strictEqual(
      ctx.sanitizeFolderId_('https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7?usp=sharing'),
      '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7'
    );
    assert.throws(() => ctx.sanitizeFolderId_(''), /フォルダIDが指定されていません/);
    assert.throws(() => ctx.sanitizeFolderId_('invalid id with spaces!@#'), /無効なフォルダID形式です/);
  });

  it('TASK-001: saveLastFolderId で正常なIDが UserProperties に保存され、戻り値が正しいこと', () => {
    const ctx = createGasContext();
    const res = ctx.saveLastFolderId('1234567890abcdef_XYZ');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.savedFolderId, '1234567890abcdef_XYZ');
    assert.strictEqual(ctx._userPropertiesStore.get('LAST_FOLDER_ID'), '1234567890abcdef_XYZ');
  });

  it('TASK-001: saveLastFolderId で無効なIDを渡した場合に例外を捕捉し success: false を返すこと', () => {
    const ctx = createGasContext();
    const res = ctx.saveLastFolderId('invalid*folder*id');
    assert.strictEqual(res.success, false);
    assert.ok(res.error && res.error.includes('無効なフォルダID形式'));
  });

  it('TASK-001: clearLastFolderId で UserProperties から LAST_FOLDER_ID が削除されること', () => {
    const ctx = createGasContext();
    ctx.saveLastFolderId('folder_to_delete');
    assert.strictEqual(ctx._userPropertiesStore.get('LAST_FOLDER_ID'), 'folder_to_delete');

    const res = ctx.clearLastFolderId();
    assert.strictEqual(res.success, true);
    assert.strictEqual(ctx._userPropertiesStore.has('LAST_FOLDER_ID'), false);
  });

  it('TASK-001: saveLastFolderId で Google Drive URL形式からIDが抽出されて保存されること', () => {
    const ctx = createGasContext();
    const res = ctx.saveLastFolderId('https://drive.google.com/drive/folders/1abcDEF-ghi_12345?usp=sharing');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.savedFolderId, '1abcDEF-ghi_12345');
    assert.strictEqual(ctx._userPropertiesStore.get('LAST_FOLDER_ID'), '1abcDEF-ghi_12345');
  });

  it('TASK-001: getAppConfig で lastFolderId を含む統合設定オブジェクトが返却されること', () => {
    const ctx = createGasContext();
    ctx._scriptPropertiesStore.set('PICKER_API_KEY', 'api-key-test');
    ctx._scriptPropertiesStore.set('PROJECT_NUMBER', '987654321');
    ctx._scriptPropertiesStore.set('FOLDER_ID', 'default-folder-123');
    ctx.saveLastFolderId('user-saved-folder-456');

    const config = ctx.getAppConfig();
    assert.strictEqual(config.token, 'mock-oauth-token-12345');
    assert.strictEqual(config.apiKey, 'api-key-test');
    assert.strictEqual(config.projectNumber, '987654321');
    assert.strictEqual(config.defaultFolderId, 'default-folder-123');
    assert.strictEqual(config.lastFolderId, 'user-saved-folder-456');
  });

  it('TASK-001: getAppConfig で UserProperties 未設定時は lastFolderId が空文字となること', () => {
    const ctx = createGasContext();
    const config = ctx.getAppConfig();
    assert.strictEqual(config.lastFolderId, '');
  });

  it('TASK-002: doGet(e) で folderId パラメータがテンプレートに渡されること', () => {
    const ctx = createGasContext();
    ctx.doGet({ parameter: { folderId: 'folder_from_query_123' } });
    assert.strictEqual(ctx._evaluatedTemplates.length, 1);
    assert.strictEqual(ctx._evaluatedTemplates[0].urlFolderId, 'folder_from_query_123');
  });

  it('TASK-002: doGet(e) で 短縮形 f パラメータがテンプレートに渡されること', () => {
    const ctx = createGasContext();
    ctx.doGet({ parameter: { f: 'folder_from_f_param' } });
    assert.strictEqual(ctx._evaluatedTemplates.length, 1);
    assert.strictEqual(ctx._evaluatedTemplates[0].urlFolderId, 'folder_from_f_param');
  });

  it('TASK-002: doGet(e) で パラメータ未指定または e が空でも安全に動作すること', () => {
    const ctx = createGasContext();
    ctx.doGet();
    ctx.doGet({});
    ctx.doGet({ parameter: {} });
    assert.strictEqual(ctx._evaluatedTemplates.length, 3);
    assert.strictEqual(ctx._evaluatedTemplates[0].urlFolderId, '');
    assert.strictEqual(ctx._evaluatedTemplates[1].urlFolderId, '');
    assert.strictEqual(ctx._evaluatedTemplates[2].urlFolderId, '');
  });
});

// ----------------------------------------------------
// 3. クライアントサイド単体テスト (SafeStorage & resolveInitialFolderId)
// ----------------------------------------------------
describe('3. クライアントサイド単体テスト (SafeStorage & resolveInitialFolderId)', () => {
  // index.html の関数群をテスト用コンテキストに抽出
  function extractBlock(source, startPattern) {
    const startIdx = source.search(startPattern);
    if (startIdx === -1) return null;
    const openBraceIdx = source.indexOf('{', startIdx);
    if (openBraceIdx === -1) return null;
    let depth = 1;
    let i = openBraceIdx + 1;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    // const SafeStorage = { ... }; の場合は直後のセミコロンも含める
    while (i < source.length && (source[i] === ';' || source[i] === ' ' || source[i] === '\n' || source[i] === '\r')) {
      if (source[i] === ';') { i++; break; }
      i++;
    }
    return source.slice(startIdx, i);
  }

  const createClientContext = (options = {}) => {
    const localStoreMap = new Map();
    let throwOnLocalStorage = options.throwOnLocalStorage || false;

    const mockLocalStorage = {
      getItem: (key) => {
        if (throwOnLocalStorage) throw new Error('DOMException: SecurityError');
        return localStoreMap.has(key) ? localStoreMap.get(key) : null;
      },
      setItem: (key, val) => {
        if (throwOnLocalStorage) throw new Error('DOMException: SecurityError');
        localStoreMap.set(key, String(val));
      },
      removeItem: (key) => {
        if (throwOnLocalStorage) throw new Error('DOMException: SecurityError');
        localStoreMap.delete(key);
      }
    };

    const mockWindow = {
      localStorage: options.noLocalStorage ? undefined : mockLocalStorage,
      location: {
        search: options.locationSearch || ''
      }
    };

    const context = {
      window: mockWindow,
      URLSearchParams: global.URLSearchParams,
      console: {
        log: () => {},
        warn: () => {},
        error: () => {}
      },
      _localStoreMap: localStoreMap,
      setThrowOnLocalStorage: (v) => { throwOnLocalStorage = v; }
    };

    const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

    // SafeStorage, getClientUrlFolderId, resolveInitialFolderId の定義部分を波括弧カウントで抽出
    const safeStorageCode = extractBlock(indexHtml, /const\s+SafeStorage\s*=\s*\{/);
    const getClientUrlFolderIdCode = extractBlock(indexHtml, /function\s+getClientUrlFolderId\s*\(\)\s*\{/);
    const resolveInitialFolderIdCode = extractBlock(indexHtml, /function\s+resolveInitialFolderId\s*\(sources\)\s*\{/);

    assert.ok(safeStorageCode, 'SafeStorage 定義が存在すること');
    assert.ok(getClientUrlFolderIdCode, 'getClientUrlFolderId 定義が存在すること');
    assert.ok(resolveInitialFolderIdCode, 'resolveInitialFolderId 定義が存在すること');

    vm.createContext(context);
    vm.runInContext(safeStorageCode + '\nthis.SafeStorage = SafeStorage;', context);
    vm.runInContext(getClientUrlFolderIdCode + '\nthis.getClientUrlFolderId = getClientUrlFolderId;', context);
    vm.runInContext(resolveInitialFolderIdCode + '\nthis.resolveInitialFolderId = resolveInitialFolderId;', context);

    return context;
  };

  it('TASK-003: SafeStorage 通常環境で get / set / remove が正常に動作すること', () => {
    const ctx = createClientContext();
    assert.strictEqual(ctx.SafeStorage.get('test_key'), null);

    const setRes = ctx.SafeStorage.set('test_key', 'my_value');
    assert.strictEqual(setRes, true);
    assert.strictEqual(ctx.SafeStorage.get('test_key'), 'my_value');

    const removeRes = ctx.SafeStorage.remove('test_key');
    assert.strictEqual(removeRes, true);
    assert.strictEqual(ctx.SafeStorage.get('test_key'), null);
  });

  it('TASK-003: SafeStorage localStorage アクセス例外（SecurityError）発生時でも例外をスローせず安全に null/false を返すこと', () => {
    const ctx = createClientContext({ throwOnLocalStorage: true });
    // 例外がスローされずクラッシュしないこと
    let getResult, setResult, removeResult;
    assert.doesNotThrow(() => {
      getResult = ctx.SafeStorage.get('some_key');
      setResult = ctx.SafeStorage.set('some_key', 'val');
      removeResult = ctx.SafeStorage.remove('some_key');
    });

    assert.strictEqual(getResult, null);
    assert.strictEqual(setResult, false);
    assert.strictEqual(removeResult, false);
  });

  it('TASK-003: SafeStorage window.localStorage が undefined の環境でも安全に null/false を返すこと', () => {
    const ctx = createClientContext({ noLocalStorage: true });
    assert.strictEqual(ctx.SafeStorage.get('any_key'), null);
    assert.strictEqual(ctx.SafeStorage.set('any_key', 'val'), false);
    assert.strictEqual(ctx.SafeStorage.remove('any_key'), false);
  });

  it('TASK-004: getClientUrlFolderId で URLパラメータ（folderId, f）が抽出できること', () => {
    const ctx1 = createClientContext({ locationSearch: '?folderId=url_fid_111' });
    assert.strictEqual(ctx1.getClientUrlFolderId(), 'url_fid_111');

    const ctx2 = createClientContext({ locationSearch: '?f=url_fid_222' });
    assert.strictEqual(ctx2.getClientUrlFolderId(), 'url_fid_222');

    const ctx3 = createClientContext({ locationSearch: '' });
    assert.strictEqual(ctx3.getClientUrlFolderId(), '');
  });

  it('TASK-004: resolveInitialFolderId 優先順位カスケード（URL > UserProperties > localStorage > Default > NONE）の検証', () => {
    const ctx = createClientContext();

    // パターン1: 全て存在 -> URL が最優先
    const res1 = ctx.resolveInitialFolderId({
      urlParam: 'id_url',
      userProp: 'id_user',
      localStore: 'id_local',
      defaultProp: 'id_default'
    });
    assert.strictEqual(res1.folderId, 'id_url');
    assert.strictEqual(res1.source, 'URL');

    // パターン2: URLなし -> UserProperties が次点
    const res2 = ctx.resolveInitialFolderId({
      urlParam: '',
      userProp: 'id_user',
      localStore: 'id_local',
      defaultProp: 'id_default'
    });
    assert.strictEqual(res2.folderId, 'id_user');
    assert.strictEqual(res2.source, 'USER_PROPERTIES');

    // パターン3: URLなし、UserPropなし -> localStorage が次点
    const res3 = ctx.resolveInitialFolderId({
      urlParam: '   ',
      userProp: '',
      localStore: 'id_local',
      defaultProp: 'id_default'
    });
    assert.strictEqual(res3.folderId, 'id_local');
    assert.strictEqual(res3.source, 'LOCAL_STORAGE');

    // パターン4: URL/UserProp/localStoreなし -> defaultProp が次点
    const res4 = ctx.resolveInitialFolderId({
      urlParam: '',
      userProp: null,
      localStore: null,
      defaultProp: 'id_default'
    });
    assert.strictEqual(res4.folderId, 'id_default');
    assert.strictEqual(res4.source, 'DEFAULT');

    // パターン5: 全て空 -> NONE
    const res5 = ctx.resolveInitialFolderId({
      urlParam: '',
      userProp: '',
      localStore: '',
      defaultProp: ''
    });
    assert.strictEqual(res5.folderId, '');
    assert.strictEqual(res5.source, 'NONE');
  });
});

// ----------------------------------------------------
// 4. 結合シナリオ・自己修復テスト (Integration & Self-Healing)
// ----------------------------------------------------
describe('4. 結合シナリオ・自己修復テスト (Integration & Self-Healing)', () => {
  it('TASK-005: フォルダ選択時の非ブロッキング永続化（SafeStorage + サーバー保存）の整合性', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

    // applyFolder 内で SafeStorage.set と google.script.run.saveLastFolderId の両方が呼ばれていることを確認
    assert.ok(
      indexHtml.includes('SafeStorage.set(STORAGE_KEY_FOLDER_ID, folderId)'),
      'applyFolder 内で SafeStorage.set が実行されること'
    );
    assert.ok(
      indexHtml.includes('saveLastFolderId(folderId)'),
      'applyFolder 内で saveLastFolderId が非同期実行されること'
    );
  });

  it('TASK-005: フォルダアクセス失敗時の自己修復（SafeStorage.remove + clearLastFolderId）とガード制御の整合性', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

    // handleFolderLoadError 内で消去処理が実装されていること
    assert.ok(
      indexHtml.includes('SafeStorage.remove(STORAGE_KEY_FOLDER_ID)'),
      'handleFolderLoadError 内で SafeStorage.remove が実行されること'
    );
    assert.ok(
      indexHtml.includes('clearLastFolderId()'),
      'handleFolderLoadError 内で clearLastFolderId が実行されること'
    );

    // 二重フォールバック防止ガード（hasAttemptedFallback）が存在すること
    assert.ok(
      indexHtml.includes('hasAttemptedFallback'),
      '無限ループ防止のための hasAttemptedFallback ガードが実装されていること'
    );
  });
});

// ----------------------------------------------------
// 5. リグレッション検証 (Existing Functionality Integrity)
// ----------------------------------------------------
describe('5. リグレッション検証 (Existing Functionality Integrity)', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

  it('Google Picker 関連のコードおよびコールバックが保持されていること', () => {
    assert.ok(indexHtml.includes('google.picker.PickerBuilder'), 'PickerBuilder が保持されていること');
    assert.ok(indexHtml.includes('google.picker.Action.PICKED'), 'PICKED アクション処理が保持されていること');
    assert.ok(indexHtml.includes('applyFolder(folderId, folderName)'), 'Picker選択時の applyFolder 呼び出しが保持されていること');
  });

  it('手動モーダル機能が保持されていること', () => {
    assert.ok(indexHtml.includes('openManualFolderModal'), 'openManualFolderModal が保持されていること');
    assert.ok(indexHtml.includes('submitManualFolder'), 'submitManualFolder が保持されていること');
    assert.ok(indexHtml.includes('getFolderDetails'), 'getFolderDetails 呼び出しが保持されていること');
  });

  it('インクリメンタル検索およびクリア機能が保持されていること', () => {
    assert.ok(indexHtml.includes('searchDebounceTimer'), 'デバウンスタイマーが保持されていること');
    assert.ok(indexHtml.includes('clearSearchBtn'), 'クリアボタン処理が保持されていること');
    assert.ok(indexHtml.includes('executeSearch'), 'executeSearch が保持されていること');
  });

  it('プレビュー機能および再読込ボタンが保持されていること', () => {
    assert.ok(indexHtml.includes('previewFrame.srcdoc'), 'iframe srcdoc 設定が保持されていること');
    assert.ok(indexHtml.includes('reloadPreviewBtn'), 'プレビュー再読込リスナーが保持されていること');
    assert.ok(indexHtml.includes('getHtmlFileContent'), 'getHtmlFileContent 呼び出しが保持されていること');
  });

  it('レスポンシブ切り替えおよびモバイル一覧復帰が保持されていること', () => {
    assert.ok(indexHtml.includes('switchMobileView'), 'switchMobileView が保持されていること');
    assert.ok(indexHtml.includes('backToListBtn'), 'backToListBtn リスナーが保持されていること');
  });
});

// ----------------------------------------------------
// 6. QA検出バグ（BUG-001〜BUG-005）再発防止テスト
// ----------------------------------------------------
describe('6. QA検出バグ（BUG-001〜BUG-005）再発防止テスト', () => {
  const codeJs = fs.readFileSync(path.join(__dirname, '../コード.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

  it('BUG-001: executeSearch で無効なフォルダID形式エラー時も自己修復が発動すること', () => {
    assert.ok(
      indexHtml.includes("response.error.includes('無効なフォルダID形式')") ||
      indexHtml.includes("response.error.includes('フォルダID形式が無効')"),
      '無効なID形式エラーメッセージが自己修復の判定条件に含まれていること'
    );
  });

  it('BUG-002: 一時的な通信障害時（withFailureHandler）に有効なフォルダ情報が誤消去されないこと', () => {
    assert.strictEqual(
      indexHtml.includes('.withFailureHandler(function(err) {\n              handleFolderLoadError('),
      false,
      '通信障害時に handleFolderLoadError が呼ばれていないこと'
    );
  });

  it('BUG-003: doGet(e) で不正なクエリパラメータ（改行・記号等）が安全に空文字にサニタイズされること', () => {
    const ctx = createGasContext();
    ctx.doGet({ parameter: { folderId: "invalid\n<script>alert(1)</script>" } });
    assert.strictEqual(ctx._evaluatedTemplates[0].urlFolderId, '', '不正文字が除去されて空文字になること');
  });

  it('BUG-004: sanitizeFolderId_ が open?id= 形式の Google Drive URL を受付可能なこと', () => {
    const ctx = createGasContext();
    const res = ctx.sanitizeFolderId_('https://drive.google.com/open?id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7');
    assert.strictEqual(res, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7');
  });

  it('BUG-005: applyFolder で saveLastFolderIdRequestId によるリクエストシーケンス排他制御が実装されていること', () => {
    assert.ok(
      indexHtml.includes('saveLastFolderIdRequestId'),
      'saveLastFolderIdRequestId による並行保存シーケンス管理が実装されていること'
    );
    assert.ok(
      indexHtml.includes('if (currentSaveId !== saveLastFolderIdRequestId)'),
      '古いリクエストのレスポンス破棄判定が存在すること'
    );
  });
});

// ----------------------------------------------------
// 結果集計
// ----------------------------------------------------
console.log('\n========================================');
console.log(`テスト結果: 全 ${passCount + failCount} 件中 ${passCount} 件合格, ${failCount} 件失敗`);
console.log('========================================');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
