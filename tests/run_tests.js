/**
 * 単体・結合テストスイート（GitHub Pages / Drive API v3 / GIS 構成）
 * TASK-001 〜 TASK-007 および BUG-GP-001 〜 BUG-GP-010 リグレッション検証を含む
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..');

let passCount = 0;
let failCount = 0;
const testQueue = [];

function describe(suiteName, fn) {
  testQueue.push({ type: 'suite', name: suiteName });
  fn();
}

function it(desc, fn) {
  testQueue.push({ type: 'test', desc, fn });
}

/**
 * テスト用インメモリ localStorage モックを生成する
 */
function createMockStorage(options = {}) {
  const map = new Map();
  let throwError = Boolean(options.throwError);
  let throwOnRemove = Boolean(options.throwOnRemove);
  return {
    _map: map,
    setThrowError: (v) => { throwError = Boolean(v); },
    setThrowOnRemove: (v) => { throwOnRemove = Boolean(v); },
    get: (key) => {
      if (throwError) return null;
      return map.has(key) ? map.get(key) : null;
    },
    set: (key, val) => {
      if (throwError) return false;
      map.set(key, String(val));
      return true;
    },
    remove: (key) => {
      if (throwError || throwOnRemove) return false;
      map.delete(key);
      return true;
    },
    getItem: (key) => {
      if (throwError) throw new Error('DOMException: SecurityError');
      return map.has(key) ? map.get(key) : null;
    },
    setItem: (key, val) => {
      if (throwError) throw new Error('DOMException: SecurityError');
      map.set(key, String(val));
    },
    removeItem: (key) => {
      if (throwError || throwOnRemove) throw new Error('DOMException: SecurityError');
      map.delete(key);
    }
  };
}

function createMockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

function createTrackingMockUi(logs) {
  return {
    showErrorToast: (t, m) => logs.toasts.push({ type: 'error', t, m }),
    showSuccessToast: (t, m) => logs.toasts.push({ type: 'success', t, m }),
    showInfoToast: (t, m) => logs.toasts.push({ type: 'info', t, m }),
    hideToast: () => {},
    setStatus: (t) => logs.statuses.push(t),
    switchMobileView: (v) => { logs.mobileViews.push(v); },
    getCurrentMobileView: () => 'list',
    renderFileList: (files, _activeId, _cb, emptyCountText) => {
      logs.renderedFiles = files;
      logs.fileCountHistory.push(
        (!files || files.length === 0) ? (emptyCountText || '0 件のファイル') : (files.length + ' 件のファイル')
      );
    },
    highlightActiveFile: (id) => { logs.highlightedFileIds.push(id); },
    setFolderName: (n) => { logs.folderName = n; },
    setFileCountText: (t) => {
      logs.fileCountText = t;
      logs.fileCountHistory.push(t);
    },
    getSearchQuery: () => '',
    clearSearchInput: () => { logs.searchCleared++; },
    showPreviewLoading: (name) => {
      logs.previewLoadingCount++;
      logs.previewTitles.push(name);
      logs.previewActionsVisible = true;
      logs.emptyStateVisible = false;
    },
    hidePreviewLoading: () => { logs.previewLoadingCount = Math.max(0, logs.previewLoadingCount - 1); },
    restorePreviewHeader: (name) => {
      logs.previewTitles.push(name);
      logs.previewActionsVisible = true;
      logs.emptyStateVisible = false;
    },
    setPreviewContent: (c) => {
      logs.previewHtml = c;
      logs.previewUpdates.push(c);
    },
    resetPreview: () => {
      logs.previewHtml = '';
      logs.previewTitles.push('ファイルが選択されていません');
      logs.previewActionsVisible = false;
      logs.emptyStateVisible = true;
      logs.previewResetCount++;
    },
    clearListArea: () => { logs.renderedFiles = []; },
    renderAuthState: (st) => logs.authStates.push(st.status),
    openManualFolderModal: () => { logs.manualModalOpened++; },
    closeManualFolderModal: () => { logs.manualModalClosed++; },
    getManualFolderInput: () => '',
    openSettingsModal: (cfg) => { logs.settingsModalOpened++; logs.lastSettingsModalCfg = cfg; },
    closeSettingsModal: () => { logs.settingsModalClosed++; },
    showSettingsError: (msg) => { logs.settingsErrors.push(msg); },
    getSettingsFormValues: () => ({ clientId: '', apiKey: '', appId: '', defaultFolderId: '' })
  };
}

function createFreshLogs() {
  return {
    toasts: [],
    statuses: [],
    mobileViews: [],
    authStates: [],
    renderedFiles: null,
    fileCountText: '',
    fileCountHistory: [],
    highlightedFileIds: [],
    previewTitles: [],
    previewUpdates: [],
    previewHtml: '',
    previewLoadingCount: 0,
    previewResetCount: 0,
    previewActionsVisible: false,
    emptyStateVisible: true,
    searchCleared: 0,
    manualModalOpened: 0,
    manualModalClosed: 0,
    settingsModalOpened: 0,
    settingsModalClosed: 0,
    settingsErrors: [],
    lastSettingsModalCfg: null
  };
}

// ====================================================
// 1. 構文・静的資産・DOM ID 整合性・GAS廃止チェック
// ====================================================
describe('1. 構文・静的資産・DOM整合性・GAS廃止チェック', () => {
  const jsFiles = [
    'config.js',
    'js/storage.js',
    'js/folder-resolver.js',
    'js/config.js',
    'js/auth.js',
    'js/drive-api.js',
    'js/picker.js',
    'js/app.js'
  ];

  it('旧 GAS 関連ファイルおよび重複ファイルが削除されていること', () => {
    const legacyFiles = ['コード.js', 'appsscript.json', '.clasp.json', '.claspignore', 'gitignore.txt'];
    legacyFiles.forEach((file) => {
      assert.strictEqual(
        fs.existsSync(path.join(ROOT_DIR, file)),
        false,
        `${file} が削除されていること`
      );
    });
  });

  it('.nojekyll および config.js がルートに存在し、初期設定が空であること', () => {
    assert.strictEqual(fs.existsSync(path.join(ROOT_DIR, '.nojekyll')), true, '.nojekyll が存在すること');
    const defaultConfig = require(path.join(ROOT_DIR, 'config.js'));
    assert.deepStrictEqual(defaultConfig, {
      clientId: '',
      apiKey: '',
      appId: '',
      defaultFolderId: ''
    });
  });

  it('全 JS ファイルに構文エラー、LaTeX パイプ誤記、TODO/省略が存在しないこと', () => {
    jsFiles.forEach((relPath) => {
      const fullPath = path.join(ROOT_DIR, relPath);
      assert.strictEqual(fs.existsSync(fullPath), true, `${relPath} が存在すること`);
      const content = fs.readFileSync(fullPath, 'utf8');
      assert.doesNotThrow(() => new vm.Script(content, { filename: relPath }), `${relPath} に構文エラーがないこと`);
      assert.strictEqual(content.includes('\\vert'), false, `${relPath} に \\vert が含まれないこと`);
      assert.strictEqual(content.includes('\\mid'), false, `${relPath} に \\mid が含まれないこと`);
      assert.strictEqual(/\/\/\s*TODO/i.test(content), false, `${relPath} に TODO が含まれないこと`);
      assert.strictEqual(/\/\/\s*省略/i.test(content), false, `${relPath} に 省略 が含まれないこと`);
      assert.strictEqual(content.includes('google.script'), false, `${relPath} に google.script が含まれないこと`);
    });
  });

  it('index.html に GAS 遺物・LaTeX誤記がなく、スクリプト読み込み順序が正しいこと', () => {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    assert.strictEqual(html.includes('google.script'), false, 'google.script が残っていないこと');
    assert.strictEqual(html.includes('<?='), false, 'GAS テンプレートタグ <?= が残っていないこと');
    assert.strictEqual(html.includes('?>'), false, 'GAS テンプレートタグ ?> が残っていないこと');
    assert.strictEqual(html.includes('USER_PROPERTIES'), false, 'USER_PROPERTIES が残っていないこと');
    assert.strictEqual(html.includes('\\vert'), false, 'index.html に \\vert が含まれないこと');
    assert.strictEqual(html.includes('\\mid'), false, 'index.html に \\mid が含まれないこと');
    assert.strictEqual(html.includes('https://accounts.google.com/gsi/client'), true, 'GIS クライアントを読み込むこと');
    assert.strictEqual(html.includes('https://apis.google.com/js/api.js'), true, 'Google API Loader を読み込むこと');
    assert.strictEqual(html.includes('sandbox="allow-scripts allow-forms allow-same-origin"'), true, 'iframe sandbox を維持すること');

    const expectedScripts = [
      'src="config.js"',
      'src="js/storage.js"',
      'src="js/folder-resolver.js"',
      'src="js/config.js"',
      'src="js/auth.js"',
      'src="js/drive-api.js"',
      'src="js/picker.js"',
      'src="js/app.js"'
    ];
    let lastPos = -1;
    expectedScripts.forEach((tag) => {
      const pos = html.indexOf(tag);
      assert.ok(pos > lastPos, `${tag} が正しい順序で配置されていること`);
      lastPos = pos;
    });
  });

  it('DOM ID 整合性チェック: js/app.js が参照する全 getElementById が index.html に存在すること', () => {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    const appJs = fs.readFileSync(path.join(ROOT_DIR, 'js/app.js'), 'utf8');

    const htmlIds = new Set();
    const idRegex = /\bid=["']([^"']+)["']/g;
    let match;
    while ((match = idRegex.exec(html)) !== null) {
      htmlIds.add(match[1]);
    }

    const appRefIds = new Set();
    const getElRegex = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = getElRegex.exec(appJs)) !== null) {
      appRefIds.add(match[1]);
    }

    assert.ok(appRefIds.size >= 40, 'app.js 内の getElementById 参照数が十分抽出されていること');
    appRefIds.forEach((refId) => {
      assert.strictEqual(
        htmlIds.has(refId),
        true,
        `index.html に id="${refId}" が存在すること`
      );
    });

    const requiredUnifiedModalIds = [
      'manualFolderModal', 'closeModalBtn', 'cancelModalBtn', 'folderIdInput', 'submitFolderBtn',
      'folderModalTabBrowser', 'folderModalTabManual', 'folderBrowserPanel', 'folderManualPanel',
      'folderSpaceMyDriveBtn', 'folderSpaceSharedDrivesBtn', 'folderSpaceSharedWithMeBtn',
      'folderSearchInput', 'clearFolderSearchBtn', 'folderSearchSubmitBtn',
      'folderBreadcrumbs', 'folderBrowserList', 'folderLoadMoreWrap', 'folderLoadMoreBtn',
      'selectCurrentFolderBtn', 'openGooglePickerWrap', 'openGooglePickerBtn'
    ];
    requiredUnifiedModalIds.forEach((reqId) => {
      const occurrences = html.match(new RegExp(`\\bid=["']${reqId}["']`, 'g')) || [];
      assert.strictEqual(occurrences.length, 1, `index.html に id="${reqId}" が一意に1つ存在すること`);
    });
  });
});

