/**
 * Google Identity Services (GIS) 認証管理モジュール（AuthService）
 *
 * セキュリティ要件（NFR-2 / 設計書 Section 5）:
 *   - アクセストークン（accessToken）および有効期限（expiresAt）は
 *     createAuthService() 内のクロージャ変数にのみ厳格保持する。
 *   - localStorage / sessionStorage / window グローバル / DOM 属性には一切保存しない。
 *   - OAuth スコープは最小権限 https://www.googleapis.com/auth/drive.readonly のみ要求する。
 */
(function (root) {
  'use strict';

  var DEFAULT_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
  var DEFAULT_WAIT_TIMEOUT_MS = 10000;
  var TOKEN_EXPIRY_SAFETY_MARGIN_SEC = 60;

  /**
   * 認証サービスインスタンスを生成する
   * @param {Object} [serviceOptions]
   * @param {string} [serviceOptions.scope]
   * @param {number} [serviceOptions.waitForGisTimeoutMs]
   * @param {Function} [serviceOptions.getGoogleOAuth2] テスト注入用 GIS OAuth2 取得関数
   * @return {Object} AuthService
   */
  function createAuthService(serviceOptions) {
    var baseOptions = serviceOptions || {};
    var scope = baseOptions.scope || DEFAULT_SCOPE;
    var waitForGisTimeoutMs = typeof baseOptions.waitForGisTimeoutMs === 'number'
      ? baseOptions.waitForGisTimeoutMs
      : DEFAULT_WAIT_TIMEOUT_MS;

    // ------------------------------------------------------------------
    // 機密情報: クロージャ内にのみ保持し、外部オブジェクト・ストレージへ露出しない
    // ------------------------------------------------------------------
    var accessToken = null;
    var expiresAt = null;
    var currentClientId = '';
    var status = 'UNCONFIGURED'; // 'UNCONFIGURED' | 'SIGNED_OUT' | 'AUTHENTICATING' | 'AUTHENTICATED' | 'EXPIRED'
    var errorMessage = '';
    var onAuthChangeCallback = null;
    var tokenClient = null;
    var pendingRequest = null;

    // 非同期待機・古いポップアップコールバック干渉を防止する世代カウンタ
    var authGeneration = 0;
    var clientGeneration = 0;
    var activeWaitHandle = null;

    function resolveGoogleOAuth2() {
      if (typeof baseOptions.getGoogleOAuth2 === 'function') {
        return baseOptions.getGoogleOAuth2();
      }
      if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
        return google.accounts.oauth2;
      }
      if (root && root.google && root.google.accounts && root.google.accounts.oauth2) {
        return root.google.accounts.oauth2;
      }
      return null;
    }

    function clearMemoryToken() {
      accessToken = null;
      expiresAt = null;
    }

    function getStateSnapshot() {
      var hasValid = Boolean(accessToken && expiresAt && Date.now() < expiresAt);
      var snapshot = {
        status: status,
        isAuthenticated: status === 'AUTHENTICATED' && hasValid,
        expiresAt: expiresAt
      };
      if (errorMessage) {
        snapshot.errorMessage = errorMessage;
      }
      return snapshot;
    }

    function emitAuthChange() {
      if (typeof onAuthChangeCallback === 'function') {
        try {
          onAuthChangeCallback(getStateSnapshot());
        } catch (err) {
          console.error('[AuthService] onAuthChange callback error:', err);
        }
      }
    }

    function cancelGisWaitIfAny(message) {
      if (activeWaitHandle) {
        var handle = activeWaitHandle;
        activeWaitHandle = null;
        if (handle.timer) {
          clearInterval(handle.timer);
        }
        handle.reject(new Error(message || '認証待機が中断されました。'));
      }
    }

    function rejectPendingIfAny(message) {
      cancelGisWaitIfAny(message);
      if (pendingRequest) {
        var rejectFn = pendingRequest.reject;
        pendingRequest = null;
        rejectFn(new Error(message));
      }
    }

    function waitForGisOAuth2(timeoutMs, expectedGeneration) {
      if (expectedGeneration !== authGeneration) {
        return Promise.reject(new Error('認証要求が中断されました。'));
      }

      var existing = resolveGoogleOAuth2();
      if (existing && typeof existing.initTokenClient === 'function') {
        return Promise.resolve(existing);
      }

      return new Promise(function (resolve, reject) {
        var startedAt = Date.now();
        var timer = setInterval(function () {
          if (expectedGeneration !== authGeneration) {
            clearInterval(timer);
            if (activeWaitHandle && activeWaitHandle.timer === timer) {
              activeWaitHandle = null;
            }
            reject(new Error('認証待機が中断されました。'));
            return;
          }

          var oauth2 = resolveGoogleOAuth2();
          if (oauth2 && typeof oauth2.initTokenClient === 'function') {
            clearInterval(timer);
            if (activeWaitHandle && activeWaitHandle.timer === timer) {
              activeWaitHandle = null;
            }
            resolve(oauth2);
            return;
          }

          if (Date.now() - startedAt >= timeoutMs) {
            clearInterval(timer);
            if (activeWaitHandle && activeWaitHandle.timer === timer) {
              activeWaitHandle = null;
            }
            reject(new Error('Google 認証ライブラリ（GIS）の読み込みに失敗しました。広告ブロッカーや通信環境を確認してください。'));
          }
        }, 100);

        activeWaitHandle = {
          timer: timer,
          reject: reject
        };
      });
    }

    function ensureTokenClient(oauth2) {
      if (tokenClient) {
        return tokenClient;
      }

      var boundClientGen = clientGeneration;
      tokenClient = oauth2.initTokenClient({
        client_id: currentClientId,
        scope: scope,
        callback: function (response) {
          if (boundClientGen !== clientGeneration || !pendingRequest) {
            // 古い clientId 時代のコールバックやキャンセル済み要求の応答は無視する
            return;
          }
          if (pendingRequest.generation !== authGeneration) {
            return;
          }

          var currentPending = pendingRequest;
          pendingRequest = null;

          if (!response || response.error) {
            clearMemoryToken();
            status = currentPending.previousStatus;
            errorMessage = (response && (response.error_description || response.error))
              ? String(response.error_description || response.error)
              : 'Google サインインに失敗しました。';
            emitAuthChange();
            currentPending.reject(new Error(errorMessage));
            return;
          }

          if (!response.access_token || typeof response.access_token !== 'string') {
            clearMemoryToken();
            status = currentPending.previousStatus;
            errorMessage = '有効なアクセストークンを取得できませんでした。';
            emitAuthChange();
            currentPending.reject(new Error(errorMessage));
            return;
          }

          var expiresInSec = Number(response.expires_in || 3600);
          if (!isFinite(expiresInSec) || expiresInSec <= 0) {
            expiresInSec = 3600;
          }

          accessToken = response.access_token;
          expiresAt = Date.now() + Math.max(0, expiresInSec - TOKEN_EXPIRY_SAFETY_MARGIN_SEC) * 1000;
          status = 'AUTHENTICATED';
          errorMessage = '';
          emitAuthChange();
          currentPending.resolve(accessToken);
        },
        error_callback: function (err) {
          if (boundClientGen !== clientGeneration || !pendingRequest) {
            return;
          }
          if (pendingRequest.generation !== authGeneration) {
            return;
          }

          var currentPending = pendingRequest;
          pendingRequest = null;

          var errType = err && err.type ? String(err.type) : '';
          var msg = 'Google サインインを完了できませんでした。';
          if (errType === 'popup_closed') {
            msg = 'ログインポップアップが閉じられました。もう一度サインインをお試しください。';
          } else if (errType === 'popup_failed_to_open') {
            msg = 'ポップアップがブラウザにブロックされました。ポップアップを許可して再試行してください。';
          } else if (err && err.message) {
            msg = String(err.message);
          }

          status = currentPending.previousStatus;
          errorMessage = msg;
          emitAuthChange();
          currentPending.reject(new Error(msg));
        }
      });

      return tokenClient;
    }

    /**
     * AuthService を初期化する
     * @param {string} clientId
     * @param {Function} onAuthChange
     * @param {Object} [initOptions]
     */
    function init(clientId, onAuthChange, initOptions) {
      if (initOptions && typeof initOptions === 'object') {
        if (initOptions.scope) scope = initOptions.scope;
        if (typeof initOptions.waitForGisTimeoutMs === 'number') {
          waitForGisTimeoutMs = initOptions.waitForGisTimeoutMs;
        }
        if (typeof initOptions.getGoogleOAuth2 === 'function') {
          baseOptions.getGoogleOAuth2 = initOptions.getGoogleOAuth2;
        }
      }

      authGeneration++;
      clientGeneration++;
      currentClientId = typeof clientId === 'string' ? clientId.trim() : '';
      onAuthChangeCallback = typeof onAuthChange === 'function' ? onAuthChange : null;

      rejectPendingIfAny('認証状態が再初期化されました。');
      clearMemoryToken();
      tokenClient = null;
      errorMessage = '';
      status = currentClientId !== '' ? 'SIGNED_OUT' : 'UNCONFIGURED';
      emitAuthChange();
    }

    /**
     * OAuth Client ID 変更時に既存トークンを破棄し再初期化する
     * @param {string} newClientId
     */
    function reinit(newClientId) {
      var normalized = typeof newClientId === 'string' ? newClientId.trim() : '';
      if (normalized === currentClientId) {
        return;
      }

      authGeneration++;
      clientGeneration++;
      rejectPendingIfAny('設定変更により認証状態がリセットされました。');

      var tokenToRevoke = accessToken;
      clearMemoryToken();
      tokenClient = null;
      currentClientId = normalized;
      errorMessage = '';
      status = currentClientId !== '' ? 'SIGNED_OUT' : 'UNCONFIGURED';

      if (tokenToRevoke) {
        var oauth2 = resolveGoogleOAuth2();
        if (oauth2 && typeof oauth2.revoke === 'function') {
          try {
            oauth2.revoke(tokenToRevoke, function () {});
          } catch (e) {
            console.warn('[AuthService] token revoke on reinit failed:', e);
          }
        }
      }

      emitAuthChange();
    }

    /**
     * Google OAuth 2.0 サインインポップアップを起動してアクセストークンを取得する
     * @param {''|'consent'|'select_account'} [prompt]
     * @return {Promise<string>}
     */
    function signIn(prompt) {
      if (!currentClientId) {
        return Promise.reject(new Error('OAuth Client ID が設定されていません。右上の設定ボタンから入力してください。'));
      }

      var previousStatus = (status === 'EXPIRED') ? 'EXPIRED' : 'SIGNED_OUT';
      var reqGeneration = ++authGeneration;

      rejectPendingIfAny('新しいサインイン要求により中断されました。');

      status = 'AUTHENTICATING';
      errorMessage = '';
      emitAuthChange();

      return waitForGisOAuth2(waitForGisTimeoutMs, reqGeneration)
        .then(function (oauth2) {
          if (reqGeneration !== authGeneration || !currentClientId) {
            throw new Error('認証要求が中断されました。');
          }

          var client = ensureTokenClient(oauth2);
          return new Promise(function (resolve, reject) {
            if (reqGeneration !== authGeneration || !currentClientId) {
              reject(new Error('認証要求が中断されました。'));
              return;
            }

            pendingRequest = {
              resolve: resolve,
              reject: reject,
              previousStatus: previousStatus,
              generation: reqGeneration
            };

            try {
              var overrideConfig = {};
              if (typeof prompt === 'string') {
                overrideConfig.prompt = prompt;
              }
              client.requestAccessToken(overrideConfig);
            } catch (err) {
              var failedPending = pendingRequest;
              pendingRequest = null;
              if (reqGeneration === authGeneration && status === 'AUTHENTICATING') {
                status = previousStatus;
                errorMessage = err && err.message ? err.message : 'サインインポップアップの起動に失敗しました。';
                emitAuthChange();
              }
              if (failedPending) {
                failedPending.reject(new Error(err && err.message ? err.message : 'サインインポップアップの起動に失敗しました。'));
              }
            }
          });
        })
        .catch(function (err) {
          if (reqGeneration === authGeneration && status === 'AUTHENTICATING') {
            status = previousStatus;
            errorMessage = err && err.message ? err.message : 'Google 認証を開始できませんでした。';
            emitAuthChange();
          }
          throw err;
        });
    }

    /**
     * サインアウトし、メモリ上のアクセストークンを破棄・失効させる
     * @return {Promise<void>}
     */
    function signOut() {
      authGeneration++;
      clientGeneration++;
      rejectPendingIfAny('サインアウトによりキャンセルされました。');

      var tokenToRevoke = accessToken;
      clearMemoryToken();
      tokenClient = null;
      errorMessage = '';
      status = currentClientId !== '' ? 'SIGNED_OUT' : 'UNCONFIGURED';
      emitAuthChange();

      if (!tokenToRevoke) {
        return Promise.resolve();
      }

      var oauth2 = resolveGoogleOAuth2();
      if (!oauth2 || typeof oauth2.revoke !== 'function') {
        return Promise.resolve();
      }

      return new Promise(function (resolve) {
        try {
          oauth2.revoke(tokenToRevoke, function () {
            resolve();
          });
        } catch (e) {
          console.warn('[AuthService] revoke error:', e);
          resolve();
        }
      });
    }

    /**
     * Drive API からの 401 応答時にセッション期限切れ状態へ遷移させる
     * 注意: 未認証状態（UNCONFIGURED / SIGNED_OUT / AUTHENTICATING）からは EXPIRED へ上書きしない
     */
    function handleUnauthorized() {
      clearMemoryToken();
      if (status !== 'AUTHENTICATED' && status !== 'EXPIRED') {
        return;
      }

      if (currentClientId !== '') {
        status = 'EXPIRED';
        errorMessage = 'セッションの有効期限が切れました。再認証してください。';
      } else {
        status = 'UNCONFIGURED';
        errorMessage = '';
      }
      emitAuthChange();
    }

    /**
     * 有効期限内のアクセストークンを返す（未認証・期限切れ時は null）
     * @return {string|null}
     */
    function getValidToken() {
      if (!accessToken || !expiresAt) {
        return null;
      }
      if (Date.now() >= expiresAt) {
        return null;
      }
      return accessToken;
    }

    /**
     * 現在の認証状態スナップショットを返す（生トークンは含まない）
     * @return {Object}
     */
    function getState() {
      return getStateSnapshot();
    }

    return {
      init: init,
      reinit: reinit,
      signIn: signIn,
      signOut: signOut,
      handleUnauthorized: handleUnauthorized,
      getValidToken: getValidToken,
      getState: getState
    };
  }

  var exported = {
    DEFAULT_SCOPE: DEFAULT_SCOPE,
    createAuthService: createAuthService
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.HttpViewer = root.HttpViewer || {};
    root.HttpViewer.AuthService = exported;
    root.HttpViewer.createAuthService = createAuthService;
  }
})(typeof window !== 'undefined' ? window : globalThis);
