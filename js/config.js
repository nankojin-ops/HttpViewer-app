/**
 * クライアント設定管理モジュール（AppConfigProvider）
 *
 * B-1 ハイブリッド方式:
 *   config.js（window.APP_DEFAULT_CONFIG）を既定値としつつ、
 *   ブラウザ上の設定モーダルで入力した値を localStorage（STORAGE_KEYS.APP_CONFIG）に保存して
 *   項目単位で上書き解決する。
 */
(function (root) {
  'use strict';

  var StorageMod = (typeof module !== 'undefined' && module.exports)
    ? require('./storage.js')
    : (root.HttpViewer || {});

  var FolderResolverMod = (typeof module !== 'undefined' && module.exports)
    ? require('./folder-resolver.js')
    : ((root.HttpViewer && root.HttpViewer.FolderResolver) || root.HttpViewer || {});

  var STORAGE_KEYS = StorageMod.STORAGE_KEYS || {
    LAST_FOLDER_ID: 'html_viewer_last_folder_id',
    APP_CONFIG: 'html_viewer_app_config'
  };
  var DefaultSafeStorage = StorageMod.SafeStorage;
  var sanitizeFolderId = FolderResolverMod.sanitizeFolderId;
  var trySanitizeFolderId = FolderResolverMod.trySanitizeFolderId;

  var CONFIG_KEYS = ['clientId', 'apiKey', 'appId', 'defaultFolderId'];

  /**
   * 値を安全に文字列トリムする
   * @param {*} value
   * @return {string}
   */
  function normalizeString(value) {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim();
  }

  /**
   * config.js 由来の既定設定オブジェクトを取得・正規化する
   * @param {Object} [defaultConfig]
   * @return {{ clientId: string, apiKey: string, appId: string, defaultFolderId: string }}
   */
  function getDefaultConfig(defaultConfig) {
    var raw = defaultConfig;
    if (!raw) {
      if (root && root.APP_DEFAULT_CONFIG) {
        raw = root.APP_DEFAULT_CONFIG;
      } else if (typeof globalThis !== 'undefined' && globalThis.APP_DEFAULT_CONFIG) {
        raw = globalThis.APP_DEFAULT_CONFIG;
      } else {
        raw = {};
      }
    }

    var rawDefaultFolder = normalizeString(raw.defaultFolderId);
    var safeDefaultFolder = rawDefaultFolder ? trySanitizeFolderId(rawDefaultFolder) : '';

    return {
      clientId: normalizeString(raw.clientId),
      apiKey: normalizeString(raw.apiKey),
      appId: normalizeString(raw.appId),
      defaultFolderId: safeDefaultFolder
    };
  }

  /**
   * localStorage に保存された設定オーバーライド JSON を安全に読み込む
   * @param {Object} [storage]
   * @return {Object}
   */
  function readStoredOverrides(storage) {
    var store = storage || DefaultSafeStorage;
    if (!store || typeof store.get !== 'function') {
      return {};
    }

    var rawJson = store.get(STORAGE_KEYS.APP_CONFIG);
    if (!rawJson || typeof rawJson !== 'string') {
      return {};
    }

    try {
      var parsed = JSON.parse(rawJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }
      return parsed;
    } catch (e) {
      console.warn('[AppConfigProvider] Corrupted config JSON in storage, ignoring:', e);
      return {};
    }
  }

  /**
   * ハイブリッド設定解決（localStorage > config.js > ''）を実行する
   * @param {Object} [defaultConfig]
   * @param {Object} [storage]
   * @return {Object} ResolvedAppConfig
   */
  function loadConfig(defaultConfig, storage) {
    var defaults = getDefaultConfig(defaultConfig);
    var overrides = readStoredOverrides(storage);

    var resolved = {
      clientId: '',
      apiKey: '',
      appId: '',
      defaultFolderId: '',
      sources: {
        clientId: 'NONE',
        apiKey: 'NONE',
        appId: 'NONE',
        defaultFolderId: 'NONE'
      },
      hasLocalOverrides: false,
      isAuthConfigured: false,
      isPickerConfigured: false
    };

    CONFIG_KEYS.forEach(function (key) {
      var localVal = normalizeString(overrides[key]);
      if (key === 'defaultFolderId' && localVal !== '') {
        localVal = trySanitizeFolderId(localVal);
      }

      var defaultVal = defaults[key] || '';

      if (localVal !== '') {
        resolved[key] = localVal;
        resolved.sources[key] = 'LOCAL_STORAGE';
        resolved.hasLocalOverrides = true;
      } else if (defaultVal !== '') {
        resolved[key] = defaultVal;
        resolved.sources[key] = 'CONFIG_FILE';
      } else {
        resolved[key] = '';
        resolved.sources[key] = 'NONE';
      }
    });

    resolved.isAuthConfigured = resolved.clientId !== '';
    resolved.isPickerConfigured = resolved.apiKey !== '' && resolved.appId !== '';

    return resolved;
  }

  /**
   * ユーザー入力の設定値を検証し localStorage へ保存する
   * config.js 既定値と一致する項目は不要な上書き保存を行わず、差分項目のみを保存する
   * @param {Object} partial
   * @param {Object} [storage]
   * @param {Object} [defaultConfig]
   * @return {{ success: boolean, config?: Object, error?: string }}
   */
  function saveConfigOverrides(partial, storage, defaultConfig) {
    var store = storage || DefaultSafeStorage;
    var input = partial && typeof partial === 'object' ? partial : {};
    var defaults = getDefaultConfig(defaultConfig);

    var normalizedInput = {
      clientId: normalizeString(input.clientId),
      apiKey: normalizeString(input.apiKey),
      appId: normalizeString(input.appId),
      defaultFolderId: normalizeString(input.defaultFolderId)
    };

    if (normalizedInput.clientId === '') {
      return {
        success: false,
        error: 'OAuth Client ID は必須項目です。初期状態に戻す場合は「初期設定に戻す」を使用してください。'
      };
    }

    if (normalizedInput.defaultFolderId !== '') {
      try {
        normalizedInput.defaultFolderId = sanitizeFolderId(normalizedInput.defaultFolderId);
      } catch (err) {
        return {
          success: false,
          error: err.message
        };
      }
    }

    if (normalizedInput.appId !== '' && !/^[0-9]+$/.test(normalizedInput.appId)) {
      return {
        success: false,
        error: 'GCP Project Number (App ID) は半角数字で入力してください。'
      };
    }

    // 既定値（config.js）と同値の項目は localStorage へコピーせず、真に変更された項目のみを保存対象にする
    var diffOverrides = {};
    var hasOverride = false;
    CONFIG_KEYS.forEach(function (key) {
      var val = normalizedInput[key];
      if (val !== '' && val !== defaults[key]) {
        diffOverrides[key] = val;
        hasOverride = true;
      }
    });

    if (!store || typeof store.set !== 'function' || typeof store.remove !== 'function') {
      return {
        success: false,
        error: 'ブラウザのストレージが利用できません。'
      };
    }

    if (!hasOverride) {
      var removed = store.remove(STORAGE_KEYS.APP_CONFIG);
      if (!removed) {
        return {
          success: false,
          error: '設定のクリアに失敗しました。ブラウザのストレージ設定をご確認ください。'
        };
      }
    } else {
      var saved = store.set(STORAGE_KEYS.APP_CONFIG, JSON.stringify(diffOverrides));
      if (!saved) {
        return {
          success: false,
          error: '設定をブラウザに保存できませんでした。シークレットモードやストレージ制限をご確認ください。'
        };
      }
    }

    return {
      success: true,
      config: loadConfig(defaultConfig, store)
    };
  }

  /**
   * localStorage 上のカスタム設定をすべて削除し config.js 既定値へ戻す
   * @param {Object} [storage]
   * @return {boolean}
   */
  function clearConfigOverrides(storage) {
    var store = storage || DefaultSafeStorage;
    if (!store || typeof store.remove !== 'function') {
      return false;
    }
    return store.remove(STORAGE_KEYS.APP_CONFIG);
  }

  var AppConfigProvider = {
    getDefaultConfig: getDefaultConfig,
    loadConfig: loadConfig,
    saveConfigOverrides: saveConfigOverrides,
    clearConfigOverrides: clearConfigOverrides
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AppConfigProvider;
  }
  if (root) {
    root.HttpViewer = root.HttpViewer || {};
    root.HttpViewer.AppConfigProvider = AppConfigProvider;
  }
})(typeof window !== 'undefined' ? window : globalThis);
