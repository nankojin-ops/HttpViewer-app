/**
 * フォルダ ID 検証・URL 解析・初期フォルダ優先順位解決モジュール
 */
(function (root) {
  'use strict';

  var MAX_FOLDER_ID_LENGTH = 256;
  var MAX_INPUT_LENGTH = 2048;

  /**
   * フォルダ ID または Google Drive URL からクリーンな ID を抽出・検証する
   * @param {string} input フォルダ ID または Google Drive URL
   * @return {string} 検証済みフォルダ ID
   * @throws {Error} 形式不正または長さ超過時
   */
  function sanitizeFolderId(input) {
    if (!input || typeof input !== 'string') {
      throw new Error('フォルダIDが指定されていません。');
    }

    var raw = input.trim();
    if (raw === '') {
      throw new Error('フォルダIDが指定されていません。');
    }

    if (raw.length > MAX_INPUT_LENGTH) {
      throw new Error('入力文字列が長すぎます。有効なフォルダIDまたはURLを指定してください。');
    }

    var cleaned = raw;
    // 1. URL 形式（https://drive.google.com/drive/folders/xxxx や drive/u/0/folders/xxxx）から抽出
    var folderMatch = raw.match(/folders\/([^/?#\s]+)/);
    if (folderMatch && folderMatch[1]) {
      cleaned = folderMatch[1];
    } else {
      // 2. URL クエリパラメータ形式（https://drive.google.com/open?id=xxxx や ?id=xxxx）から抽出
      var idMatch = raw.match(/[?&]id=([^&#\s]+)/);
      if (idMatch && idMatch[1]) {
        cleaned = idMatch[1];
      }
    }

    if (cleaned.length > MAX_FOLDER_ID_LENGTH) {
      throw new Error('フォルダIDが長すぎます（256文字以内で指定してください）。');
    }

    // Google Drive ID 形式（英数字・アンダースコア・ハイフンのみ）の検証
    if (!/^[a-zA-Z0-9_-]+$/.test(cleaned)) {
      throw new Error('無効なフォルダID形式です。指定されたフォルダの英数字IDまたはドライブURLを入力してください。');
    }

    return cleaned;
  }

  /**
   * フォルダ ID の抽出・検証を試み、無効時は空文字を返す（URL パラメータ等の安全抽出用）
   * @param {string} input
   * @return {string}
   */
  function trySanitizeFolderId(input) {
    try {
      return sanitizeFolderId(input);
    } catch (_) {
      return '';
    }
  }

  /**
   * URL クエリ文字列（window.location.search）から folderId または f を安全に抽出する
   * 不正文字を含む場合は空文字へ無害化する
   * @param {string} [searchString]
   * @return {string}
   */
  function getClientUrlFolderId(searchString) {
    try {
      var search = typeof searchString === 'string'
        ? searchString
        : (typeof window !== 'undefined' && window.location && window.location.search ? window.location.search : '');

      if (!search) {
        return '';
      }

      var params = new URLSearchParams(search);
      var raw = params.get('folderId') || params.get('f') || '';
      return trySanitizeFolderId(raw);
    } catch (e) {
      console.warn('[FolderResolver] URLSearchParams parse error:', e);
      return '';
    }
  }

  /**
   * 初期フォルダ ID の優先順位（URL > LOCAL_STORAGE > DEFAULT > NONE）を解決する
   * @param {Object} sources
   * @param {string|null} [sources.urlParam]
   * @param {string|null} [sources.localStore]
   * @param {string|null} [sources.defaultProp]
   * @return {{ folderId: string, source: 'URL'|'LOCAL_STORAGE'|'DEFAULT'|'NONE' }}
   */
  function resolveInitialFolderId(sources) {
    var safeSources = sources || {};

    if (typeof safeSources.urlParam === 'string' && safeSources.urlParam.trim() !== '') {
      return { folderId: safeSources.urlParam.trim(), source: 'URL' };
    }
    if (typeof safeSources.localStore === 'string' && safeSources.localStore.trim() !== '') {
      return { folderId: safeSources.localStore.trim(), source: 'LOCAL_STORAGE' };
    }
    if (typeof safeSources.defaultProp === 'string' && safeSources.defaultProp.trim() !== '') {
      return { folderId: safeSources.defaultProp.trim(), source: 'DEFAULT' };
    }

    return { folderId: '', source: 'NONE' };
  }

  var exported = {
    MAX_FOLDER_ID_LENGTH: MAX_FOLDER_ID_LENGTH,
    sanitizeFolderId: sanitizeFolderId,
    trySanitizeFolderId: trySanitizeFolderId,
    getClientUrlFolderId: getClientUrlFolderId,
    resolveInitialFolderId: resolveInitialFolderId
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.HttpViewer = root.HttpViewer || {};
    root.HttpViewer.FolderResolver = exported;
    root.HttpViewer.sanitizeFolderId = sanitizeFolderId;
    root.HttpViewer.trySanitizeFolderId = trySanitizeFolderId;
    root.HttpViewer.getClientUrlFolderId = getClientUrlFolderId;
    root.HttpViewer.resolveInitialFolderId = resolveInitialFolderId;
  }
})(typeof window !== 'undefined' ? window : globalThis);
