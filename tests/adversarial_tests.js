/**
 * 敵対的・セキュリティ・回帰検証スクリプト (Adversarial Testing Suite)
 * 設計書・実装計画書 Section 4.3 および BUG-GP-001 〜 BUG-GP-010 の障害モードを検証する
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const FolderResolver = require(path.join(ROOT_DIR, 'js/folder-resolver.js'));
const { STORAGE_KEYS } = require(path.join(ROOT_DIR, 'js/storage.js'));
const AppConfigProvider = require(path.join(ROOT_DIR, 'js/config.js'));
const { createAuthService } = require(path.join(ROOT_DIR, 'js/auth.js'));
const DriveApi = require(path.join(ROOT_DIR, 'js/drive-api.js'));
const { createPickerService } = require(path.join(ROOT_DIR, 'js/picker.js'));
const { createAppController, escapeHtml } = require(path.join(ROOT_DIR, 'js/app.js'));

let passCount = 0;
let failCount = 0;
const issueList = [];
const cases = [];

function testCase(id, title, fn) {
  cases.push({ id, title, fn });
}

function createMockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

function createMemoryStorage() {
  const map = new Map();
  return {
    _map: map,
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => { map.set(k, String(v)); return true; },
    remove: (k) => { map.delete(k); return true; },
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); }
  };
}

function createNoopUi(overrides = {}) {
  return Object.assign({
    showErrorToast: () => {},
    showSuccessToast: () => {},
    showInfoToast: () => {},
    hideToast: () => {},
    setStatus: () => {},
    switchMobileView: () => {},
    getCurrentMobileView: () => 'list',
    renderFileList: () => {},
    highlightActiveFile: () => {},
    setFolderName: () => {},
    setFileCountText: () => {},
    getSearchQuery: () => '',
    clearSearchInput: () => {},
    showPreviewLoading: () => {},
    hidePreviewLoading: () => {},
    restorePreviewHeader: () => {},
    setPreviewContent: () => {},
    resetPreview: () => {},
    clearListArea: () => {},
    renderAuthState: () => {},
    openManualFolderModal: () => {},
    closeManualFolderModal: () => {},
    getManualFolderInput: () => '',
    openSettingsModal: () => {},
    closeSettingsModal: () => {},
    showSettingsError: () => {},
    getSettingsFormValues: () => ({})
  }, overrides);
}

// -----------------------------------------------------------
// 観点1: インジェクション・XSS・入力境界検証
// -----------------------------------------------------------
testCase('ADV-INJ-001', 'Drive クエリインジェクション（特殊文字・改行・制御文字・日本語・絵文字）の無害化', async () => {
  const capturedUrls = [];
  const client = DriveApi.createDriveApiClient({
    getAccessToken: () => 'tok-test',
    fetchImpl: async (url) => {
      capturedUrls.push(url);
      if (url.includes('/files/folder_safe?')) {
        return createMockResponse(200, {
          id: 'folder_safe',
          name: 'Safe',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false
        });
      }
      return createMockResponse(200, { files: [] });
    }
  });

  const payload = "a' or 1=1 \\\n\r\tテスト 🚀";
  const escaped = DriveApi.sanitizeSearchQuery(payload);
  assert.ok(escaped.includes("\\'"), 'シングルクォートがエスケープされること');
  assert.ok(escaped.includes('\\\\'), 'バックスラッシュがエスケープされること');
  assert.strictEqual(/[\r\n\t]/.test(escaped), false, '改行・タブが空白正規化されること');

  const res = await client.searchHtmlFiles(payload, 'folder_safe');
  assert.strictEqual(res.success, true);

  const parsed = new URL(capturedUrls[1]);
  const q = parsed.searchParams.get('q');
  assert.ok(q.includes("name contains 'a\\' or 1=1 \\\\ テスト 🚀'"));
});

testCase('ADV-XSS-001', 'URL パラメータ XSS (?folderId=\';alert(1);// 等) の無害化', () => {
  assert.strictEqual(FolderResolver.getClientUrlFolderId("?folderId=';alert(1);//"), '');
  assert.strictEqual(FolderResolver.getClientUrlFolderId('?f=abc%0Aalert(1)'), '');
  assert.strictEqual(FolderResolver.getClientUrlFolderId('?folderId=<script>alert(1)</script>'), '');
});

testCase('ADV-XSS-002', 'ファイル名 XSS (<img src=x onerror=alert(1)>.html) の HTML エスケープ', () => {
  const maliciousName = '<img src=x onerror=alert(1)>.html';
  const escaped = escapeHtml(maliciousName);
  assert.strictEqual(escaped.includes('<'), false);
  assert.strictEqual(escaped.includes('>'), false);
  assert.strictEqual(escaped, '&lt;img src=x onerror=alert(1)&gt;.html');
});

testCase('ADV-INP-001', '長大入力・不正文字混入 Drive URL の拒否', () => {
  assert.throws(() => FolderResolver.sanitizeFolderId('a'.repeat(257)), /長すぎます/);
  assert.throws(() => FolderResolver.sanitizeFolderId('a'.repeat(10000)), /長すぎます/);
  assert.throws(() => FolderResolver.sanitizeFolderId('https://drive.google.com/drive/folders/abc!def'), /無効なフォルダID形式/);
  assert.throws(() => FolderResolver.sanitizeFolderId('https://drive.google.com/open?id=abc;drop'), /無効なフォルダID形式/);
});

// -----------------------------------------------------------
// 観点2: トークン非永続化・機密非露出監査 & 認証競合 (BUG-GP-001/003/005)
// -----------------------------------------------------------
testCase('ADV-SEC-001', 'サインイン後にトークンが localStorage / AuthState / window へ一切漏洩しないこと', async () => {
  const secretToken = 'ya29.super-secret-adversarial-token-999';
  const mockStorage = createMemoryStorage();
  const prevWindow = global.window;
  const mockWindow = { localStorage: mockStorage };
  global.window = mockWindow;

  try {
    const auth = createAuthService({
      getGoogleOAuth2: () => ({
        initTokenClient: (cfg) => ({
          requestAccessToken: () => cfg.callback({ access_token: secretToken, expires_in: 3600 })
        })
      })
    });
    auth.init('cid-test', () => {});
    await auth.signIn();

    for (const [k, v] of mockStorage._map.entries()) {
      assert.strictEqual(k.includes(secretToken), false);
      assert.strictEqual(v.includes(secretToken), false);
    }

    const stateJson = JSON.stringify(auth.getState());
    assert.strictEqual(stateJson.includes(secretToken), false);

    assert.strictEqual(JSON.stringify(mockWindow).includes(secretToken), false);
    for (const key of Object.keys(globalThis)) {
      const val = globalThis[key];
      if (typeof val === 'string') {
        assert.strictEqual(val.includes(secretToken), false);
      }
    }
  } finally {
    global.window = prevWindow;
  }
});

testCase('ADV-SEC-002', '全配信静的ファイルに client_secret や GAS テンプレートが残存しないこと', () => {
  const targets = [
    'index.html',
    'config.js',
    'js/storage.js',
    'js/folder-resolver.js',
    'js/config.js',
    'js/auth.js',
    'js/drive-api.js',
    'js/picker.js',
    'js/app.js'
  ];

  targets.forEach((rel) => {
    const content = fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
    assert.strictEqual(/client_secret/i.test(content), false, `${rel} に client_secret 記述が含まれないこと`);
    assert.strictEqual(content.includes('google.script'), false, `${rel} に google.script が含まれないこと`);
  });
});

testCase('ADV-AUTH-001', 'BUG-GP-001: GIS ロード待機中に reinit("") / signOut() すると待機中断され後着ライブラリで起動しないこと', async () => {
  let gisLoaded = false;
  let initTokenClientCalls = 0;
  let requestCalls = 0;

  const auth = createAuthService({
    waitForGisTimeoutMs: 1000,
    getGoogleOAuth2: () => {
      if (!gisLoaded) return null;
      return {
        initTokenClient: (cfg) => {
          initTokenClientCalls++;
          return {
            requestAccessToken: () => {
              requestCalls++;
              cfg.callback({ access_token: 'ghost-token', expires_in: 3600 });
            }
          };
        }
      };
    }
  });

  auth.init('cid-initial', () => {});
  const signInPromise = auth.signIn().catch((err) => err);

  // GIS 到着前に設定削除（reinit('')）
  auth.reinit('');
  assert.strictEqual(auth.getState().status, 'UNCONFIGURED');

  // その後 GIS がロードされても古い signIn は絶対に起動しないこと
  gisLoaded = true;
  const result = await signInPromise;
  assert.ok(result instanceof Error, '中断された signIn は Error で reject されること');
  await new Promise((r) => setTimeout(r, 150));

  assert.strictEqual(initTokenClientCalls, 0, 'initTokenClient が呼ばれないこと');
  assert.strictEqual(requestCalls, 0, 'requestAccessToken が呼ばれないこと');
  assert.strictEqual(auth.getState().status, 'UNCONFIGURED');
  assert.strictEqual(auth.getValidToken(), null);
});

testCase('ADV-AUTH-002', 'BUG-GP-003: SIGNED_OUT 状態でのデバウンス/検索発火で EXPIRED へ誤遷移しないこと', async () => {
  const store = createMemoryStorage();
  store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({ clientId: 'cid-1', defaultFolderId: 'f1' }));

  const authService = createAuthService({
    getGoogleOAuth2: () => ({
      initTokenClient: (cfg) => ({
        requestAccessToken: () => cfg.callback({ access_token: 'tok-1', expires_in: 3600 })
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
    ui: createNoopUi()
  });

  controller.init();
  await authService.signIn();

  // デバウンス検索予約直後にサインアウト
  controller.scheduleSearch('delayed_query', 30);
  controller.handleAuthAction(); // サインアウト
  assert.strictEqual(authService.getState().status, 'SIGNED_OUT');

  // タイマー経過後も SIGNED_OUT のままであること
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(authService.getState().status, 'SIGNED_OUT');

  // 直接 executeSearch を呼んでも EXPIRED に遷移しないこと
  await controller.executeSearch('manual');
  assert.strictEqual(authService.getState().status, 'SIGNED_OUT');
});

testCase('ADV-AUTH-003', 'BUG-GP-005: EXPIRED -> AUTHENTICATING 中の reinit で前アカウント状態がクリアされ旧ポップアップ干渉を防ぐこと', async () => {
  const store = createMemoryStorage();
  store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({ clientId: 'cid-A', defaultFolderId: 'folder_A' }));

  const capturedCallbacks = [];
  let requestCount = 0;
  const authService = createAuthService({
    getGoogleOAuth2: () => ({
      initTokenClient: (cfg) => {
        capturedCallbacks.push(cfg);
        return {
          requestAccessToken: () => {
            requestCount++;
            if (requestCount === 1) {
              cfg.callback({ access_token: 'tok-A', expires_in: 3600 });
            }
          }
        };
      },
      revoke: (_tok, cb) => { if (cb) cb(); }
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
      fetchImpl: async (url) => {
        if (url.includes('/files/folder_A?')) {
          return createMockResponse(200, { id: 'folder_A', name: 'Folder A', mimeType: 'application/vnd.google-apps.folder', trashed: false });
        }
        return createMockResponse(200, { files: [] });
      }
    }),
    pickerService: createPickerService({ getGapi: () => null, getGooglePicker: () => null }),
    ui: createNoopUi()
  });

  controller.init();
  await authService.signIn();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(controller.getCurrentFolderId(), 'folder_A');

  // EXPIRED -> AUTHENTICATING 状態へ（マイクロタスク進めて tokenClient 生成済み・応答待機状態にする）
  authService.handleUnauthorized();
  assert.strictEqual(authService.getState().status, 'EXPIRED');
  const pendingSignInA = authService.signIn().catch((e) => e);
  await Promise.resolve();
  assert.strictEqual(authService.getState().status, 'AUTHENTICATING');

  // AUTHENTICATING のまま設定変更（cid-B へ変更 -> reinit）
  controller.saveSettings({ clientId: 'cid-B' });
  await pendingSignInA;

  assert.strictEqual(authService.getState().status, 'SIGNED_OUT');
  assert.strictEqual(controller.getCurrentFolderId(), '', '旧フォルダIDがクリアされていること');

  // 新クライアント cid-B でサインイン開始中に、旧クライアント cid-A のポップアップが閉じたイベントが遅延発火しても干渉しないこと
  const pendingSignInB = authService.signIn();
  await Promise.resolve();
  assert.strictEqual(authService.getState().status, 'AUTHENTICATING');
  assert.strictEqual(capturedCallbacks.length, 2, 'cid-B 用に新しい tokenClient が生成されていること');
  capturedCallbacks[0].error_callback({ type: 'popup_closed' });
  assert.strictEqual(authService.getState().status, 'AUTHENTICATING', '旧クライアントの error_callback で新認証が中断されないこと');

  capturedCallbacks[capturedCallbacks.length - 1].callback({ access_token: 'tok-B', expires_in: 3600 });
  const tokB = await pendingSignInB;
  assert.strictEqual(tokB, 'tok-B');
  assert.strictEqual(authService.getState().status, 'AUTHENTICATED');
});

// -----------------------------------------------------------
// 観点3: ページネーション無限ループ・キャンセル・並行競合制御
// -----------------------------------------------------------
testCase('ADV-PAG-001', '異常な nextPageToken ループに対して maxPages / 同一トークン検出で必ず停止すること', async () => {
  let pageHits = 0;
  const client = DriveApi.createDriveApiClient({
    getAccessToken: () => 'tok-test',
    maxPages: 3,
    fetchImpl: async (url) => {
      if (url.includes('/files/folder_loop?')) {
        return createMockResponse(200, {
          id: 'folder_loop',
          name: 'Loop',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false
        });
      }
      pageHits++;
      return createMockResponse(200, {
        nextPageToken: 'token_' + pageHits,
        files: [{ id: 'f_' + pageHits, name: `p${pageHits}.html`, size: '10', modifiedTime: '2026-01-01T00:00:00Z', mimeType: 'text/html', trashed: false }]
      });
    }
  });

  const res = await client.getHtmlFileList('folder_loop');
  assert.strictEqual(res.success, true);
  assert.strictEqual(pageHits, 3);
  assert.strictEqual(res.truncated, true);
});

testCase('ADV-CON-001', 'ページング途中での検索キャンセルが即座に中断されること', async () => {
  let cancelled = false;
  let listCallCount = 0;
  const client = DriveApi.createDriveApiClient({
    getAccessToken: () => 'tok-test',
    fetchImpl: async (url) => {
      if (url.includes('/files/folder_c?')) {
        return createMockResponse(200, {
          id: 'folder_c',
          name: 'Cancel',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false
        });
      }
      listCallCount++;
      cancelled = true;
      return createMockResponse(200, {
        nextPageToken: 'page_2',
        files: [{ id: 'f1', name: 'a.html', size: '10', modifiedTime: '2026-01-01T00:00:00Z', mimeType: 'text/html', trashed: false }]
      });
    }
  });

  const res = await client.getHtmlFileList('folder_c', { isCancelled: () => cancelled });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.cancelled, true);
  assert.strictEqual(listCallCount, 1);
});

testCase('ADV-CON-002', 'ファイルプレビュー競合（A遅延中にB選択）で古いAの応答がBを上書きしないこと', async () => {
  const store = createMemoryStorage();
  store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({ clientId: 'cid-1' }));

  const previewUpdates = [];
  let resolveFileA;
  const authService = createAuthService({
    getGoogleOAuth2: () => ({
      initTokenClient: (cfg) => ({
        requestAccessToken: () => cfg.callback({ access_token: 'tok-race', expires_in: 3600 })
      })
    })
  });

  const driveApi = DriveApi.createDriveApiClient({
    getAccessToken: () => authService.getValidToken(),
    fetchImpl: (url) => {
      if (url.includes('/files/file_A?alt=media')) {
        return new Promise((resolve) => {
          resolveFileA = () => resolve(createMockResponse(200, '<h1>OLD_A</h1>'));
        });
      }
      if (url.includes('/files/file_B?alt=media')) {
        return Promise.resolve(createMockResponse(200, '<h1>NEW_B</h1>'));
      }
      return Promise.resolve(createMockResponse(200, { files: [] }));
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
    ui: createNoopUi({ setPreviewContent: (html) => previewUpdates.push(html) })
  });

  controller.init();
  await authService.signIn();

  const promiseA = controller.selectFile({ id: 'file_A', name: 'A.html' });
  const promiseB = controller.selectFile({ id: 'file_B', name: 'B.html' });
  await promiseB;
  resolveFileA();
  await promiseA;

  assert.deepStrictEqual(previewUpdates, ['<h1>NEW_B</h1>']);
});

testCase('ADV-CON-003', 'BUG-GP-002: プレビュー取得中に applyFolder でフォルダ切替した場合、旧フォルダの遅延HTMLが描画されないこと', async () => {
  const store = createMemoryStorage();
  store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({ clientId: 'cid-1' }));

  const previewEvents = [];
  let resolveOldFile;

  const authService = createAuthService({
    getGoogleOAuth2: () => ({
      initTokenClient: (cfg) => ({
        requestAccessToken: () => cfg.callback({ access_token: 'tok-switch', expires_in: 3600 })
      })
    })
  });

  const driveApi = DriveApi.createDriveApiClient({
    getAccessToken: () => authService.getValidToken(),
    fetchImpl: (url) => {
      if (url.includes('/files/old_file?alt=media')) {
        return new Promise((resolve) => {
          resolveOldFile = () => resolve(createMockResponse(200, '<h1>OLD_FOLDER_HTML</h1>'));
        });
      }
      if (url.includes('/files/folder_2?')) {
        return Promise.resolve(createMockResponse(200, {
          id: 'folder_2',
          name: 'Folder 2',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false
        }));
      }
      return Promise.resolve(createMockResponse(200, { files: [] }));
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
    ui: createNoopUi({
      setPreviewContent: (html) => previewEvents.push(html),
      resetPreview: () => previewEvents.push('__RESET__')
    })
  });

  controller.init();
  await authService.signIn();

  const oldPreviewPromise = controller.selectFile({ id: 'old_file', name: 'old.html' });
  await controller.applyFolder('folder_2', 'Folder 2');

  resolveOldFile();
  await oldPreviewPromise;

  assert.strictEqual(previewEvents.includes('<h1>OLD_FOLDER_HTML</h1>'), false, 'フォルダ切替後の遅延応答が描画されないこと');
  assert.strictEqual(previewEvents[previewEvents.length - 1], '__RESET__');
});

testCase('ADV-CON-004', 'BUG-GP-004: 検索デバウンス待機中に cancelPendingSearch + executeSearch("") すると古い検索語で上書きされないこと', async () => {
  const store = createMemoryStorage();
  store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({ clientId: 'cid-1', defaultFolderId: 'f1' }));

  const queriesExecuted = [];
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
        return createMockResponse(200, { id: 'f1', name: 'F1', mimeType: 'application/vnd.google-apps.folder', trashed: false });
      }
      queriesExecuted.push(new URL(url).searchParams.get('q'));
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
    ui: createNoopUi()
  });

  controller.init();
  await authService.signIn();
  await new Promise((r) => setTimeout(r, 20));
  queriesExecuted.length = 0;

  controller.scheduleSearch('stale_keyword', 30);
  controller.cancelPendingSearch();
  await controller.executeSearch('');
  await new Promise((r) => setTimeout(r, 60));

  assert.strictEqual(queriesExecuted.length, 1);
  assert.strictEqual(queriesExecuted[0].includes('stale_keyword'), false);
});

// -----------------------------------------------------------
// 観点4: 一時障害時の誤消去防止 & 無限フォールバック防止
// -----------------------------------------------------------
testCase('ADV-REC-001', '403 rateLimitExceeded / 429 / 500 / 401 時に保存済み LAST_FOLDER_ID が誤消去されないこと', async () => {
  const scenarios = [
    { status: 403, body: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } },
    { status: 429, body: { error: { message: 'Rate limited' } } },
    { status: 500, body: { error: { message: 'Backend down' } } },
    { status: 401, body: { error: { message: 'Token expired' } } }
  ];

  for (const sc of scenarios) {
    const store = createMemoryStorage();
    store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({ clientId: 'cid-1', defaultFolderId: 'def_1' }));
    store.set(STORAGE_KEYS.LAST_FOLDER_ID, 'valid_saved_folder');

    const authService = createAuthService({
      getGoogleOAuth2: () => ({
        initTokenClient: (cfg) => ({
          requestAccessToken: () => cfg.callback({ access_token: 'tok-1', expires_in: 3600 })
        })
      })
    });

    const driveApi = DriveApi.createDriveApiClient({
      getAccessToken: () => authService.getValidToken(),
      fetchImpl: async () => createMockResponse(sc.status, sc.body)
    });

    const controller = createAppController({
      configProvider: AppConfigProvider,
      storage: store,
      storageKeys: STORAGE_KEYS,
      folderResolver: FolderResolver,
      authService,
      driveApi,
      pickerService: createPickerService({ getGapi: () => null, getGooglePicker: () => null }),
      ui: createNoopUi(),
      getSearchString: () => ''
    });

    controller.init();
    await authService.signIn();
    await new Promise((r) => setTimeout(r, 15));

    assert.strictEqual(
      store.get(STORAGE_KEYS.LAST_FOLDER_ID),
      'valid_saved_folder',
      `HTTP ${sc.status} 時に保存済みフォルダが削除されないこと`
    );
  }
});

testCase('ADV-REC-002', 'URL指定フォルダもデフォルトフォルダも404の場合に自己修復が1回で停止し無限ループしないこと', async () => {
  const store = createMemoryStorage();
  store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify({ clientId: 'cid-1', defaultFolderId: 'broken_default' }));

  let fetchCount = 0;
  let manualOpenCount = 0;

  const authService = createAuthService({
    getGoogleOAuth2: () => ({
      initTokenClient: (cfg) => ({
        requestAccessToken: () => cfg.callback({ access_token: 'tok-1', expires_in: 3600 })
      })
    })
  });

  const driveApi = DriveApi.createDriveApiClient({
    getAccessToken: () => authService.getValidToken(),
    fetchImpl: async () => {
      fetchCount++;
      return createMockResponse(404, { error: { message: 'Not found' } });
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
    ui: createNoopUi({ openManualFolderModal: () => { manualOpenCount++; } }),
    getSearchString: () => '?folderId=broken_url'
  });

  controller.init();
  await authService.signIn();
  await new Promise((r) => setTimeout(r, 30));

  assert.strictEqual(fetchCount, 2, 'broken_url と broken_default の2回のみで停止すること');
  assert.strictEqual(manualOpenCount, 1, '最終的に手動入力モーダル誘導で停止すること');
});

// ====================================================
// 実行
// ====================================================
(async () => {
  console.log('====================================================');
  console.log('QA Adversarial Test Suite - Execution Started');
  console.log('====================================================');

  for (const c of cases) {
    try {
      await c.fn();
      console.log(`  [PASS] ${c.id}: ${c.title}`);
      passCount++;
    } catch (err) {
      console.log(`  [FAIL/ISSUE] ${c.id}: ${c.title}`);
      console.log(`         Error: ${err.message}`);
      failCount++;
      issueList.push({ id: c.id, title: c.title, error: err.message });
    }
  }

  console.log('\n====================================================');
  console.log(`QA Adversarial Suite Finished: PASS=${passCount}, FAIL/ISSUES=${failCount}`);
  console.log('====================================================');

  if (issueList.length > 0) {
    console.log('\n[発見された課題・障害モード一覧]');
    issueList.forEach((iss, idx) => {
      console.log(`\n#${idx + 1} [${iss.id}] ${iss.title}`);
      console.log(`   詳細: ${iss.error}`);
    });
    process.exit(1);
  }
  process.exit(0);
})();
