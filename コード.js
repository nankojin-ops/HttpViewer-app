/**
 * HTML File Search & Viewer Web App - Backend Script
 */

// デフォルトのフォルダID（スクリプトプロパティ 'FOLDER_ID' が未設定の場合に使用）
const DEFAULT_FOLDER_ID = '';

/**
 * デフォルトのGoogleドライブフォルダIDを取得する
 * スクリプトプロパティ 'FOLDER_ID' を優先し、未設定の場合は DEFAULT_FOLDER_ID を参照
 * @return {string} フォルダID
 */
function getDefaultFolderId_() {
  const propId = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
  const folderId = (propId && propId.trim() !== '') ? propId.trim() : DEFAULT_FOLDER_ID;
  return folderId ? folderId.trim() : '';
}

/**
 * フォルダIDまたはDrive URLからクリーンなフォルダIDを抽出・バリデーションする
 * @param {string} input フォルダIDまたはGoogle Drive URL
 * @return {string} バリデーション済みフォルダID
 */
function sanitizeFolderId_(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('フォルダIDが指定されていません。');
  }
  let cleaned = input.trim();
  // 1. URL形式（https://drive.google.com/drive/folders/xxxx や drive/u/0/folders/xxxx）からIDを抽出
  const folderMatch = cleaned.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch && folderMatch[1]) {
    cleaned = folderMatch[1];
  } else {
    // 2. URLクエリパラメータ形式（https://drive.google.com/open?id=xxxx や ?id=xxxx）からIDを抽出
    const idMatch = cleaned.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch && idMatch[1]) {
      cleaned = idMatch[1];
    }
  }
  // Google Drive ID形式（英数字、アンダースコア、ハイフン）のチェック
  if (!/^[a-zA-Z0-9_-]+$/.test(cleaned)) {
    throw new Error('無効なフォルダID形式です。指定されたフォルダの英数字IDまたはドライブURLを入力してください。');
  }
  return cleaned;
}

/**
 * Webアプリケーションのエントリポイント
 * @param {Object} [e] イベントパラメータ（e.parameter にクエリパラメータが含まれる）
 * @return {HtmlOutput}
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('index');
  // URLクエリパラメータから folderId または f を抽出
  const rawUrlFolderId = e && e.parameter ? (e.parameter.folderId || e.parameter.f || '') : '';
  let safeFolderId = '';
  if (rawUrlFolderId && typeof rawUrlFolderId === 'string') {
    try {
      safeFolderId = sanitizeFolderId_(rawUrlFolderId);
    } catch (_) {
      // 不正な文字や無効な形式が含まれる場合は安全のため空文字列とする
      safeFolderId = '';
    }
  }
  template.urlFolderId = safeFolderId;

  return template.evaluate()
    .setTitle('HTML Viewer & Search')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * フロントエンド初期化用の設定情報を返却する
 * @return {Object} {
 *   token: string,
 *   apiKey: string,
 *   projectNumber: string,
 *   defaultFolderId: string,
 *   lastFolderId: string
 * }
 */
function getAppConfig() {
  const scriptProps = PropertiesService.getScriptProperties();
  const userProps = PropertiesService.getUserProperties();

  const lastFolderId = userProps.getProperty('LAST_FOLDER_ID') || '';

  return {
    token: ScriptApp.getOAuthToken(),
    apiKey: scriptProps.getProperty('PICKER_API_KEY') || '',
    projectNumber: scriptProps.getProperty('PROJECT_NUMBER') || '',
    defaultFolderId: getDefaultFolderId_(),
    lastFolderId: lastFolderId.trim()
  };
}

/**
 * ユーザーの前回選択フォルダIDを UserProperties に保存する
 * @param {string} folderId フォルダIDまたはGoogle Drive URL
 * @return {Object} { success: boolean, savedFolderId?: string, error?: string }
 */