// ====================================================
// 2. SafeStorage 単体テスト (js/storage.js)
// ====================================================
describe('2. SafeStorage 単体テスト (js/storage.js)', () => {
  const { STORAGE_KEYS, SafeStorage } = require(path.join(ROOT_DIR, 'js/storage.js'));

  it('STORAGE_KEYS 定数が仕様通りに定義されていること', () => {
    assert.strictEqual(STORAGE_KEYS.LAST_FOLDER_ID, 'html_viewer_last_folder_id');
    assert.strictEqual(STORAGE_KEYS.APP_CONFIG, 'html_viewer_app_config');
  });

  it('通常環境で get / set / remove が正常に動作すること', () => {
    const mockStorage = createMockStorage();
    const prevWindow = global.window;
    global.window = { localStorage: mockStorage };
    try {
      assert.strictEqual(SafeStorage.get('k1'), null);
      assert.strictEqual(SafeStorage.set('k1', 'v1'), true);
      assert.strictEqual(SafeStorage.get('k1'), 'v1');
      assert.strictEqual(SafeStorage.remove('k1'), true);
      assert.strictEqual(SafeStorage.get('k1'), null);
    } finally {
      global.window = prevWindow;
    }
  });

  it('SecurityError 例外スロー時・localStorage 未定義時でも安全に null / false を返すこと', () => {
    const prevWindow = global.window;
    const throwingStorage = createMockStorage({ throwError: true });
    global.window = { localStorage: throwingStorage };
    try {
      assert.strictEqual(SafeStorage.get('k1'), null);
      assert.strictEqual(SafeStorage.set('k1', 'v1'), false);
      assert.strictEqual(SafeStorage.remove('k1'), false);

      global.window = {};
      assert.strictEqual(SafeStorage.get('k1'), null);
      assert.strictEqual(SafeStorage.set('k1', 'v1'), false);
      assert.strictEqual(SafeStorage.remove('k1'), false);
    } finally {
      global.window = prevWindow;
    }
  });
});

// ====================================================
// 3. FolderResolver 単体テスト (js/folder-resolver.js)
// ====================================================
describe('3. FolderResolver 単体テスト (js/folder-resolver.js)', () => {
  const FolderResolver = require(path.join(ROOT_DIR, 'js/folder-resolver.js'));

  it('sanitizeFolderId: 通常ID・folders/URL・drive/u/0/folders/URL・open?id=URL を抽出できること', () => {
    assert.strictEqual(FolderResolver.sanitizeFolderId('  1234567890abcdef_XYZ-abc  '), '1234567890abcdef_XYZ-abc');
    assert.strictEqual(
      FolderResolver.sanitizeFolderId('https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7?usp=sharing'),
      '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7'
    );
    assert.strictEqual(
      FolderResolver.sanitizeFolderId('https://drive.google.com/drive/u/0/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7'),
      '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7'
    );
    assert.strictEqual(
      FolderResolver.sanitizeFolderId('https://drive.google.com/open?id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7'),
      '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7'
    );
  });

  it('sanitizeFolderId: 空文字・不正文字・256文字超を拒否すること', () => {
    assert.throws(() => FolderResolver.sanitizeFolderId(''), /フォルダIDが指定されていません/);
    assert.throws(() => FolderResolver.sanitizeFolderId('   '), /フォルダIDが指定されていません/);
    assert.throws(() => FolderResolver.sanitizeFolderId('invalid id!@#'), /無効なフォルダID形式です/);
    assert.throws(() => FolderResolver.sanitizeFolderId('a'.repeat(257)), /長すぎます/);
  });

  it('getClientUrlFolderId: folderId / f パラメータを抽出し、不正値は空文字にすること', () => {
    assert.strictEqual(FolderResolver.getClientUrlFolderId('?folderId=url_fid_111'), 'url_fid_111');
    assert.strictEqual(FolderResolver.getClientUrlFolderId('?f=url_fid_222'), 'url_fid_222');
    assert.strictEqual(FolderResolver.getClientUrlFolderId(''), '');
    assert.strictEqual(FolderResolver.getClientUrlFolderId("?folderId=';alert(1);//"), '');
  });

  it('resolveInitialFolderId: 3層優先順位 (URL > LOCAL_STORAGE > DEFAULT > NONE) を解決すること', () => {
    const r1 = FolderResolver.resolveInitialFolderId({
      urlParam: 'id_url',
      localStore: 'id_local',
      defaultProp: 'id_default'
    });
    assert.deepStrictEqual(r1, { folderId: 'id_url', source: 'URL' });

    const r2 = FolderResolver.resolveInitialFolderId({
      urlParam: '',
      localStore: 'id_local',
      defaultProp: 'id_default'
    });
    assert.deepStrictEqual(r2, { folderId: 'id_local', source: 'LOCAL_STORAGE' });

    const r3 = FolderResolver.resolveInitialFolderId({
      urlParam: '',
      localStore: null,
      defaultProp: 'id_default'
    });
    assert.deepStrictEqual(r3, { folderId: 'id_default', source: 'DEFAULT' });

    const r4 = FolderResolver.resolveInitialFolderId({
      urlParam: '',
      localStore: '',
      defaultProp: ''
    });
    assert.deepStrictEqual(r4, { folderId: '', source: 'NONE' });
  });
});

// ====================================================
// 4. AppConfigProvider 単体テスト (js/config.js)
// ====================================================
describe('4. AppConfigProvider 単体テスト (js/config.js)', () => {
  const { STORAGE_KEYS } = require(path.join(ROOT_DIR, 'js/storage.js'));
  const AppConfigProvider = require(path.join(ROOT_DIR, 'js/config.js'));

  it('ハイブリッド解決: localStorage > config.js > 空文字で解決し出典情報を返すこと', () => {
    const store = createMockStorage();
    store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({
      clientId: 'local-client-id',
      apiKey: ''
    }));
    const defaults = {
      clientId: 'default-client-id',
      apiKey: 'default-api-key',
      appId: '123456',
      defaultFolderId: ''
    };

    const resolved = AppConfigProvider.loadConfig(defaults, store);
    assert.strictEqual(resolved.clientId, 'local-client-id');
    assert.strictEqual(resolved.apiKey, 'default-api-key');
    assert.strictEqual(resolved.appId, '123456');
    assert.strictEqual(resolved.defaultFolderId, '');
    assert.strictEqual(resolved.sources.clientId, 'LOCAL_STORAGE');
    assert.strictEqual(resolved.sources.apiKey, 'CONFIG_FILE');
    assert.strictEqual(resolved.sources.appId, 'CONFIG_FILE');
    assert.strictEqual(resolved.sources.defaultFolderId, 'NONE');
    assert.strictEqual(resolved.hasLocalOverrides, true);
    assert.strictEqual(resolved.isAuthConfigured, true);
    assert.strictEqual(resolved.isPickerConfigured, true);
  });

  it('破損 JSON が保存されていてもクラッシュせずデフォルトにフォールバックすること', () => {
    const store = createMockStorage();
    store.set(STORAGE_KEYS.APP_CONFIG, '{invalid-json!!!');
    const resolved = AppConfigProvider.loadConfig({ clientId: 'cfg-id' }, store);
    assert.strictEqual(resolved.clientId, 'cfg-id');
    assert.strictEqual(resolved.sources.clientId, 'CONFIG_FILE');
    assert.strictEqual(resolved.hasLocalOverrides, false);
  });

  it('BUG-GP-009: clientId 空保存の拒否・差分オーバーライド保存・clearConfigOverrides の動作', () => {
    const store = createMockStorage();
    const defaults = {
      clientId: 'cfg-cid',
      apiKey: 'cfg-key',
      appId: '111222',
      defaultFolderId: ''
    };

    // clientId 空はエラーになること
    const emptyCidRes = AppConfigProvider.saveConfigOverrides({
      clientId: '   ',
      apiKey: 'cfg-key'
    }, store, defaults);
    assert.strictEqual(emptyCidRes.success, false);
    assert.ok(emptyCidRes.error.includes('OAuth Client ID'));

    // 不正 defaultFolderId / 非数値 appId は拒否されること
    const badFolderRes = AppConfigProvider.saveConfigOverrides({
      clientId: 'cid',
      defaultFolderId: 'bad folder !@#'
    }, store, defaults);
    assert.strictEqual(badFolderRes.success, false);

    const badAppIdRes = AppConfigProvider.saveConfigOverrides({
      clientId: 'cid',
      appId: 'not-a-number'
    }, store, defaults);
    assert.strictEqual(badAppIdRes.success, false);

    // defaultFolderId のみ変更した場合、defaults と同値の clientId/apiKey/appId は localStorage へコピーされないこと
    const diffRes = AppConfigProvider.saveConfigOverrides({
      clientId: 'cfg-cid',
      apiKey: 'cfg-key',
      appId: '111222',
      defaultFolderId: 'https://drive.google.com/drive/folders/1AbcDefGhi_123'
    }, store, defaults);
    assert.strictEqual(diffRes.success, true);
    assert.strictEqual(diffRes.config.defaultFolderId, '1AbcDefGhi_123');
    assert.strictEqual(diffRes.config.sources.clientId, 'CONFIG_FILE');
    assert.strictEqual(diffRes.config.sources.apiKey, 'CONFIG_FILE');
    assert.strictEqual(diffRes.config.sources.appId, 'CONFIG_FILE');
    assert.strictEqual(diffRes.config.sources.defaultFolderId, 'LOCAL_STORAGE');

    const storedObj = JSON.parse(store.get(STORAGE_KEYS.APP_CONFIG));
    assert.deepStrictEqual(storedObj, { defaultFolderId: '1AbcDefGhi_123' });

    // すべて既定値と一致して保存した場合は localStorage キー自体が削除されること
    const revertToDefaultRes = AppConfigProvider.saveConfigOverrides({
      clientId: 'cfg-cid',
      apiKey: 'cfg-key',
      appId: '111222',
      defaultFolderId: ''
    }, store, defaults);
    assert.strictEqual(revertToDefaultRes.success, true);
    assert.strictEqual(store.get(STORAGE_KEYS.APP_CONFIG), null);

    // リセット動作
    AppConfigProvider.saveConfigOverrides({ clientId: 'custom-cid' }, store, defaults);
    assert.strictEqual(AppConfigProvider.clearConfigOverrides(store), true);
    const afterReset = AppConfigProvider.loadConfig({}, store);
    assert.strictEqual(afterReset.clientId, '');
    assert.strictEqual(afterReset.hasLocalOverrides, false);
  });
});

