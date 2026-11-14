/**
 * 安全なストレージアクセス層（SafeStorage）およびストレージキー定数
 *
 * GitHub Pages のトップレベル（ファーストパーティ）オリジンで稼働する前提のもと、
 * シークレットモードやブラウザのストレージ制限による例外（SecurityError 等）を遮断する。
 * 注意: アクセストークン等の機密情報は絶対に localStorage へ保存しないこと。
 */
(function (root) {
  'use strict';

  var STORAGE_KEYS = {
    LAST_FOLDER_ID: 'html_viewer_last_folder_id',
    APP_CONFIG: 'html_viewer_app_config'
  };

  /**
   * 実行環境から利用可能な localStorage インスタンスを安全に取得する
   * @return {Storage|null}
   */
  function getLocalStorageSafely() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
      }
      if (root && root.localStorage) {
        return root.localStorage;
      }
    } catch (e) {
      console.warn('[SafeStorage] localStorage access denied:', e);
    }
    return null;
  }

  var SafeStorage = {
    /**
     * 指定キーの値を安全に取得する
     * @param {string} key
     * @return {string|null}
     */
    get: function (key) {
      try {
        var store = getLocalStorageSafely();
        if (store) {
          return store.getItem(key);
        }
      } catch (e) {
        console.warn('[SafeStorage] getItem failed for key:', key, e);
      }
      return null;
    },

    /**
     * 指定キーへ値を安全に保存する
     * @param {string} key
     * @param {string} value
     * @return {boolean}
     */
    set: function (key, value) {
      try {
        var store = getLocalStorageSafely();
        if (store) {
          store.setItem(key, String(value));
          return true;
        }
      } catch (e) {
        console.warn('[SafeStorage] setItem failed for key:', key, e);
      }
      return false;
    },

    /**
     * 指定キーの値を安全に削除する
     * @param {string} key
     * @return {boolean}
     */
    remove: function (key) {
      try {
        var store = getLocalStorageSafely();
        if (store) {
          store.removeItem(key);
          return true;
        }
      } catch (e) {
        console.warn('[SafeStorage] removeItem failed for key:', key, e);
      }
      return false;
    }
  };

  var exported = {
    STORAGE_KEYS: STORAGE_KEYS,
    SafeStorage: SafeStorage
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.HttpViewer = root.HttpViewer || {};
    root.HttpViewer.STORAGE_KEYS = STORAGE_KEYS;
    root.HttpViewer.SafeStorage = SafeStorage;
  }
})(typeof window !== 'undefined' ? window : globalThis);