function saveLastFolderId(folderId) {
  try {
    const cleanId = sanitizeFolderId_(folderId);
    PropertiesService.getUserProperties().setProperty('LAST_FOLDER_ID', cleanId);
    return {
      success: true,
      savedFolderId: cleanId
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * ユーザーの前回選択フォルダIDを UserProperties から削除する（自己修復・クリア用）
 * @return {Object} { success: boolean, error?: string }
 */
function clearLastFolderId() {
  try {
    PropertiesService.getUserProperties().deleteProperty('LAST_FOLDER_ID');
    return {
      success: true
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * フォルダの存在確認および表示名を取得する
 * @param {string} folderId フォルダID
 * @return {Object} { success: boolean, folder?: { id: string, name: string }, error?: string }
 */
function getFolderDetails(folderId) {
  try {
    const cleanId = sanitizeFolderId_(folderId);
    let folder;
    try {
      folder = DriveApp.getFolderById(cleanId);
    } catch (e) {
      throw new Error('指定されたフォルダが存在しないか、アクセス権限がありません。(ID: ' + cleanId + ')');
    }

    if (folder.isTrashed()) {
      throw new Error('指定されたフォルダはゴミ箱に入っています。');
    }

    return {
      success: true,
      folder: {
        id: folder.getId(),
        name: folder.getName()
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 検索クエリ用の特殊文字サニタイズ処理
 * @param {string} input 入力文字列
 * @return {string} エスケープ済み文字列
 */
function sanitizeSearchQuery_(input) {
  if (!input) return '';
  return input
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

/**
 * Fileオブジェクトからフロントエンド用のメタデータオブジェクトを生成する
 * @param {GoogleAppsScript.Drive.File} file 対象ファイル
 * @return {Object} メタデータ
 */
function formatFileMetadata_(file) {
  return {
    id: file.getId(),
    name: file.getName(),
    size: file.getSize(),
    updated: Utilities.formatDate(file.getLastUpdated(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
  };
}

/**
 * 指定フォルダ内の全HTMLファイル一覧を取得する
 * @param {string} [targetFolderId] 対象フォルダID（未指定時はデフォルトを参照）
 * @return {Object} { success: boolean, data?: Array, folder?: { id: string, name: string }, error?: string }
 */
function getHtmlFileList(targetFolderId) {
  try {
    const rawId = (targetFolderId && targetFolderId.trim() !== '') ? targetFolderId : getDefaultFolderId_();
    if (!rawId) {
      throw new Error('指定されたフォルダが未指定です。フォルダを選択してください。');
    }

    const folderId = sanitizeFolderId_(rawId);
    let folder;
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (e) {
      throw new Error('指定されたフォルダが存在しないか、アクセス権限がありません。(ID: ' + folderId + ')');
    }

    if (folder.isTrashed()) {
      throw new Error('指定されたフォルダはゴミ箱に入っています。');
    }

    const files = folder.getFiles();
    const result = [];

    while (files.hasNext()) {
      const file = files.next();
      if (file.isTrashed()) continue;

      const mimeType = file.getMimeType();
      const name = file.getName().toLowerCase();

      // MIMEタイプがtext/html、または拡張子が.html / .htmのファイルを対象とする
      if (mimeType === MimeType.HTML || name.endsWith('.html') || name.endsWith('.htm')) {
        result.push(formatFileMetadata_(file));
      }
    }

    // 更新日時の降順（新しい順）にソート
    result.sort(function(a, b) {
      return a.updated < b.updated ? 1 : -1;
    });

    return {
      success: true,
      data: result,
      folder: {
        id: folder.getId(),
        name: folder.getName()
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * ファイル名および本文テキストを対象にHTMLファイルを検索する
 * @param {string} keyword 検索キーワード
 * @param {string} [targetFolderId] 対象フォルダID（未指定時はデフォルトを参照）
 * @return {Object} { success: boolean, data?: Array, error?: string }
 */
function searchHtmlFiles(keyword, targetFolderId) {
  try {
    if (!keyword || keyword.trim() === '') {
      return getHtmlFileList(targetFolderId);
    }

    const rawId = (targetFolderId && targetFolderId.trim() !== '') ? targetFolderId : getDefaultFolderId_();
    if (!rawId) {
      throw new Error('指定されたフォルダが未指定です。フォルダを選択してください。');
    }

    const folderId = sanitizeFolderId_(rawId);
    const cleanKeyword = sanitizeSearchQuery_(keyword.trim());

    // フォルダ直下指定、ゴミ箱除外、HTML判定、ファイル名 OR 全文検索のクエリ構築
    const query = "'" + folderId + "' in parents and trashed = false and " +
      "(mimeType = 'text/html' or title contains '.html' or title contains '.htm') and " +
      "(title contains '" + cleanKeyword + "' or fullText contains '" + cleanKeyword + "')";

    const files = DriveApp.searchFiles(query);
    const result = [];

    while (files.hasNext()) {
      const file = files.next();
      result.push(formatFileMetadata_(file));
    }

    // 更新日時の降順にソート
    result.sort(function(a, b) {
      return a.updated < b.updated ? 1 : -1;
    });

    return {
      success: true,
      data: result
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 指定されたHTMLファイルの内容（ソーステキスト）を取得する
 * @param {string} fileId ファイルID
 * @return {Object} { success: boolean, content?: string, fileName?: string, error?: string }
 */
function getHtmlFileContent(fileId) {
  try {
    if (!fileId || fileId.trim() === '') {
      throw new Error('ファイルIDが無効です。');
    }

    const file = DriveApp.getFileById(fileId.trim());
    if (file.isTrashed()) {
      throw new Error('指定されたファイルはゴミ箱に入っています。');
    }

    // UTF-8文字列としてHTMLコンテンツを読み込む
    const content = file.getBlob().getDataAsString('UTF-8');

    return {
      success: true,
      content: content,
      fileName: file.getName()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}