// ====================================================
// 5. AuthService 単体テスト (js/auth.js)
// ====================================================
describe('5. AuthService 単体テスト (js/auth.js)', () => {
  const { DEFAULT_SCOPE, createAuthService } = require(path.join(ROOT_DIR, 'js/auth.js'));

  it('clientId 未設定時は UNCONFIGURED、設定済み未ログイン時は SIGNED_OUT になること', () => {
    const states = [];
    const auth = createAuthService();
    auth.init('', (s) => states.push(s));
    assert.strictEqual(auth.getState().status, 'UNCONFIGURED');

    auth.init('my-client-id', (s) => states.push(s));
    assert.strictEqual(auth.getState().status, 'SIGNED_OUT');
    assert.strictEqual(auth.getValidToken(), null);
  });

  it('signIn 成功でトークンを取得し、drive.readonly スコープのみを要求すること', async () => {
    let capturedInitConfig = null;
    const mockOAuth2 = {
      initTokenClient: (cfg) => {
        capturedInitConfig = cfg;
        return {
          requestAccessToken: () => {
            cfg.callback({ access_token: 'tok-abc-123', expires_in: 3600 });
          }
        };
      },
      revoke: (_tok, cb) => { if (cb) cb(); }
    };

    const auth = createAuthService({ getGoogleOAuth2: () => mockOAuth2 });
    auth.init('client-123', () => {});
    const token = await auth.signIn('');

    assert.strictEqual(capturedInitConfig.scope, DEFAULT_SCOPE);
    assert.strictEqual(capturedInitConfig.scope, 'https://www.googleapis.com/auth/drive.readonly');
    assert.strictEqual(token, 'tok-abc-123');
    assert.strictEqual(auth.getValidToken(), 'tok-abc-123');
    assert.strictEqual(auth.getState().status, 'AUTHENTICATED');
    assert.strictEqual(auth.getState().isAuthenticated, true);
    assert.strictEqual('accessToken' in auth.getState(), false, 'AuthState に生トークンを含めないこと');
  });

  it('有効期限60秒マージン経過後は getValidToken() が null を返すこと', async () => {
    const mockOAuth2 = {
      initTokenClient: (cfg) => ({
        requestAccessToken: () => {
          cfg.callback({ access_token: 'short-tok', expires_in: 30 });
        }
      })
    };
    const auth = createAuthService({ getGoogleOAuth2: () => mockOAuth2 });
    auth.init('client-123', () => {});
    await auth.signIn();
    assert.strictEqual(auth.getValidToken(), null);
  });

  it('error_callback (popup_closed) 時にデッドロックせず元の状態へ復帰すること', async () => {
    const mockOAuth2 = {
      initTokenClient: (cfg) => ({
        requestAccessToken: () => {
          cfg.error_callback({ type: 'popup_closed' });
        }
      })
    };
    const auth = createAuthService({ getGoogleOAuth2: () => mockOAuth2 });
    auth.init('client-123', () => {});

    await assert.rejects(() => auth.signIn(), /ポップアップが閉じられました/);
    assert.strictEqual(auth.getState().status, 'SIGNED_OUT');
  });

  it('BUG-GP-003: handleUnauthorized は AUTHENTICATED / EXPIRED からのみ遷移し未認証状態は上書きしないこと', async () => {
    const revokedTokens = [];
    const mockOAuth2 = {
      initTokenClient: (cfg) => ({
        requestAccessToken: () => {
          cfg.callback({ access_token: 'tok-xyz', expires_in: 3600 });
        }
      }),
      revoke: (tok, cb) => {
        revokedTokens.push(tok);
        if (cb) cb();
      }
    };

    const auth = createAuthService({ getGoogleOAuth2: () => mockOAuth2 });
    auth.init('', () => {});
    auth.handleUnauthorized();
    assert.strictEqual(auth.getState().status, 'UNCONFIGURED');

    auth.init('client-1', () => {});
    auth.handleUnauthorized();
    assert.strictEqual(auth.getState().status, 'SIGNED_OUT');

    await auth.signIn();
    auth.handleUnauthorized();
    assert.strictEqual(auth.getState().status, 'EXPIRED');
    assert.strictEqual(auth.getValidToken(), null);

    await auth.signIn();
    assert.strictEqual(auth.getState().status, 'AUTHENTICATED');

    auth.reinit('client-2');
    assert.strictEqual(auth.getState().status, 'SIGNED_OUT');
    assert.strictEqual(auth.getValidToken(), null);
    assert.deepStrictEqual(revokedTokens, ['tok-xyz']);

    await auth.signIn();
    await auth.signOut();
    assert.strictEqual(auth.getState().status, 'SIGNED_OUT');
    assert.strictEqual(auth.getValidToken(), null);
    assert.strictEqual(revokedTokens.length, 2);
  });
});

