/**
 * Google Drive API v3 REST クライアント（DriveApiClient）
 *
 * 現行 GAS コード.js の DriveApp 操作をブラウザからの直接 fetch 呼び出しに置き換える。
 * 共有ドライブ（supportsAllDrives / includeItemsFromAllDrives）、
 * ページネーション（pageSize=1000 + nextPageToken）、
 * 厳密 HTML 判定、および HTTP エラー詳細分類を提供する。
 */
(function (root) {
  'use strict';

  var FolderResolverMod = (typeof module !== 'undefined' && module.exports)
    ? require('./folder-resolver.js')
    : ((root.HttpViewer && root.HttpViewer.FolderResolver) || root.HttpViewer || {});

  var sanitizeFolderId = FolderResolverMod.sanitizeFolderId;

  var DRIVE_FILES_API_BASE = 'https://www.googleapis.com/drive/v3/files';
  var DRIVE_DRIVES_API_BASE = 'https://www.googleapis.com/drive/v3/drives';
  var DEFAULT_PAGE_SIZE = 1000;
  var DEFAULT_MAX_PAGES = 20;

  /**
   * Drive API 検索クエリ（q パラメータ）用の文字列正規化・エスケープ
   * 改行・制御文字を半角スペースに正規化した上で、バックスラッシュとシングルクォートをエスケープする
   * @param {string} input
   * @return {string}
   */
  function sanitizeSearchQuery(input) {
    if (!input || typeof input !== 'string') {
      return '';
    }
    return input
      .replace(/[\r\n\t\x00-\x1f\x7f]+/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .trim();
  }

  /**
   * Drive ファイルオブジェクトが閲覧対象の HTML ファイルかを厳密判定する
   * @param {Object} file
   * @return {boolean}
   */
  function isHtmlDriveFile(file) {
    if (!file || typeof file !== 'object') {
      return false;
    }
    if (file.trashed === true) {
      return false;
    }
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      return false;
    }
    var lowerName = typeof file.name === 'string' ? file.name.toLowerCase() : '';
    return file.mimeType === 'text/html' || lowerName.endsWith('.html') || lowerName.endsWith('.htm');
  }

  function pad2(num) {
    return num < 10 ? '0' + num : String(num);
  }

  /**
   * ISO 8601 タイムスタンプを表示用 'yyyy-MM-dd HH:mm:ss' へ変換する
   * @param {string} isoString
   * @return {string}
   */
  function formatDriveTimestamp(isoString) {
    if (!isoString || typeof isoString !== 'string') {
      return '';
    }
    var date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return '';
    }
    return (
      date.getFullYear() + '-' +
      pad2(date.getMonth() + 1) + '-' +
      pad2(date.getDate()) + ' ' +
      pad2(date.getHours()) + ':' +
      pad2(date.getMinutes()) + ':' +
      pad2(date.getSeconds())
    );
  }

  /**
   * Google Drive API の HTTP ステータスおよびエラー JSON を分類する
   * @param {number} status
   * @param {Object|null} errorBody
   * @param {string} [contextLabel]
   * @return {{ errorCode: string, error: string }}
   */
  function mapDriveHttpError(status, errorBody, contextLabel) {
    var apiError = errorBody && errorBody.error ? errorBody.error : null;
    var firstReason = (apiError && Array.isArray(apiError.errors) && apiError.errors[0] && apiError.errors[0].reason)
      ? String(apiError.errors[0].reason)
      : '';
    var apiMsg = apiError && apiError.message ? String(apiError.message) : '';

    if (status === 401) {
      return {
        errorCode: 'UNAUTHORIZED',
        error: 'セッションの有効期限が切れました。再認証してください。'
      };
    }

    if (status === 403) {
      if (
        firstReason === 'rateLimitExceeded' ||
        firstReason === 'userRateLimitExceeded' ||
        firstReason === 'dailyLimitExceeded'
      ) {
        return {
          errorCode: 'RATE_LIMITED',
          error: 'Google Drive API のリクエスト上限に達しました。しばらく待ってから再試行してください。'
        };
      }
      if (firstReason === 'accessNotConfigured') {
        return {
          errorCode: 'API_DISABLED',
          error: 'Google Cloud プロジェクトで Google Drive API が有効化されていません。'
        };
      }
      if (firstReason === 'fileNotDownloadable') {
        return {
          errorCode: 'NOT_DOWNLOADABLE',
          error: 'このファイルは Google ドキュメント等のネイティブ形式のため、HTML として直接プレビューできません。'
        };
      }
      return {
        errorCode: 'FORBIDDEN',
        error: (contextLabel ? contextLabel + ': ' : '') + 'アクセス権限がありません。' + (apiMsg ? ' (' + apiMsg + ')' : '')
      };
    }

    if (status === 404) {
      return {
        errorCode: 'NOT_FOUND',
        error: (contextLabel ? contextLabel + 'が' : '対象が') + '存在しないか、アクセス権限がありません。'
      };
    }

    if (status === 429) {
      return {
        errorCode: 'RATE_LIMITED',
        error: 'アクセスが集中しています。しばらく待ってから再試行してください。'
      };
    }

    if (status >= 500) {
      return {
        errorCode: 'NETWORK_ERROR',
        error: 'Google Drive サーバー側で一時的なエラーが発生しました (HTTP ' + status + ')。'
      };
    }

    return {
      errorCode: 'NETWORK_ERROR',
      error: 'Google Drive API リクエストに失敗しました (HTTP ' + status + ')' + (apiMsg ? ': ' + apiMsg : '')
    };
  }

  /**
   * レスポンスからエラー JSON を安全にパースする
   * @param {Response} response
   * @return {Promise<Object|null>}
   */
  function parseErrorJsonSafely(response) {
    if (!response || typeof response.json !== 'function') {
      return Promise.resolve(null);
    }
    return response.json().catch(function () {
      return null;
    });
  }

  /**
   * DriveApiClient インスタンスを生成する
   * @param {Object} options
   * @param {Function} options.getAccessToken () => string | null
   * @param {Function} [options.fetchImpl] テスト用 fetch モック
   * @param {number} [options.pageSize]
   * @param {number} [options.maxPages]
   * @return {Object} DriveApiClient
   */
  function createDriveApiClient(options) {
    var opts = options || {};
    var getAccessToken = opts.getAccessToken;
    var fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    var pageSize = typeof opts.pageSize === 'number' && opts.pageSize > 0 ? opts.pageSize : DEFAULT_PAGE_SIZE;
    var maxPages = typeof opts.maxPages === 'number' && opts.maxPages > 0 ? opts.maxPages : DEFAULT_MAX_PAGES;

    function requireValidToken() {
      var token = typeof getAccessToken === 'function' ? getAccessToken() : null;
      if (!token) {
        return null;
      }
      return token;
    }

    function unauthorizedResult() {
      return {
        success: false,
        errorCode: 'UNAUTHORIZED',
        error: '認証セッションが無効または期限切れです。再認証してください。'
      };
    }

    function executeFetch(url, token) {
      if (!fetchImpl) {
        return Promise.reject(new Error('fetch API が利用できません。'));
      }
      return fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + token
        }
      });
    }

    function isCancelledSignal(signal) {
      return Boolean(signal && typeof signal.isCancelled === 'function' && signal.isCancelled());
    }

    function cancelledResult() {
      return {
        success: false,
        cancelled: true,
        error: 'リクエストがキャンセルされました。'
      };
    }

    function invalidInputResult(message) {
      return {
        success: false,
        errorCode: 'INVALID_INPUT',
        error: message
      };
    }

    function clampPageSize(rawValue, defaultVal, maxVal) {
      if (typeof rawValue === 'number' && isFinite(rawValue)) {
        return Math.max(1, Math.min(Math.floor(rawValue), maxVal));
      }
      return defaultVal;
    }

    function normalizeFolderItem(rawItem, fallbackDriveId, isSharedDrive) {
      var item = rawItem || {};
      return {
        id: item.id,
        name: item.name || '(名称未設定)',
        driveId: item.driveId || fallbackDriveId || '',
        isSharedDrive: Boolean(isSharedDrive)
      };
    }

    /**
     * フォルダブラウズ・検索系の単一ページ取得共通ヘルパー
     * @param {string} url
     * @param {string} contextLabel
     * @param {{ isCancelled?: Function }} [signal]
     * @param {Function} transformPayload
     * @return {Promise<Object>}
     */
    function executeBrowseFetch(url, contextLabel, signal, transformPayload) {
      if (isCancelledSignal(signal)) {
        return Promise.resolve(cancelledResult());
      }

      var token = requireValidToken();
      if (!token) {
        return Promise.resolve(unauthorizedResult());
      }

      return executeFetch(url, token)
        .then(function (response) {
          if (isCancelledSignal(signal)) {
            return cancelledResult();
          }

          if (!response.ok) {
            return parseErrorJsonSafely(response).then(function (errBody) {
              var mapped = mapDriveHttpError(response.status, errBody, contextLabel);
              return {
                success: false,
                errorCode: mapped.errorCode,
                error: mapped.error
              };
            });
          }

          return response.json().then(function (payload) {
            if (isCancelledSignal(signal)) {
              return cancelledResult();
            }
            var pageData = transformPayload(payload || {});
            return {
              success: true,
              data: pageData,
              items: pageData.items,
              nextPageToken: pageData.nextPageToken
            };
          });
        })
        .catch(function (err) {
          return {
            success: false,
            errorCode: 'NETWORK_ERROR',
            error: contextLabel + 'の取得中に通信エラーが発生しました: ' + (err && err.message ? err.message : 'Network error')
          };
        });
    }

    /**
     * フォルダ ID または URL を検証し、フォルダのメタデータを取得する
     * @param {string} folderIdOrUrl
     * @return {Promise<Object>} DriveResult<FolderInfo>
     */
    function getFolderDetails(folderIdOrUrl) {
      var cleanId;
      try {
        cleanId = sanitizeFolderId(folderIdOrUrl);
      } catch (err) {
        return Promise.resolve({
          success: false,
          errorCode: 'INVALID_INPUT',
          error: err.message
        });
      }

      var token = requireValidToken();
      if (!token) {
        return Promise.resolve(unauthorizedResult());
      }

      var url = DRIVE_FILES_API_BASE + '/' + encodeURIComponent(cleanId) +
        '?fields=id,name,mimeType,trashed&supportsAllDrives=true';

      return executeFetch(url, token)
        .then(function (response) {
          if (!response.ok) {
            return parseErrorJsonSafely(response).then(function (errBody) {
              var mapped = mapDriveHttpError(response.status, errBody, '指定されたフォルダ');
              return {
                success: false,
                errorCode: mapped.errorCode,
                error: mapped.error
              };
            });
          }

          return response.json().then(function (data) {
            if (!data || !data.id) {
              return {
                success: false,
                errorCode: 'NOT_FOUND',
                error: '指定されたフォルダが見つかりません。'
              };
            }
            if (data.trashed === true) {
              return {
                success: false,
                errorCode: 'TRASHED',
                error: '指定されたフォルダはゴミ箱に入っています。'
              };
            }
            if (data.mimeType !== 'application/vnd.google-apps.folder') {
              return {
                success: false,
                errorCode: 'NOT_A_FOLDER',
                error: '指定されたIDはフォルダではありません。'
              };
            }

            var folderInfo = {
              id: data.id,
              name: data.name || cleanId
            };
            return {
              success: true,
              data: folderInfo,
              folder: folderInfo
            };
          });
        })
        .catch(function (err) {
          return {
            success: false,
            errorCode: 'NETWORK_ERROR',
            error: 'フォルダ情報の取得中に通信エラーが発生しました: ' + (err && err.message ? err.message : 'Network error')
          };
        });
    }

    /**
     * 一覧取得・検索の共通実行処理（ページネーション対応）
     * @param {string} folderIdOrUrl
     * @param {string} keyword
     * @param {{ isCancelled?: Function }} [signal]
     * @return {Promise<Object>}
     */
    function fetchHtmlFilesInternal(folderIdOrUrl, keyword, signal) {
      var cleanKeyword = sanitizeSearchQuery(typeof keyword === 'string' ? keyword : '');

      return getFolderDetails(folderIdOrUrl).then(function (folderRes) {
        if (!folderRes.success) {
          return folderRes;
        }

        if (signal && typeof signal.isCancelled === 'function' && signal.isCancelled()) {
          return {
            success: false,
            cancelled: true,
            error: 'リクエストがキャンセルされました。'
          };
        }

        var token = requireValidToken();
        if (!token) {
          return unauthorizedResult();
        }

        var folder = folderRes.folder;
        var baseQuery = "'" + folder.id + "' in parents and trashed = false and " +
          "mimeType != 'application/vnd.google-apps.folder' and " +
          "(mimeType = 'text/html' or name contains '.html' or name contains '.htm')";

        var query = baseQuery;
        if (cleanKeyword !== '') {
          query += " and (name contains '" + cleanKeyword + "' or fullText contains '" + cleanKeyword + "')";
        }

        var collected = [];
        var seenTokens = new Set();
        var nextPageToken = null;
        var pageCount = 0;
        var truncated = false;

        function fetchNextPage() {
          if (signal && typeof signal.isCancelled === 'function' && signal.isCancelled()) {
            return Promise.resolve({
              success: false,
              cancelled: true,
              error: 'リクエストがキャンセルされました。'
            });
          }

          if (pageCount >= maxPages) {
            truncated = true;
            return Promise.resolve(null);
          }

          var currentToken = requireValidToken();
          if (!currentToken) {
            return Promise.resolve(unauthorizedResult());
          }

          var params = new URLSearchParams();
          params.set('q', query);
          params.set('fields', 'nextPageToken,files(id,name,size,modifiedTime,mimeType,trashed)');
          params.set('orderBy', 'modifiedTime desc');
          params.set('pageSize', String(pageSize));
          params.set('supportsAllDrives', 'true');
          params.set('includeItemsFromAllDrives', 'true');
          if (nextPageToken) {
            params.set('pageToken', nextPageToken);
          }

          var url = DRIVE_FILES_API_BASE + '?' + params.toString();

          return executeFetch(url, currentToken)
            .then(function (response) {
              if (!response.ok) {
                return parseErrorJsonSafely(response).then(function (errBody) {
                  var mapped = mapDriveHttpError(response.status, errBody, 'ファイル一覧');
                  return {
                    success: false,
                    errorCode: mapped.errorCode,
                    error: mapped.error
                  };
                });
              }

              return response.json().then(function (payload) {
                var files = Array.isArray(payload && payload.files) ? payload.files : [];
                for (var i = 0; i < files.length; i++) {
                  var file = files[i];
                  if (isHtmlDriveFile(file)) {
                    collected.push({
                      id: file.id,
                      name: file.name || '(名称未設定)',
                      size: Number(file.size || 0),
                      updated: formatDriveTimestamp(file.modifiedTime),
                      modifiedTime: file.modifiedTime || ''
                    });
                  }
                }

                pageCount++;
                var nextToken = payload && payload.nextPageToken ? String(payload.nextPageToken) : '';
                if (!nextToken) {
                  return null;
                }

                if (seenTokens.has(nextToken)) {
                  truncated = true;
                  return null;
                }
                seenTokens.add(nextToken);
                nextPageToken = nextToken;
                return fetchNextPage();
              });
            })
            .catch(function (err) {
              return {
                success: false,
                errorCode: 'NETWORK_ERROR',
                error: 'ファイル一覧の取得中に通信エラーが発生しました: ' + (err && err.message ? err.message : 'Network error')
              };
            });
        }

        return fetchNextPage().then(function (errorOrCancelResult) {
          if (errorOrCancelResult) {
            return errorOrCancelResult;
          }

          // modifiedTime 降順でソート（有効日時を常に上位、無効・欠損日時は末尾へ配置）
          collected.sort(function (a, b) {
            var timeA = a.modifiedTime ? Date.parse(a.modifiedTime) : NaN;
            var timeB = b.modifiedTime ? Date.parse(b.modifiedTime) : NaN;
            var validA = !isNaN(timeA);
            var validB = !isNaN(timeB);

            if (validA && validB) {
              return timeB - timeA;
            }
            if (validA && !validB) {
              return -1;
            }
            if (!validA && validB) {
              return 1;
            }
            return 0;
          });

          return {
            success: true,
            data: collected,
            folder: folder,
            truncated: truncated
          };
        });
      });
    }

    /**
     * 指定フォルダ内の全 HTML ファイル一覧を取得する
     * @param {string} folderIdOrUrl
     * @param {{ isCancelled?: Function }} [signal]
     * @return {Promise<Object>}
     */
    function getHtmlFileList(folderIdOrUrl, signal) {
      return fetchHtmlFilesInternal(folderIdOrUrl, '', signal);
    }

    /**
     * ファイル名および本文テキスト（fullText）を対象に HTML ファイルを検索する
     * @param {string} keyword
     * @param {string} folderIdOrUrl
     * @param {{ isCancelled?: Function }} [signal]
     * @return {Promise<Object>}
     */
    function searchHtmlFiles(keyword, folderIdOrUrl, signal) {
      return fetchHtmlFilesInternal(folderIdOrUrl, keyword, signal);
    }

    /**
     * 指定された HTML ファイルのコンテンツ（UTF-8 文字列）を取得する
     * @param {string} fileId
     * @param {string} [fileName] 呼び出し元から渡される表示用ファイル名
     * @return {Promise<Object>}
     */
    function getHtmlFileContent(fileId, fileName) {
      var cleanFileId;
      try {
        cleanFileId = sanitizeFolderId(fileId);
      } catch (err) {
        return Promise.resolve({
          success: false,
          errorCode: 'INVALID_INPUT',
          error: 'ファイルIDが無効です: ' + err.message
        });
      }

      var token = requireValidToken();
      if (!token) {
        return Promise.resolve(unauthorizedResult());
      }

      var url = DRIVE_FILES_API_BASE + '/' + encodeURIComponent(cleanFileId) +
        '?alt=media&supportsAllDrives=true';

      return executeFetch(url, token)
        .then(function (response) {
          if (!response.ok) {
            return parseErrorJsonSafely(response).then(function (errBody) {
              var mapped = mapDriveHttpError(response.status, errBody, '指定されたファイル');
              return {
                success: false,
                errorCode: mapped.errorCode,
                error: mapped.error
              };
            });
          }

          return response.text().then(function (htmlText) {
            var resolvedName = typeof fileName === 'string' ? fileName : '';
            return {
              success: true,
              data: {
                content: htmlText,
                fileName: resolvedName
              },
              content: htmlText
            };
          });
        })
        .catch(function (err) {
          return {
            success: false,
            errorCode: 'NETWORK_ERROR',
            error: 'HTML ファイルの読み込み中に通信エラーが発生しました: ' + (err && err.message ? err.message : 'Network error')
          };
        });
    }

    /**
     * 指定空間・親フォルダ配下のサブフォルダ一覧を取得する（1ページ分）
     * @param {Object} [params]
     * @param {'MY_DRIVE'|'SHARED_DRIVES'|'SHARED_WITH_ME'} [params.space]
     * @param {string} [params.parentId]
     * @param {string} [params.driveId]
     * @param {string} [params.pageToken]
     * @param {number} [params.pageSize]
     * @param {{ isCancelled?: Function }} [signal]
     * @return {Promise<Object>}
     */
    function listSubfolders(params, signal) {
      var p = params || {};
      var space = p.space || 'MY_DRIVE';
      var clampedSize = clampPageSize(p.pageSize, 100, 1000);
      var urlParams = new URLSearchParams();
      var query = '';
      var fallbackDriveId = '';

      if (space === 'MY_DRIVE') {
        var myDriveParent = 'root';
        if (p.parentId && p.parentId !== 'root') {
          try {
            myDriveParent = sanitizeFolderId(p.parentId);
          } catch (err) {
            return Promise.resolve(invalidInputResult(err.message));
          }
        }
        query = "'" + myDriveParent + "' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
      } else if (space === 'SHARED_DRIVES') {
        if (!p.driveId || typeof p.driveId !== 'string' || p.driveId.trim() === '') {
          return Promise.resolve(invalidInputResult('共有ドライブIDが指定されていません。'));
        }
        var cleanDriveId;
        try {
          cleanDriveId = sanitizeFolderId(p.driveId);
        } catch (err) {
          return Promise.resolve(invalidInputResult(err.message));
        }

        var driveParent = cleanDriveId;
        if (p.parentId && p.parentId !== cleanDriveId) {
          try {
            driveParent = sanitizeFolderId(p.parentId);
          } catch (err) {
            return Promise.resolve(invalidInputResult(err.message));
          }
        }

        fallbackDriveId = cleanDriveId;
        query = "'" + driveParent + "' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
        urlParams.set('corpora', 'drive');
        urlParams.set('driveId', cleanDriveId);
      } else if (space === 'SHARED_WITH_ME') {
        if (p.parentId) {
          var sharedParent;
          try {
            sharedParent = sanitizeFolderId(p.parentId);
          } catch (err) {
            return Promise.resolve(invalidInputResult(err.message));
          }
          query = "'" + sharedParent + "' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
        } else {
          query = "sharedWithMe = true and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
        }
      } else {
        return Promise.resolve(invalidInputResult('無効なフォルダ空間が指定されました。'));
      }

      urlParams.set('q', query);
      urlParams.set('fields', 'nextPageToken,files(id,name,driveId)');
      urlParams.set('orderBy', 'name');
      urlParams.set('pageSize', String(clampedSize));
      urlParams.set('supportsAllDrives', 'true');
      urlParams.set('includeItemsFromAllDrives', 'true');
      if (p.pageToken) {
        urlParams.set('pageToken', String(p.pageToken));
      }

      var url = DRIVE_FILES_API_BASE + '?' + urlParams.toString();
      return executeBrowseFetch(url, 'フォルダ一覧', signal, function (payload) {
        var files = Array.isArray(payload.files) ? payload.files : [];
        return {
          items: files.map(function (f) {
            return normalizeFolderItem(f, fallbackDriveId, false);
          }),
          nextPageToken: payload.nextPageToken ? String(payload.nextPageToken) : null
        };
      });
    }

    /**
     * ユーザーがアクセス可能な共有ドライブ一覧を取得する（1ページ分）
     * @param {Object} [params]
     * @param {string} [params.pageToken]
     * @param {number} [params.pageSize]
     * @param {{ isCancelled?: Function }} [signal]
     * @return {Promise<Object>}
     */
    function listSharedDrives(params, signal) {
      var p = params || {};
      var clampedSize = clampPageSize(p.pageSize, 100, 100);
      var urlParams = new URLSearchParams();
      urlParams.set('fields', 'nextPageToken,drives(id,name)');
      urlParams.set('pageSize', String(clampedSize));
      if (p.pageToken) {
        urlParams.set('pageToken', String(p.pageToken));
      }

      var url = DRIVE_DRIVES_API_BASE + '?' + urlParams.toString();
      return executeBrowseFetch(url, '共有ドライブ一覧', signal, function (payload) {
        var drives = Array.isArray(payload.drives) ? payload.drives : [];
        return {
          items: drives.map(function (d) {
            return normalizeFolderItem(d, d && d.id, true);
          }),
          nextPageToken: payload.nextPageToken ? String(payload.nextPageToken) : null
        };
      });
    }

    /**
     * フォルダ名キーワードでフォルダを検索する（マイドライブ＋共有ドライブ横断）
     * @param {Object} params
     * @param {string} params.keyword
     * @param {string} [params.pageToken]
     * @param {number} [params.pageSize]
     * @param {{ isCancelled?: Function }} [signal]
     * @return {Promise<Object>}
     */
    function searchFolders(params, signal) {
      var p = params || {};
      var cleanKeyword = sanitizeSearchQuery(typeof p.keyword === 'string' ? p.keyword : '');
      if (!cleanKeyword) {
        return Promise.resolve(invalidInputResult('検索キーワードを入力してください。'));
      }

      var clampedSize = clampPageSize(p.pageSize, 100, 1000);
      var query = "mimeType = 'application/vnd.google-apps.folder' and trashed = false and name contains '" + cleanKeyword + "'";

      var urlParams = new URLSearchParams();
      urlParams.set('q', query);
      urlParams.set('fields', 'nextPageToken,files(id,name,driveId)');
      urlParams.set('corpora', 'allDrives');
      urlParams.set('orderBy', 'name');
      urlParams.set('pageSize', String(clampedSize));
      urlParams.set('supportsAllDrives', 'true');
      urlParams.set('includeItemsFromAllDrives', 'true');
      if (p.pageToken) {
        urlParams.set('pageToken', String(p.pageToken));
      }

      var url = DRIVE_FILES_API_BASE + '?' + urlParams.toString();
      return executeBrowseFetch(url, 'フォルダ検索', signal, function (payload) {
        var files = Array.isArray(payload.files) ? payload.files : [];
        return {
          items: files.map(function (f) {
            return normalizeFolderItem(f, '', false);
          }),
          nextPageToken: payload.nextPageToken ? String(payload.nextPageToken) : null
        };
      });
    }

    return {
      getFolderDetails: getFolderDetails,
      getHtmlFileList: getHtmlFileList,
      searchHtmlFiles: searchHtmlFiles,
      getHtmlFileContent: getHtmlFileContent,
      listSubfolders: listSubfolders,
      listSharedDrives: listSharedDrives,
      searchFolders: searchFolders
    };
  }

  var exported = {
    DRIVE_FILES_API_BASE: DRIVE_FILES_API_BASE,
    DRIVE_DRIVES_API_BASE: DRIVE_DRIVES_API_BASE,
    sanitizeSearchQuery: sanitizeSearchQuery,
    isHtmlDriveFile: isHtmlDriveFile,
    formatDriveTimestamp: formatDriveTimestamp,
    mapDriveHttpError: mapDriveHttpError,
    createDriveApiClient: createDriveApiClient
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.HttpViewer = root.HttpViewer || {};
    root.HttpViewer.DriveApi = exported;
    root.HttpViewer.createDriveApiClient = createDriveApiClient;
  }
})(typeof window !== 'undefined' ? window : globalThis);