// ====================================================
// 6. DriveApiClient 単体テスト (js/drive-api.js)
// ====================================================
describe('6. DriveApiClient 単体テスト (js/drive-api.js)', () => {
  const DriveApi = require(path.join(ROOT_DIR, 'js/drive-api.js'));

  it('getFolderDetails: 共有ドライブ対応パラメータ・ゴミ箱判定・非フォルダ判定が機能すること', async () => {
    const requestedUrls = [];
    const client = DriveApi.createDriveApiClient({
      getAccessToken: () => 'valid-tok',
      fetchImpl: async (url) => {
        requestedUrls.push(url);
        if (url.includes('/trashed_id')) {
          return createMockResponse(200, {
            id: 'trashed_id',
            name: 'Old',
            mimeType: 'application/vnd.google-apps.folder',
            trashed: true
          });
        }
        if (url.includes('/not_folder_id')) {
          return createMockResponse(200, {
            id: 'not_folder_id',
            name: 'readme.html',
            mimeType: 'text/html',
            trashed: false
          });
        }
        return createMockResponse(200, {
          id: 'folder_ok',
          name: 'Shared Docs',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false
        });
      }
    });

    const ok = await client.getFolderDetails('folder_ok');
    assert.strictEqual(ok.success, true);
    assert.strictEqual(ok.folder.name, 'Shared Docs');
    assert.ok(requestedUrls[0].includes('supportsAllDrives=true'));
    assert.ok(requestedUrls[0].includes('fields=id,name,mimeType,trashed'));

    const trashed = await client.getFolderDetails('trashed_id');
    assert.strictEqual(trashed.success, false);
    assert.strictEqual(trashed.errorCode, 'TRASHED');

    const notFolder = await client.getFolderDetails('not_folder_id');
    assert.strictEqual(notFolder.success, false);
    assert.strictEqual(notFolder.errorCode, 'NOT_A_FOLDER');
  });

  it('BUG-GP-010: ページング結合・厳密HTMLフィルタ・size数値化・不正日時末尾配置の降順ソート', async () => {
    const requestedUrls = [];
    const client = DriveApi.createDriveApiClient({
      getAccessToken: () => 'valid-tok',
      fetchImpl: async (url) => {
        requestedUrls.push(url);
        if (url.includes('/files/folder_1?')) {
          return createMockResponse(200, {
            id: 'folder_1',
            name: 'Main Folder',
            mimeType: 'application/vnd.google-apps.folder',
            trashed: false
          });
        }
        if (!url.includes('pageToken=page2')) {
          return createMockResponse(200, {
            nextPageToken: 'page2',
            files: [
              { id: 'f_invalid_date', name: 'z_bad_date.html', size: '10', modifiedTime: 'invalid-date', mimeType: 'text/html', trashed: false },
              { id: 'f1', name: 'older.html', size: '1024', modifiedTime: '2026-01-01T10:00:00Z', mimeType: 'text/html', trashed: false },
              { id: 'f_bak', name: 'ignore.html.bak', size: '500', modifiedTime: '2026-05-01T10:00:00Z', mimeType: 'text/plain', trashed: false },
              { id: 'f_dir', name: 'sub.html', size: '0', modifiedTime: '2026-05-01T10:00:00Z', mimeType: 'application/vnd.google-apps.folder', trashed: false }
            ]
          });
        }
        return createMockResponse(200, {
          files: [
            { id: 'f2', name: 'newer.HTM', size: '2048', modifiedTime: '2026-03-01T10:00:00Z', mimeType: 'application/octet-stream', trashed: false },
            { id: 'f_no_date', name: 'no_date.html', size: '5', modifiedTime: '', mimeType: 'text/html', trashed: false }
          ]
        });
      }
    });

    const res = await client.getHtmlFileList('folder_1');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data.length, 4);
    assert.strictEqual(res.data[0].id, 'f2', '最新日時が先頭であること');
    assert.strictEqual(res.data[1].id, 'f1', '次の有効日時が2番目であること');
    assert.ok(['f_invalid_date', 'f_no_date'].includes(res.data[2].id), '不正・欠損日時は末尾へ配置されること');
    assert.ok(['f_invalid_date', 'f_no_date'].includes(res.data[3].id), '不正・欠損日時は末尾へ配置されること');

    const listUrl = requestedUrls[1];
    assert.ok(listUrl.includes('supportsAllDrives=true'));
    assert.ok(listUrl.includes('includeItemsFromAllDrives=true'));
    assert.ok(listUrl.includes('pageSize=1000'));
  });

  it('BUG-GP-010: searchHtmlFiles が name contains と fullText contains を構築し改行・制御文字を空白正規化すること', async () => {
    const requestedUrls = [];
    const client = DriveApi.createDriveApiClient({
      getAccessToken: () => 'valid-tok',
      fetchImpl: async (url) => {
        requestedUrls.push(url);
        if (url.includes('/files/folder_1?')) {
          return createMockResponse(200, {
            id: 'folder_1',
            name: 'Main',
            mimeType: 'application/vnd.google-apps.folder',
            trashed: false
          });
        }
        return createMockResponse(200, { files: [] });
      }
    });

    await client.searchHtmlFiles("dash\nboard\r\titem", 'folder_1');
    const searchUrl = new URL(requestedUrls[1]);
    const q = searchUrl.searchParams.get('q');
    assert.ok(q.includes("name contains 'dash board item'"), '改行・タブが半角スペースに正規化されること');
    assert.ok(q.includes("fullText contains 'dash board item'"));
    assert.strictEqual(q.includes('title contains'), false);
    assert.strictEqual(q.includes('\n'), false);
    assert.strictEqual(q.includes('\r'), false);
  });

  it('getHtmlFileContent & HTTP エラー分類 (401 / 403詳細 / 404 / 429 / 500 / NOT_DOWNLOADABLE)', async () => {
    let mode = 'ok';
    const client = DriveApi.createDriveApiClient({
      getAccessToken: () => (mode === 'no_tok' ? null : 'tok'),
      fetchImpl: async () => {
        if (mode === 'ok') return createMockResponse(200, '<h1>Hello</h1>');
        if (mode === '401') return createMockResponse(401, { error: { message: 'Invalid Credentials' } });
        if (mode === '403_rate') return createMockResponse(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } });
        if (mode === '403_api') return createMockResponse(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } });
        if (mode === '403_doc') return createMockResponse(403, { error: { errors: [{ reason: 'fileNotDownloadable' }] } });
        if (mode === '403_perm') return createMockResponse(403, { error: { errors: [{ reason: 'insufficientFilePermissions' }] } });
        if (mode === '404') return createMockResponse(404, { error: { message: 'Not Found' } });
        if (mode === '429') return createMockResponse(429, { error: { message: 'Too Many Requests' } });
        if (mode === '500') return createMockResponse(500, { error: { message: 'Internal Error' } });
        throw new Error('ECONNRESET');
      }
    });

    const contentRes = await client.getHtmlFileContent('file_1', 'hello.html');
    assert.strictEqual(contentRes.content, '<h1>Hello</h1>');
    assert.strictEqual(contentRes.data.fileName, 'hello.html');

    mode = 'no_tok';
    assert.strictEqual((await client.getHtmlFileContent('file_1')).errorCode, 'UNAUTHORIZED');
    mode = '401';
    assert.strictEqual((await client.getHtmlFileContent('file_1')).errorCode, 'UNAUTHORIZED');
    mode = '403_rate';
    assert.strictEqual((await client.getFolderDetails('f_1')).errorCode, 'RATE_LIMITED');
    mode = '403_api';
    assert.strictEqual((await client.getFolderDetails('f_1')).errorCode, 'API_DISABLED');
    mode = '403_doc';
    assert.strictEqual((await client.getHtmlFileContent('file_1')).errorCode, 'NOT_DOWNLOADABLE');
    mode = '403_perm';
    assert.strictEqual((await client.getFolderDetails('f_1')).errorCode, 'FORBIDDEN');
    mode = '404';
    assert.strictEqual((await client.getFolderDetails('f_1')).errorCode, 'NOT_FOUND');
    mode = '429';
    assert.strictEqual((await client.getFolderDetails('f_1')).errorCode, 'RATE_LIMITED');
    mode = '500';
    assert.strictEqual((await client.getFolderDetails('f_1')).errorCode, 'NETWORK_ERROR');
    mode = 'net';
    assert.strictEqual((await client.getFolderDetails('f_1')).errorCode, 'NETWORK_ERROR');
  });

  it('listSubfolders: MY_DRIVE / SHARED_DRIVES / SHARED_WITH_ME / ページング / 不正入力 / キャンセル / HTTPエラー分類', async () => {
    assert.strictEqual(DriveApi.DRIVE_DRIVES_API_BASE, 'https://www.googleapis.com/drive/v3/drives');

    const capturedUrls = [];
    let forceStatus = 200;
    const client = DriveApi.createDriveApiClient({
      getAccessToken: () => 'valid-tok',
      fetchImpl: async (url) => {
        capturedUrls.push(url);
        if (forceStatus !== 200) {
          return createMockResponse(forceStatus, { error: { message: 'Err ' + forceStatus } });
        }
        return createMockResponse(200, {
          nextPageToken: 'next_p2',
          files: [{ id: 'sub_1', name: 'Sub One', driveId: 'drv_1' }]
        });
      }
    });

    // MY_DRIVE root
    const rMyRoot = await client.listSubfolders({ space: 'MY_DRIVE' });
    assert.strictEqual(rMyRoot.success, true);
    assert.strictEqual(rMyRoot.nextPageToken, 'next_p2');
    assert.strictEqual(rMyRoot.items[0].id, 'sub_1');
    const uMyRoot = new URL(capturedUrls[0]);
    assert.strictEqual(uMyRoot.searchParams.get('q'), "'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    assert.strictEqual(uMyRoot.searchParams.get('orderBy'), 'name');
    assert.strictEqual(uMyRoot.searchParams.get('supportsAllDrives'), 'true');
    assert.strictEqual(uMyRoot.searchParams.get('includeItemsFromAllDrives'), 'true');

    // SHARED_DRIVES (parentId 省略時は driveId を親に使い、corpora=drive & driveId を付与)
    const rSharedDrive = await client.listSubfolders({ space: 'SHARED_DRIVES', driveId: 'drv_1', pageToken: 'tok_p1' });
    assert.strictEqual(rSharedDrive.success, true);
    const uSharedDrive = new URL(capturedUrls[1]);
    assert.strictEqual(uSharedDrive.searchParams.get('corpora'), 'drive');
    assert.strictEqual(uSharedDrive.searchParams.get('driveId'), 'drv_1');
    assert.strictEqual(uSharedDrive.searchParams.get('pageToken'), 'tok_p1');
    assert.ok(uSharedDrive.searchParams.get('q').includes("'drv_1' in parents"));

    // SHARED_DRIVES で driveId 欠落は INVALID_INPUT
    const rMissingDrive = await client.listSubfolders({ space: 'SHARED_DRIVES' });
    assert.strictEqual(rMissingDrive.success, false);
    assert.strictEqual(rMissingDrive.errorCode, 'INVALID_INPUT');

    // SHARED_WITH_ME (ルート vs サブフォルダドリルダウン)
    await client.listSubfolders({ space: 'SHARED_WITH_ME' });
    const uSwmRoot = new URL(capturedUrls[2]);
    assert.ok(uSwmRoot.searchParams.get('q').includes('sharedWithMe = true'));

    await client.listSubfolders({ space: 'SHARED_WITH_ME', parentId: 'shared_sub_1' });
    const uSwmSub = new URL(capturedUrls[3]);
    assert.ok(uSwmSub.searchParams.get('q').includes("'shared_sub_1' in parents"));

    // 不正 parentId は INVALID_INPUT
    const rBadParent = await client.listSubfolders({ space: 'MY_DRIVE', parentId: "bad'id" });
    assert.strictEqual(rBadParent.success, false);
    assert.strictEqual(rBadParent.errorCode, 'INVALID_INPUT');

    // キャンセルシグナル検知
    const rCancelled = await client.listSubfolders({ space: 'MY_DRIVE' }, { isCancelled: () => true });
    assert.strictEqual(rCancelled.success, false);
    assert.strictEqual(rCancelled.cancelled, true);

    // HTTP エラー分類
    forceStatus = 401;
    assert.strictEqual((await client.listSubfolders({ space: 'MY_DRIVE' })).errorCode, 'UNAUTHORIZED');
    forceStatus = 403;
    assert.strictEqual((await client.listSubfolders({ space: 'MY_DRIVE' })).errorCode, 'FORBIDDEN');
    forceStatus = 404;
    assert.strictEqual((await client.listSubfolders({ space: 'MY_DRIVE' })).errorCode, 'NOT_FOUND');
    forceStatus = 429;
    assert.strictEqual((await client.listSubfolders({ space: 'MY_DRIVE' })).errorCode, 'RATE_LIMITED');
    forceStatus = 500;
    assert.strictEqual((await client.listSubfolders({ space: 'MY_DRIVE' })).errorCode, 'NETWORK_ERROR');
  });

  it('listSharedDrives: /drive/v3/drives 呼び出し・orderBy 非付与・pageSize クランプ・isSharedDrive 正規化', async () => {
    const capturedUrls = [];
    const client = DriveApi.createDriveApiClient({
      getAccessToken: () => 'valid-tok',
      fetchImpl: async (url) => {
        capturedUrls.push(url);
        return createMockResponse(200, {
          nextPageToken: 'drv_p2',
          drives: [{ id: 'drv_abc', name: 'Team Engineering' }]
        });
      }
    });

    const res = await client.listSharedDrives({ pageSize: 500 });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.nextPageToken, 'drv_p2');
    assert.deepStrictEqual(res.items, [
      { id: 'drv_abc', name: 'Team Engineering', driveId: 'drv_abc', isSharedDrive: true }
    ]);

    const parsed = new URL(capturedUrls[0]);
    assert.strictEqual(parsed.origin + parsed.pathname, DriveApi.DRIVE_DRIVES_API_BASE);
    assert.strictEqual(parsed.searchParams.has('orderBy'), false, 'drives.list に orderBy を付与しないこと');
    assert.strictEqual(parsed.searchParams.get('pageSize'), '100', 'pageSize が 100 にクランプされること');
  });

  it('searchFolders: corpora=allDrives・改行空白正規化・空文字時 INVALID_INPUT', async () => {
    const capturedUrls = [];
    const client = DriveApi.createDriveApiClient({
      getAccessToken: () => 'valid-tok',
      fetchImpl: async (url) => {
        capturedUrls.push(url);
        return createMockResponse(200, {
          files: [{ id: 'f_hit', name: 'Design Docs', driveId: '' }]
        });
      }
    });

    const emptyRes = await client.searchFolders({ keyword: '   \n\t  ' });
    assert.strictEqual(emptyRes.success, false);
    assert.strictEqual(emptyRes.errorCode, 'INVALID_INPUT');

    const okRes = await client.searchFolders({ keyword: "Design\nDocs\t2026" });
    assert.strictEqual(okRes.success, true);
    assert.strictEqual(okRes.items.length, 1);

    const parsed = new URL(capturedUrls[0]);
    assert.strictEqual(parsed.searchParams.get('corpora'), 'allDrives');
    assert.strictEqual(parsed.searchParams.get('supportsAllDrives'), 'true');
    assert.strictEqual(parsed.searchParams.get('includeItemsFromAllDrives'), 'true');
    assert.ok(parsed.searchParams.get('q').includes("name contains 'Design Docs 2026'"));
  });
});

// ====================================================
// 7. PickerService 単体テスト (js/picker.js)
// ====================================================
describe('7. PickerService 単体テスト (js/picker.js)', () => {
  const { createPickerService } = require(path.join(ROOT_DIR, 'js/picker.js'));

  it('origin 設定・SUPPORT_DRIVES・OAuthToken 設定・PICKED コールバックが動作すること', () => {
    const builderCalls = {};
    const mockPickerNs = {
      ViewId: { FOLDERS: 'FOLDERS' },
      Feature: { SUPPORT_DRIVES: 'SUPPORT_DRIVES' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      Document: { ID: 'id', NAME: 'name' },
      DocsView: function (viewId) {
        builderCalls.viewId = viewId;
        this.setIncludeFolders = (v) => { builderCalls.includeFolders = v; return this; };
        this.setSelectFolderEnabled = (v) => { builderCalls.selectFolder = v; return this; };
      },
      PickerBuilder: function () {
        this.addView = () => this;
        this.enableFeature = (f) => { builderCalls.feature = f; return this; };
        this.setOAuthToken = (t) => { builderCalls.token = t; return this; };
        this.setDeveloperKey = (k) => { builderCalls.apiKey = k; return this; };
        this.setAppId = (a) => { builderCalls.appId = a; return this; };
        this.setSize = () => this;
        this.setLocale = () => this;
        this.setOrigin = (o) => { builderCalls.origin = o; return this; };
        this.setCallback = (cb) => { builderCalls.callback = cb; return this; };
        this.build = () => ({ setVisible: (v) => { builderCalls.visible = v; } });
      }
    };

    const picker = createPickerService({
      getGapi: () => ({ load: (_name, opt) => opt.callback() }),
      getGooglePicker: () => mockPickerNs,
      getOrigin: () => 'https://nankojin-ops.github.io'
    });
    picker.load();
    assert.strictEqual(picker.isLoaded(), true);

    let picked = null;
    picker.openFolderPicker({
      accessToken: 'tok-1',
      apiKey: 'api-key-1',
      appId: '12345',
      onPicked: (folder) => { picked = folder; },
      onFallbackToManual: () => { throw new Error('Should not fallback'); }
    });

    assert.strictEqual(builderCalls.origin, 'https://nankojin-ops.github.io');
    assert.strictEqual(builderCalls.feature, 'SUPPORT_DRIVES');
    assert.strictEqual(builderCalls.token, 'tok-1');
    assert.strictEqual(builderCalls.visible, true);

    builderCalls.callback({
      action: 'picked',
      docs: [{ id: 'picked_dir', name: 'Picked Folder' }]
    });
    assert.deepStrictEqual(picked, { id: 'picked_dir', name: 'Picked Folder' });
  });

  it('apiKey / appId 未設定時は手動モーダルフォールバックが呼ばれること', () => {
    const picker = createPickerService({
      getGapi: () => ({ load: (_n, opt) => opt.callback() }),
      getGooglePicker: () => ({})
    });
    picker.load();

    let fallbackReason = '';
    picker.openFolderPicker({
      accessToken: 'tok-1',
      apiKey: '',
      appId: '12345',
      onPicked: () => {},
      onFallbackToManual: (reason) => { fallbackReason = reason; }
    });
    assert.ok(fallbackReason.length > 0);
  });

  it('連続起動・PICKED・CANCEL 時に前回インスタンスの dispose() が呼ばれ、dispose 未実装モックでも例外が起きないこと', () => {
    let disposeCount = 0;
    let builtCount = 0;
    let latestCallback = null;
    let withDispose = true;

    const mockPickerNs = {
      ViewId: { FOLDERS: 'FOLDERS' },
      Feature: { SUPPORT_DRIVES: 'SUPPORT_DRIVES' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      Document: { ID: 'id', NAME: 'name' },
      DocsView: function () {
        this.setIncludeFolders = () => this;
        this.setSelectFolderEnabled = () => this;
      },
      PickerBuilder: function () {
        this.addView = () => this;
        this.enableFeature = () => this;
        this.setOAuthToken = () => this;
        this.setDeveloperKey = () => this;
        this.setAppId = () => this;
        this.setSize = () => this;
        this.setLocale = () => this;
        this.setOrigin = () => this;
        this.setCallback = (cb) => { latestCallback = cb; return this; };
        this.build = () => {
          builtCount++;
          const inst = { setVisible: () => {} };
          if (withDispose) {
            inst.dispose = () => { disposeCount++; };
          }
          return inst;
        };
      }
    };

    const picker = createPickerService({
      getGapi: () => ({ load: (_n, opt) => opt.callback() }),
      getGooglePicker: () => mockPickerNs
    });
    picker.load();

    // 1回目起動 -> CANCEL で disposeCount === 1
    picker.openFolderPicker({
      accessToken: 'tok-1',
      apiKey: 'k',
      appId: '123',
      onPicked: () => {},
      onCancel: () => {},
      onFallbackToManual: () => {}
    });
    latestCallback({ action: 'cancel' });
    assert.strictEqual(disposeCount, 1, 'CANCEL 時に dispose() が呼ばれること');

    // 2回目起動中に3回目連続起動 -> 再起動前に disposeCount === 2、PICKED で disposeCount === 3
    picker.openFolderPicker({
      accessToken: 'tok-1',
      apiKey: 'k',
      appId: '123',
      onPicked: () => {},
      onFallbackToManual: () => {}
    });
    picker.openFolderPicker({
      accessToken: 'tok-1',
      apiKey: 'k',
      appId: '123',
      onPicked: () => {},
      onFallbackToManual: () => {}
    });
    assert.strictEqual(disposeCount, 2, '連続起動時に前回インスタンスの dispose() が呼ばれること');
    latestCallback({ action: 'picked', docs: [{ id: 'd1', name: 'D1' }] });
    assert.strictEqual(disposeCount, 3, 'PICKED 時に dispose() が呼ばれること');

    // dispose 未実装モックでも例外が起きないこと
    withDispose = false;
    assert.doesNotThrow(() => {
      picker.openFolderPicker({
        accessToken: 'tok-1',
        apiKey: 'k',
        appId: '123',
        onPicked: () => {},
        onFallbackToManual: () => {}
      });
      latestCallback({ action: 'cancel' });
    });
    assert.strictEqual(builtCount, 4);
  });
});

// ====================================================
// 8. AppStateController 結合テスト (js/app.js) & BUG-GP-006〜010 回帰
// ====================================================
describe('8. AppStateController 結合テスト (js/app.js)', () => {
  const { STORAGE_KEYS } = require(path.join(ROOT_DIR, 'js/storage.js'));
  const FolderResolver = require(path.join(ROOT_DIR, 'js/folder-resolver.js'));
  const AppConfigProvider = require(path.join(ROOT_DIR, 'js/config.js'));
  const { createAuthService } = require(path.join(ROOT_DIR, 'js/auth.js'));
  const DriveApi = require(path.join(ROOT_DIR, 'js/drive-api.js'));
  const { createPickerService } = require(path.join(ROOT_DIR, 'js/picker.js'));
  const { createAppController, createDomUiAdapter } = require(path.join(ROOT_DIR, 'js/app.js'));

  it('URL クエリパラメータ優先解決 + サインイン後の初期一覧読み込みと保存', async () => {
    const store = createMockStorage();
    store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({
      clientId: 'cid-1',
      defaultFolderId: 'def_folder'
    }));
    store.set(STORAGE_KEYS.LAST_FOLDER_ID, 'local_folder');

    const logs = createFreshLogs();
    const authService = createAuthService({
      getGoogleOAuth2: () => ({
        initTokenClient: (cfg) => ({
          requestAccessToken: () => cfg.callback({ access_token: 'tok-ok', expires_in: 3600 })
        })
      })
    });

    const driveApi = DriveApi.createDriveApiClient({
      getAccessToken: () => authService.getValidToken(),
      fetchImpl: async (url) => {
        if (url.includes('/files/url_folder?')) {
          return createMockResponse(200, { id: 'url_folder', name: 'URL Folder', mimeType: 'application/vnd.google-apps.folder', trashed: false });
        }
        return createMockResponse(200, {
          files: [{ id: 'html1', name: 'index.html', size: '100', modifiedTime: '2026-06-01T00:00:00Z', mimeType: 'text/html', trashed: false }]
        });
      }
    });

    const controller = createAppController({
      configProvider: AppConfigProvider,
      storage: store,
      storageKeys: STORAGE_KEYS,
      folderResolver: FolderResolver,
      authService,
      driveApi,
      pickerService: createPickerService({ getGapi: () => null, getGooglePicker: () => null }),
      ui: createTrackingMockUi(logs),
      getSearchString: () => '?folderId=url_folder'
    });

    controller.init();
    assert.strictEqual(authService.getState().status, 'SIGNED_OUT');
    await authService.signIn();
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(controller.getCurrentFolderId(), 'url_folder');
    assert.strictEqual(logs.folderName, 'URL Folder');
    assert.strictEqual(logs.renderedFiles.length, 1);
    assert.strictEqual(store.get(STORAGE_KEYS.LAST_FOLDER_ID), 'url_folder');
  });

  it('BUG-GP-010: 無効フォルダ自己修復 + 401 後の検索語 "abc" 再実行 + 通信障害時の保持', async () => {
    const store = createMockStorage();
    store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({
      clientId: 'cid-1',
      defaultFolderId: 'def_folder'
    }));
    store.set(STORAGE_KEYS.LAST_FOLDER_ID, 'deleted_folder');

    const logs = createFreshLogs();
    const searchQueries = [];
    let signInCount = 0;
    const authService = createAuthService({
      getGoogleOAuth2: () => ({
        initTokenClient: (cfg) => ({
          requestAccessToken: () => {
            signInCount++;
            cfg.callback({ access_token: 'tok-' + signInCount, expires_in: 3600 });
          }
        })
      })
    });

    let force401 = false;
    let force500 = false;
    const driveApi = DriveApi.createDriveApiClient({
      getAccessToken: () => authService.getValidToken(),
      fetchImpl: async (url) => {
        if (force401) return createMockResponse(401, { error: { message: 'Expired' } });
        if (force500) return createMockResponse(500, { error: { message: 'Server Error' } });
        if (url.includes('/files/deleted_folder?')) {
          return createMockResponse(404, { error: { message: 'Not found' } });
        }
        if (url.includes('/files/def_folder?')) {
          return createMockResponse(200, { id: 'def_folder', name: 'Default Folder', mimeType: 'application/vnd.google-apps.folder', trashed: false });
        }
        const parsed = new URL(url);
        searchQueries.push(parsed.searchParams.get('q'));
        return createMockResponse(200, {
          files: [{ id: 'matched_1', name: 'abc_report.html', size: '256', modifiedTime: '2026-06-01T00:00:00Z', mimeType: 'text/html', trashed: false }]
        });
      }
    });

    const controller = createAppController({
      configProvider: AppConfigProvider,
      storage: store,
      storageKeys: STORAGE_KEYS,
      folderResolver: FolderResolver,
      authService,
      driveApi,
      pickerService: createPickerService({ getGapi: () => null, getGooglePicker: () => null }),
      ui: createTrackingMockUi(logs),
      getSearchString: () => ''
    });

    controller.init();
    await authService.signIn();
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(controller.getCurrentFolderId(), 'def_folder');
    assert.strictEqual(store.get(STORAGE_KEYS.LAST_FOLDER_ID), 'def_folder');

    // 500 通信障害時でも def_folder は削除されないこと
    force500 = true;
    await controller.executeSearch('test');
    assert.strictEqual(store.get(STORAGE_KEYS.LAST_FOLDER_ID), 'def_folder');
    force500 = false;

    // 401 発生 -> EXPIRED 遷移（def_folder は保持）
    force401 = true;
    await controller.executeSearch('abc');
    assert.strictEqual(authService.getState().status, 'EXPIRED');
    assert.strictEqual(store.get(STORAGE_KEYS.LAST_FOLDER_ID), 'def_folder');

    // 再認証完了後に直前の検索語 'abc' で Drive API 検索が自動再実行されること
    const countBeforeReauth = searchQueries.length;
    force401 = false;
    await authService.signIn();
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(authService.getState().status, 'AUTHENTICATED');
    assert.strictEqual(searchQueries.length, countBeforeReauth + 1);
    assert.ok(searchQueries[searchQueries.length - 1].includes("name contains 'abc'"), '401 再認証後に検索語 abc が再実行されること');
  });

  it('BUG-GP-006: トークン自然失効時の openFolderSelection 及び submitManualFolder 401 の導線', async () => {
    const store = createMockStorage();
    store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({ clientId: 'cid-1' }));
    const logs = createFreshLogs();

    let nextExpiresIn = 30; // 60秒マージン以下 -> getValidToken() が即 null（自然失効状態）
    const authService = createAuthService({
      getGoogleOAuth2: () => ({
        initTokenClient: (cfg) => ({
          requestAccessToken: () => cfg.callback({ access_token: 'tok-exp', expires_in: nextExpiresIn })
        })
      })
    });

    const driveApi = DriveApi.createDriveApiClient({
      getAccessToken: () => authService.getValidToken(),
      fetchImpl: async (url) => {
        if (url.includes('/files/folder_m?')) {
          return createMockResponse(200, { id: 'folder_m', name: 'Manual', mimeType: 'application/vnd.google-apps.folder', trashed: false });
        }
        return createMockResponse(200, { files: [] });
      }
    });

    const controller = createAppController({
      configProvider: AppConfigProvider,
      storage: store,
      storageKeys: STORAGE_KEYS,
      folderResolver: FolderResolver,
      authService,
      driveApi,
      pickerService: createPickerService({ getGapi: () => null, getGooglePicker: () => null }),
      ui: createTrackingMockUi(logs)
    });

    controller.init();
    await authService.signIn();
    await new Promise((r) => setTimeout(r, 20));

    // 自然失効後に openFolderSelection() -> EXPIRED へ遷移し、再認証で再開すること
    controller.openFolderSelection();
    assert.strictEqual(authService.getState().status, 'EXPIRED');

    // submitManualFolder() でトークン失効時 -> モーダルを閉じて EXPIRED 遷移、再認証後自動適用されること
    const manualRes = await controller.submitManualFolder('folder_m');
    assert.strictEqual(manualRes.errorCode, 'UNAUTHORIZED');
    assert.ok(logs.manualModalClosed >= 1, '401 時に手動モーダルが閉じられること');
    assert.strictEqual(authService.getState().status, 'EXPIRED');

    nextExpiresIn = 3600;
    await authService.signIn();
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(controller.getCurrentFolderId(), 'folder_m');
  });

  it('BUG-GP-007: selectFile 失敗時の状態ロールバック及び 0 バイト HTML 再読込', async () => {
    const store = createMockStorage();
    store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({ clientId: 'cid-1', defaultFolderId: 'f1' }));
    const logs = createFreshLogs();

    const authService = createAuthService({
      getGoogleOAuth2: () => ({
        initTokenClient: (cfg) => ({
          requestAccessToken: () => cfg.callback({ access_token: 'tok-ok', expires_in: 3600 })
        })
      })
    });

    const driveApi = DriveApi.createDriveApiClient({
      getAccessToken: () => authService.getValidToken(),
      fetchImpl: async (url) => {
        if (url.includes('/files/f1?')) {
          return createMockResponse(200, { id: 'f1', name: 'Dir', mimeType: 'application/vnd.google-apps.folder', trashed: false });
        }
        if (url.includes('/files/bad_first?alt=media')) {
          return createMockResponse(404, { error: { message: 'Missing' } });
        }
        if (url.includes('/files/empty_html?alt=media')) {
          return createMockResponse(200, '');
        }
        if (url.includes('/files/bad_second?alt=media')) {
          return createMockResponse(403, { error: { errors: [{ reason: 'fileNotDownloadable' }] } });
        }
        return createMockResponse(200, { files: [] });
      }
    });

    const controller = createAppController({
      configProvider: AppConfigProvider,
      storage: store,
      storageKeys: STORAGE_KEYS,
      folderResolver: FolderResolver,
      authService,
      driveApi,
      pickerService: createPickerService({ getGapi: () => null, getGooglePicker: () => null }),
      ui: createTrackingMockUi(logs)
    });

    controller.init();
    await authService.signIn();
    await new Promise((r) => setTimeout(r, 20));

    // 初回 selectFile 失敗 -> activeFileId は null のまま、resetPreview() で emptyState に戻ること
    await controller.selectFile({ id: 'bad_first', name: 'bad_first.html' });
    assert.strictEqual(controller.getActiveFileId(), null);
    assert.strictEqual(logs.emptyStateVisible, true);
    assert.strictEqual(logs.previewActionsVisible, false);

    // 0 バイト HTML ファイル読み込み成功 -> reloadPreview() が動作すること
    await controller.selectFile({ id: 'empty_html', name: 'empty.html' });
    assert.strictEqual(controller.getActiveFileId(), 'empty_html');
    assert.strictEqual(controller.hasLoadedPreview(), true);
    const updatesBeforeReload = logs.previewUpdates.length;
    controller.reloadPreview();
    await new Promise((r) => setTimeout(r, 70));
    assert.ok(logs.previewUpdates.length > updatesBeforeReload, '0バイトHTMLでも再読込が実行されること');

    // 続けて別ファイル失敗 -> activeFileId とヘッダー名が直前の empty.html にロールバックされること
    await controller.selectFile({ id: 'bad_second', name: 'gdoc.html' });
    assert.strictEqual(controller.getActiveFileId(), 'empty_html');
    assert.strictEqual(logs.previewTitles[logs.previewTitles.length - 1], 'empty.html');
    assert.strictEqual(logs.previewActionsVisible, true);
  });

  it('BUG-GP-008 & BUG-GP-009: フォルダ未選択時の件数表示保持と saveSettings/resetSettings の動作', async () => {
    const store = createMockStorage();
    store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({ clientId: 'cid-1' }));
    const logs = createFreshLogs();

    const authService = createAuthService({
      getGoogleOAuth2: () => ({
        initTokenClient: (cfg) => ({
          requestAccessToken: () => cfg.callback({ access_token: 'tok-ok', expires_in: 3600 })
        })
      })
    });

    const controller = createAppController({
      configProvider: AppConfigProvider,
      storage: store,
      storageKeys: STORAGE_KEYS,
      folderResolver: FolderResolver,
      authService,
      driveApi: DriveApi.createDriveApiClient({
        getAccessToken: () => authService.getValidToken(),
        fetchImpl: async () => createMockResponse(200, { files: [] })
      }),
      pickerService: createPickerService({ getGapi: () => null, getGooglePicker: () => null }),
      ui: createTrackingMockUi(logs)
    });

    controller.init();
    await authService.signIn();
    await new Promise((r) => setTimeout(r, 20));

    // BUG-GP-008: 未選択時は最後が 'フォルダを選択してください' であり、'0 件のファイル' で上書きされないこと
    assert.strictEqual(
      logs.fileCountHistory[logs.fileCountHistory.length - 1],
      'フォルダを選択してください'
    );

    // BUG-GP-009: 空 clientId の saveSettings は失敗しエラー表示されること
    const badSave = controller.saveSettings({ clientId: '' });
    assert.strictEqual(badSave.success, false);
    assert.ok(logs.settingsErrors.length >= 1);

    // resetSettings() で clearConfigOverrides 失敗時にエラー通知されること
    store.setThrowOnRemove(true);
    const resetFailed = controller.resetSettings();
    assert.strictEqual(resetFailed, false);
    assert.ok(logs.toasts.some((t) => t.type === 'error' && t.t.includes('リセットエラー')));

    // resetSettings() 成功時は未設定状態に戻る
    store.setThrowOnRemove(false);
    const resetOk = controller.resetSettings();
    assert.strictEqual(resetOk, true);
    assert.strictEqual(authService.getState().status, 'UNCONFIGURED');
  });

  it('統合フォルダ選択モーダル: マイドライブ/共有ドライブ/検索/ページング/パンくず/確定フロー', async () => {
    const store = createMockStorage();
    store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({
      clientId: 'cid-1',
      apiKey: 'key-1',
      appId: '123456'
    }));

    const logs = createFreshLogs();
    logs.selectorOpened = [];
    logs.selectorClosed = 0;
    logs.browserRenders = [];
    logs.tabsSwitched = [];

    const ui = Object.assign(createTrackingMockUi(logs), {
      openFolderSelectorModal: (opts) => { logs.selectorOpened.push(opts); },
      closeFolderSelectorModal: () => { logs.selectorClosed++; },
      switchFolderModalTab: (tab) => { logs.tabsSwitched.push(tab); },
      setPickerTriggerVisible: () => {},
      renderFolderBrowserState: (viewState) => { logs.browserRenders.push(viewState); }
    });

    const authService = createAuthService({
      getGoogleOAuth2: () => ({
        initTokenClient: (cfg) => ({
          requestAccessToken: () => cfg.callback({ access_token: 'tok-ok', expires_in: 3600 })
        })
      })
    });

    const driveApi = DriveApi.createDriveApiClient({
      getAccessToken: () => authService.getValidToken(),
      fetchImpl: async (url) => {
        if (url.includes('/drive/v3/drives')) {
          return createMockResponse(200, {
            drives: [{ id: 'drv_team', name: 'Team Drive' }]
          });
        }
        if (url.includes('/files/sub_target?')) {
          return createMockResponse(200, {
            id: 'sub_target',
            name: 'Target Subfolder',
            mimeType: 'application/vnd.google-apps.folder',
            trashed: false
          });
        }
        const parsed = new URL(url);
        const q = parsed.searchParams.get('q') || '';
        const pageToken = parsed.searchParams.get('pageToken') || '';
        if (q.includes("'root' in parents")) {
          if (pageToken === 'p2') {
            return createMockResponse(200, {
              files: [{ id: 'my_2', name: 'My Folder 2', driveId: '' }]
            });
          }
          return createMockResponse(200, {
            nextPageToken: 'p2',
            files: [{ id: 'my_1', name: 'My Folder 1', driveId: '' }]
          });
        }
        if (q.includes("'drv_team' in parents")) {
          return createMockResponse(200, {
            files: [{ id: 'sub_target', name: 'Target Subfolder', driveId: 'drv_team' }]
          });
        }
        if (q.includes("name contains 'Target'")) {
          return createMockResponse(200, {
            files: [{ id: 'sub_target', name: 'Target Subfolder', driveId: 'drv_team' }]
          });
        }
        if (q.includes("'sub_target' in parents") && q.includes("mimeType != 'application/vnd.google-apps.folder'")) {
          return createMockResponse(200, {
            files: [{ id: 'html_a', name: 'report.html', size: '128', modifiedTime: '2026-07-01T00:00:00Z', mimeType: 'text/html', trashed: false }]
          });
        }
        return createMockResponse(200, { files: [] });
      }
    });

    let pickerBuilt = false;
    const mockPickerNs = {
      ViewId: { FOLDERS: 'FOLDERS' },
      Feature: { SUPPORT_DRIVES: 'SUPPORT_DRIVES' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      Document: { ID: 'id', NAME: 'name' },
      DocsView: function () {
        this.setIncludeFolders = () => this;
        this.setSelectFolderEnabled = () => this;
      },
      PickerBuilder: function () {
        this.addView = () => this;
        this.enableFeature = () => this;
        this.setOAuthToken = () => this;
        this.setDeveloperKey = () => this;
        this.setAppId = () => this;
        this.setSize = () => this;
        this.setLocale = () => this;
        this.setOrigin = () => this;
        this.setCallback = () => this;
        this.build = () => {
          pickerBuilt = true;
          return { setVisible: () => {}, dispose: () => {} };
        };
      }
    };

    const pickerService = createPickerService({
      getGapi: () => ({ load: (_n, opt) => opt.callback() }),
      getGooglePicker: () => mockPickerNs
    });

    const controller = createAppController({
      configProvider: AppConfigProvider,
      storage: store,
      storageKeys: STORAGE_KEYS,
      folderResolver: FolderResolver,
      authService,
      driveApi,
      pickerService,
      ui
    });

    controller.init();
    await authService.signIn();
    await new Promise((r) => setTimeout(r, 20));

    // 初期未設定で統合モーダルが自動で開き、Google Picker はいきなり起動しないこと
    assert.strictEqual(pickerBuilt, false, '初期起動で Google Picker が排他起動されないこと');
    assert.strictEqual(logs.selectorOpened.length, 1);
    assert.strictEqual(logs.selectorOpened[0].initialTab, 'browser');
    assert.strictEqual(logs.selectorOpened[0].pickerAvailable, true);
    assert.strictEqual(controller.getFolderBrowserState().items.length, 1);
    assert.strictEqual(controller.getFolderBrowserState().nextPageToken, 'p2');

    // さらに読み込むでページング結合
    await controller.loadMoreBrowserFolders();
    assert.strictEqual(controller.getFolderBrowserState().items.length, 2);
    assert.strictEqual(controller.getFolderBrowserState().nextPageToken, null);

    // 共有ドライブへ切替 -> ドライブへドリルダウン -> サブフォルダへ移動 -> パンくず復帰
    await controller.switchFolderBrowserSpace('SHARED_DRIVES');
    assert.strictEqual(controller.getFolderBrowserState().items[0].id, 'drv_team');
    await controller.openFolderBrowserItem(controller.getFolderBrowserState().items[0]);
    assert.strictEqual(controller.getFolderBrowserState().items[0].id, 'sub_target');
    assert.strictEqual(logs.browserRenders[logs.browserRenders.length - 1].canSelectCurrentFolder, true);

    await controller.navigateFolderBreadcrumb(0);
    assert.strictEqual(controller.getFolderBrowserState().items[0].id, 'drv_team');
    assert.strictEqual(logs.browserRenders[logs.browserRenders.length - 1].canSelectCurrentFolder, false);

    // フォルダ名検索 -> 確定して HTML 一覧取得
    await controller.searchBrowserFolders('Target');
    assert.strictEqual(controller.getFolderBrowserState().items[0].id, 'sub_target');
    await controller.confirmBrowserFolder(controller.getFolderBrowserState().items[0]);

    assert.ok(logs.selectorClosed >= 1);
    assert.strictEqual(controller.getCurrentFolderId(), 'sub_target');
    assert.strictEqual(logs.renderedFiles.length, 1);
    assert.strictEqual(logs.renderedFiles[0].name, 'report.html');
  });

  it('統合フォルダ選択モーダル: Google Picker 補助利用 (CANCEL / Fallback / PICKED) 及び 401 自動再開', async () => {
    const store = createMockStorage();
    store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({
      clientId: 'cid-1',
      apiKey: 'key-1',
      appId: '123456',
      defaultFolderId: 'existing_folder'
    }));

    const logs = createFreshLogs();
    logs.selectorOpened = 0;
    logs.selectorClosed = 0;
    logs.tabsSwitched = [];

    const ui = Object.assign(createTrackingMockUi(logs), {
      openFolderSelectorModal: () => { logs.selectorOpened++; },
      closeFolderSelectorModal: () => { logs.selectorClosed++; },
      switchFolderModalTab: (tab) => { logs.tabsSwitched.push(tab); },
      setPickerTriggerVisible: () => {},
      renderFolderBrowserState: () => {}
    });

    const authService = createAuthService({
      getGoogleOAuth2: () => ({
        initTokenClient: (cfg) => ({
          requestAccessToken: () => cfg.callback({ access_token: 'tok-ok', expires_in: 3600 })
        })
      })
    });

    let forceBrowse401 = false;
    const driveApi = DriveApi.createDriveApiClient({
      getAccessToken: () => authService.getValidToken(),
      fetchImpl: async (url) => {
        if (url.includes('/files/existing_folder?')) {
          return createMockResponse(200, { id: 'existing_folder', name: 'Existing', mimeType: 'application/vnd.google-apps.folder', trashed: false });
        }
        if (url.includes('/files/picked_by_picker?')) {
          return createMockResponse(200, { id: 'picked_by_picker', name: 'Picked Dir', mimeType: 'application/vnd.google-apps.folder', trashed: false });
        }
        if (forceBrowse401) {
          const parsedQ = new URL(url).searchParams.get('q') || '';
          if (parsedQ.includes("mimeType = 'application/vnd.google-apps.folder'")) {
            return createMockResponse(401, { error: { message: 'Expired' } });
          }
        }
        return createMockResponse(200, { files: [] });
      }
    });

    let pickerLoadedFlag = true;
    let latestPickerCb = null;
    const mockPickerNs = {
      ViewId: { FOLDERS: 'FOLDERS' },
      Feature: { SUPPORT_DRIVES: 'SUPPORT_DRIVES' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      Document: { ID: 'id', NAME: 'name' },
      DocsView: function () {
        this.setIncludeFolders = () => this;
        this.setSelectFolderEnabled = () => this;
      },
      PickerBuilder: function () {
        this.addView = () => this;
        this.enableFeature = () => this;
        this.setOAuthToken = () => this;
        this.setDeveloperKey = () => this;
        this.setAppId = () => this;
        this.setSize = () => this;
        this.setLocale = () => this;
        this.setOrigin = () => this;
        this.setCallback = (cb) => { latestPickerCb = cb; return this; };
        this.build = () => ({ setVisible: () => {}, dispose: () => {} });
      }
    };

    const pickerService = createPickerService({
      getGapi: () => ({ load: (_n, opt) => opt.callback() }),
      getGooglePicker: () => (pickerLoadedFlag ? mockPickerNs : null)
    });

    const controller = createAppController({
      configProvider: AppConfigProvider,
      storage: store,
      storageKeys: STORAGE_KEYS,
      folderResolver: FolderResolver,
      authService,
      driveApi,
      pickerService,
      ui
    });

    controller.init();
    await authService.signIn();
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(controller.getCurrentFolderId(), 'existing_folder');

    // 統合モーダルを開き、Picker CANCEL -> モーダル維持 & currentFolderId 維持
    await controller.openFolderSelection();
    const closedBeforeCancel = logs.selectorClosed;
    controller.openGooglePickerFromModal();
    latestPickerCb({ action: 'cancel' });
    assert.strictEqual(logs.selectorClosed, closedBeforeCancel, 'Picker CANCEL 時にモーダルが維持されること');
    assert.strictEqual(controller.getCurrentFolderId(), 'existing_folder');

    // Picker が利用不可で onFallbackToManual -> manual タブへ切替
    pickerLoadedFlag = false;
    // pickerService のキャッシュ済み pickerApiLoaded を避けるため別サービスでも検証可能だが、PickerBuilder 例外で再現
    mockPickerNs.PickerBuilder = function () { throw new Error('3PC blocked'); };
    pickerLoadedFlag = true;
    controller.openGooglePickerFromModal();
    assert.strictEqual(logs.tabsSwitched[logs.tabsSwitched.length - 1], 'manual');

    // Picker PICKED -> モーダル閉鎖 & applyFolder
    mockPickerNs.PickerBuilder = function () {
      this.addView = () => this;
      this.enableFeature = () => this;
      this.setOAuthToken = () => this;
      this.setDeveloperKey = () => this;
      this.setAppId = () => this;
      this.setSize = () => this;
      this.setLocale = () => this;
      this.setOrigin = () => this;
      this.setCallback = (cb) => { latestPickerCb = cb; return this; };
      this.build = () => ({ setVisible: () => {}, dispose: () => {} });
    };
    controller.openGooglePickerFromModal();
    latestPickerCb({ action: 'picked', docs: [{ id: 'picked_by_picker', name: 'Picked Dir' }] });
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(controller.getCurrentFolderId(), 'picked_by_picker');
    assert.ok(logs.selectorClosed > closedBeforeCancel);

    // ブラウズ中 401 -> モーダル即閉鎖 -> EXPIRED -> 再認証で openFolderSelection 自動再開
    const openedBefore401 = logs.selectorOpened;
    const closedBefore401 = logs.selectorClosed;
    forceBrowse401 = true;
    await controller.openFolderSelection();
    assert.ok(logs.selectorClosed > closedBefore401, '401 時に統合モーダルが即座に閉じられること');
    assert.strictEqual(authService.getState().status, 'EXPIRED');

    forceBrowse401 = false;
    await authService.signIn();
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(authService.getState().status, 'AUTHENTICATED');
    assert.ok(logs.selectorOpened > openedBefore401 + 1, '再認証後に統合モーダルが自動再開されること');
  });

  it('SHARED_WITH_ME 空間ドリルダウンと confirmCurrentBrowserFolder（ルート/検索中拒否・サブ階層確定）', async () => {
    const store = createMockStorage();
    store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({ clientId: 'cid-1' }));
    const logs = createFreshLogs();

    const ui = Object.assign(createTrackingMockUi(logs), {
      openFolderSelectorModal: () => {},
      closeFolderSelectorModal: () => {},
      switchFolderModalTab: () => {},
      setPickerTriggerVisible: () => {},
      renderFolderBrowserState: () => {}
    });

    const authService = createAuthService({
      getGoogleOAuth2: () => ({
        initTokenClient: (cfg) => ({
          requestAccessToken: () => cfg.callback({ access_token: 'tok-ok', expires_in: 3600 })
        })
      })
    });

    const capturedQs = [];
    const driveApi = DriveApi.createDriveApiClient({
      getAccessToken: () => authService.getValidToken(),
      fetchImpl: async (url) => {
        if (url.includes('/files/shared_child?')) {
          return createMockResponse(200, { id: 'shared_child', name: 'Shared Child', mimeType: 'application/vnd.google-apps.folder', trashed: false });
        }
        const q = new URL(url).searchParams.get('q') || '';
        capturedQs.push(q);
        if (q.includes('sharedWithMe = true')) {
          return createMockResponse(200, {
            files: [{ id: 'shared_top', name: 'Shared Top', driveId: '' }]
          });
        }
        if (q.includes("'shared_top' in parents") && q.includes("mimeType = 'application/vnd.google-apps.folder'")) {
          return createMockResponse(200, {
            files: [{ id: 'shared_child', name: 'Shared Child', driveId: '' }]
          });
        }
        if (q.includes("'shared_child' in parents") && q.includes("mimeType = 'application/vnd.google-apps.folder'")) {
          return createMockResponse(200, { files: [] });
        }
        if (q.includes("name contains 'Shared'")) {
          return createMockResponse(200, {
            files: [{ id: 'shared_child', name: 'Shared Child', driveId: '' }]
          });
        }
        if (q.includes("'shared_child' in parents") && q.includes("mimeType != 'application/vnd.google-apps.folder'")) {
          return createMockResponse(200, {
            files: [{ id: 'doc_1', name: 'shared.html', size: '64', modifiedTime: '2026-08-01T00:00:00Z', mimeType: 'text/html', trashed: false }]
          });
        }
        return createMockResponse(200, { files: [] });
      }
    });

    const controller = createAppController({
      configProvider: AppConfigProvider,
      storage: store,
      storageKeys: STORAGE_KEYS,
      folderResolver: FolderResolver,
      authService,
      driveApi,
      pickerService: createPickerService({ getGapi: () => null, getGooglePicker: () => null }),
      ui
    });

    controller.init();
    await authService.signIn();
    await new Promise((r) => setTimeout(r, 20));

    // MY_DRIVE ルートでは confirmCurrentBrowserFolder が拒否されること
    const rootConfirm = await controller.confirmCurrentBrowserFolder();
    assert.strictEqual(rootConfirm.success, false);
    assert.strictEqual(rootConfirm.errorCode, 'INVALID_INPUT');

    // SHARED_WITH_ME に切り替え -> ルートは sharedWithMe = true クエリ、かつ確定不可
    await controller.switchFolderBrowserSpace('SHARED_WITH_ME');
    assert.ok(capturedQs.some((q) => q.includes('sharedWithMe = true')));
    assert.strictEqual((await controller.confirmCurrentBrowserFolder()).errorCode, 'INVALID_INPUT');

    // 共有アイテムをドリルダウン -> '<id>' in parents クエリへ切り替わること
    await controller.openFolderBrowserItem({ id: 'shared_top', name: 'Shared Top', driveId: '' });
    assert.ok(capturedQs.some((q) => q.includes("'shared_top' in parents")));
    await controller.openFolderBrowserItem({ id: 'shared_child', name: 'Shared Child', driveId: '' });
    assert.strictEqual(controller.getFolderBrowserState().breadcrumbs.length, 3);

    // 検索中は confirmCurrentBrowserFolder が拒否されること
    await controller.searchBrowserFolders('Shared');
    const searchConfirm = await controller.confirmCurrentBrowserFolder();
    assert.strictEqual(searchConfirm.success, false);
    assert.strictEqual(searchConfirm.errorCode, 'INVALID_INPUT');

    // 空検索で階層へ戻し、confirmCurrentBrowserFolder で現在階層 (shared_child) を確定できること
    await controller.searchBrowserFolders('');
    await controller.confirmCurrentBrowserFolder();
    assert.strictEqual(controller.getCurrentFolderId(), 'shared_child');
    assert.strictEqual(logs.renderedFiles.length, 1);
    assert.strictEqual(logs.renderedFiles[0].name, 'shared.html');
  });

  it('DomUiAdapter: 統合モーダルのクラス切替・flex-shrink-0・scrollTop リセットが正しく機能すること', () => {
    function makeClassList(initialClasses = []) {
      const set = new Set(initialClasses);
      return {
        add: (...names) => names.forEach((n) => set.add(n)),
        remove: (...names) => names.forEach((n) => set.delete(n)),
        contains: (n) => set.has(n)
      };
    }
    function makeMockEl(initialClasses = []) {
      return {
        innerHTML: '',
        textContent: '',
        value: '',
        disabled: false,
        focus: () => {},
        classList: makeClassList(initialClasses)
      };
    }

    const scrollParent = { scrollTop: 180 };
    const elements = new Map();
    elements.set('manualFolderModal', makeMockEl(['hidden']));
    elements.set('folderBrowserPanel', makeMockEl());
    elements.set('folderManualPanel', makeMockEl(['hidden']));
    elements.set('selectCurrentFolderBtn', makeMockEl(['opacity-50', 'cursor-not-allowed']));
    elements.set('submitFolderBtn', makeMockEl(['hidden']));
    elements.set('openGooglePickerWrap', makeMockEl(['hidden']));
    elements.set('folderLoadMoreWrap', makeMockEl(['hidden']));
    elements.set('clearFolderSearchBtn', makeMockEl(['hidden']));
    elements.set('folderBrowserList', Object.assign(makeMockEl(), { parentElement: scrollParent }));

    const mockDoc = {
      getElementById: (id) => {
        if (!elements.has(id)) {
          elements.set(id, makeMockEl());
        }
        return elements.get(id);
      },
      querySelectorAll: () => []
    };

    const domUi = createDomUiAdapter(mockDoc);

    // モーダル開く (browser タブ + pickerAvailable: true)
    domUi.openFolderSelectorModal({ initialTab: 'browser', initialManualValue: 'f_init', pickerAvailable: true });
    assert.strictEqual(mockDoc.getElementById('manualFolderModal').classList.contains('hidden'), false);
    assert.strictEqual(mockDoc.getElementById('folderBrowserPanel').classList.contains('hidden'), false);
    assert.strictEqual(mockDoc.getElementById('folderManualPanel').classList.contains('hidden'), true);
    assert.strictEqual(mockDoc.getElementById('selectCurrentFolderBtn').classList.contains('hidden'), false);
    assert.strictEqual(mockDoc.getElementById('submitFolderBtn').classList.contains('hidden'), true);
    assert.strictEqual(mockDoc.getElementById('openGooglePickerWrap').classList.contains('hidden'), false);

    // manual タブへ切替 -> パネルとフッター確定ボタンが切り替わること
    domUi.switchFolderModalTab('manual');
    assert.strictEqual(mockDoc.getElementById('folderBrowserPanel').classList.contains('hidden'), true);
    assert.strictEqual(mockDoc.getElementById('folderManualPanel').classList.contains('hidden'), false);
    assert.strictEqual(mockDoc.getElementById('selectCurrentFolderBtn').classList.contains('hidden'), true);
    assert.strictEqual(mockDoc.getElementById('submitFolderBtn').classList.contains('hidden'), false);

    // setPickerTriggerVisible(false)
    domUi.setPickerTriggerVisible(false);
    assert.strictEqual(mockDoc.getElementById('openGooglePickerWrap').classList.contains('hidden'), true);

    // isLoading: true で scrollTop が 0 にリセットされること
    domUi.renderFolderBrowserState({
      space: 'MY_DRIVE',
      breadcrumbs: [{ id: 'root', name: 'マイドライブ', driveId: '' }],
      items: [],
      hasMore: false,
      isLoading: true,
      isLoadingMore: false,
      errorMessage: '',
      searchKeyword: '',
      canSelectCurrentFolder: false
    });
    assert.strictEqual(scrollParent.scrollTop, 0, '新規読み込み時に scrollTop が 0 にリセットされること');

    // パンくず末尾 span と検索結果 span に flex-shrink-0 が含まれること、canSelectCurrentFolder で disabled/opacity-50 制御されること
    domUi.renderFolderBrowserState({
      space: 'MY_DRIVE',
      breadcrumbs: [
        { id: 'root', name: 'マイドライブ', driveId: '' },
        { id: 'sub_1', name: '長いサブフォルダ名', driveId: '' }
      ],
      items: [{ id: 'c1', name: 'Child', driveId: '', isSharedDrive: false }],
      hasMore: true,
      isLoading: false,
      isLoadingMore: false,
      errorMessage: '',
      searchKeyword: '',
      canSelectCurrentFolder: true
    });
    const crumbHtml = mockDoc.getElementById('folderBreadcrumbs').innerHTML;
    assert.ok(crumbHtml.includes('truncate flex-shrink-0'), '末尾パンくず span に flex-shrink-0 が付与されていること');
    assert.strictEqual(mockDoc.getElementById('selectCurrentFolderBtn').disabled, false);
    assert.strictEqual(mockDoc.getElementById('selectCurrentFolderBtn').classList.contains('opacity-50'), false);
    assert.strictEqual(mockDoc.getElementById('folderLoadMoreWrap').classList.contains('hidden'), false);

    domUi.renderFolderBrowserState({
      space: 'MY_DRIVE',
      breadcrumbs: [{ id: 'root', name: 'マイドライブ', driveId: '' }],
      items: [],
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
      errorMessage: '',
      searchKeyword: '検索語',
      canSelectCurrentFolder: false
    });
    const searchCrumbHtml = mockDoc.getElementById('folderBreadcrumbs').innerHTML;
    assert.ok(searchCrumbHtml.includes('text-slate-500 flex-shrink-0'), '検索結果ラベル span に flex-shrink-0 が付与されていること');
    assert.ok(searchCrumbHtml.includes('truncate flex-shrink-0'), '検索語 span に flex-shrink-0 が付与されていること');
    assert.strictEqual(mockDoc.getElementById('selectCurrentFolderBtn').disabled, true);
    assert.strictEqual(mockDoc.getElementById('selectCurrentFolderBtn').classList.contains('opacity-50'), true);
  });
});

// ====================================================
// テストランナー実行
// ====================================================
(async () => {
  for (const item of testQueue) {
    if (item.type === 'suite') {
      console.log(`\n=== ${item.name} ===`);
    } else {
      try {
        await item.fn();
        console.log(`  ✓ ${item.desc}`);
        passCount++;
      } catch (err) {
        console.error(`  ✗ ${item.desc}`);
        console.error(`    ${err.stack || err.message}`);
        failCount++;
      }
    }
  }

  console.log('\n========================================');
  console.log(`テスト結果: 全 ${passCount + failCount} 件中 ${passCount} 件合格, ${failCount} 件失敗`);
  console.log('========================================');

  process.exit(failCount > 0 ? 1 : 0);
})();
