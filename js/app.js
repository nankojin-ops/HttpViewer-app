/**
 * アプリケーション状態調停・UI コントローラモジュール（AppStateController）
 *
 * 認証（AuthService）、設定（AppConfigProvider）、フォルダ解決（FolderResolver）、
 * Drive API v3（DriveApiClient）、Google Picker（PickerService）、および DOM UI を統合する。
 */
(function (root) {
  'use strict';

  var StorageMod = (typeof module !== 'undefined' && module.exports)
    ? require('./storage.js')
    : (root.HttpViewer || {});

  var FolderResolverMod = (typeof module !== 'undefined' && module.exports)
    ? require('./folder-resolver.js')
    : ((root.HttpViewer && root.HttpViewer.FolderResolver) || root.HttpViewer || {});

  var ConfigMod = (typeof module !== 'undefined' && module.exports)
    ? require('./config.js')
    : ((root.HttpViewer && root.HttpViewer.AppConfigProvider) || {});

  var AuthMod = (typeof module !== 'undefined' && module.exports)
    ? require('./auth.js')
    : ((root.HttpViewer && root.HttpViewer.AuthService) || {});

  var DriveApiMod = (typeof module !== 'undefined' && module.exports)
    ? require('./drive-api.js')
    : ((root.HttpViewer && root.HttpViewer.DriveApi) || {});

  var PickerMod = (typeof module !== 'undefined' && module.exports)
    ? require('./picker.js')
    : ((root.HttpViewer && root.HttpViewer.PickerService) || {});

  var SELF_HEAL_ERROR_CODES = {
    NOT_FOUND: true,
    FORBIDDEN: true,
    TRASHED: true,
    NOT_A_FOLDER: true,
    INVALID_INPUT: true
  };

  /**
   * バイト数を人間が読みやすい単位へフォーマットする
   * @param {number} bytes
   * @return {string}
   */
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    if (i < 0) i = 0;
    if (i >= sizes.length) i = sizes.length - 1;
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * HTML 特殊文字をエスケープする（XSS 防御）
   * @param {string} str
   * @return {string}
   */
  function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 設定値の出典ラベルを返す
   * @param {'LOCAL_STORAGE'|'CONFIG_FILE'|'NONE'} source
   * @return {{ text: string, badgeClass: string }}
   */
  function getSourceLabelInfo(source) {
    if (source === 'LOCAL_STORAGE') {
      return {
        text: 'ブラウザ保存値で上書き中',
        badgeClass: 'bg-blue-50 text-blue-700 border-blue-200'
      };
    }
    if (source === 'CONFIG_FILE') {
      return {
        text: '設定ファイル既定値 (config.js)',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200'
      };
    }
    return {
      text: '未設定',
      badgeClass: 'bg-slate-100 text-slate-500 border-slate-200'
    };
  }

  /**
   * ブラウザ DOM 用の UI アダプターを生成する
   * @param {Document} doc
   * @return {Object}
   */
  function createDomUiAdapter(doc) {
    var listPane = doc.getElementById('listPane');
    var previewPane = doc.getElementById('previewPane');
    var changeFolderBtn = doc.getElementById('changeFolderBtn');
    var currentFolderNameEl = doc.getElementById('currentFolderName');
    var searchInput = doc.getElementById('searchInput');
    var clearSearchBtn = doc.getElementById('clearSearchBtn');
    var fileListContainer = doc.getElementById('fileListContainer');
    var fileCountText = doc.getElementById('fileCountText');
    var currentFileName = doc.getElementById('currentFileName');
    var previewActions = doc.getElementById('previewActions');
    var previewFrame = doc.getElementById('previewFrame');
    var emptyState = doc.getElementById('emptyState');
    var previewLoading = doc.getElementById('previewLoading');
    var statusBadge = doc.getElementById('statusBadge');

    // ヘッダー認証・設定ボタン、バナー、オーバーレイ
    var authActionBtn = doc.getElementById('authActionBtn');
    var authActionLabel = doc.getElementById('authActionLabel');
    var expiredBanner = doc.getElementById('expiredBanner');
    var authOverlay = doc.getElementById('authOverlay');
    var authOverlayUnconfigured = doc.getElementById('authOverlayUnconfigured');
    var authOverlaySignIn = doc.getElementById('authOverlaySignIn');
    var authOverlayLoading = doc.getElementById('authOverlayLoading');
    var authOverlayError = doc.getElementById('authOverlayError');

    // 手動フォルダ入力モーダル
    var manualFolderModal = doc.getElementById('manualFolderModal');
    var folderIdInput = doc.getElementById('folderIdInput');

    // GCP 設定モーダル
    var settingsModal = doc.getElementById('settingsModal');
    var configClientIdInput = doc.getElementById('configClientId');
    var configApiKeyInput = doc.getElementById('configApiKey');
    var configAppIdInput = doc.getElementById('configAppId');
    var configDefaultFolderIdInput = doc.getElementById('configDefaultFolderId');
    var settingsErrorMsg = doc.getElementById('settingsErrorMsg');
    var resetSettingsBtn = doc.getElementById('resetSettingsBtn');

    var sourceBadges = {
      clientId: doc.getElementById('sourceBadgeClientId'),
      apiKey: doc.getElementById('sourceBadgeApiKey'),
      appId: doc.getElementById('sourceBadgeAppId'),
      defaultFolderId: doc.getElementById('sourceBadgeDefaultFolderId')
    };

    // トースト
    var toastEl = doc.getElementById('toast');
    var toastTitle = doc.getElementById('toastTitle');
    var toastMessage = doc.getElementById('toastMessage');
    var toastTimer = null;
    var currentMobileView = 'list';

    function showToast(title, message, variant) {
      if (!toastEl) return;
      toastTitle.textContent = title || '通知';
      toastMessage.textContent = message || '';

      toastEl.classList.remove('bg-rose-600', 'bg-emerald-600', 'bg-slate-800', 'hidden');
      if (variant === 'success') {
        toastEl.classList.add('bg-emerald-600');
      } else if (variant === 'info') {
        toastEl.classList.add('bg-slate-800');
      } else {
        toastEl.classList.add('bg-rose-600');
      }

      if (toastTimer) {
        clearTimeout(toastTimer);
      }
      toastTimer = setTimeout(function () {
        hideToast();
      }, 7000);
    }

    function hideToast() {
      if (toastEl) {
        toastEl.classList.add('hidden');
      }
    }

    function setStatus(text, colorClass) {
      if (!statusBadge) return;
      statusBadge.innerHTML =
        '<span class="w-2 h-2 rounded-full ' + escapeHtml(colorClass) + '"></span>' +
        '<span class="hidden sm:inline">' + escapeHtml(text) + '</span>';
    }

    function switchMobileView(view) {
      currentMobileView = view;
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        if (view === 'preview') {
          listPane.classList.add('hidden');
          previewPane.classList.remove('hidden');
          previewPane.classList.add('flex', 'w-full');
        } else {
          previewPane.classList.add('hidden');
          previewPane.classList.remove('flex', 'w-full');
          listPane.classList.remove('hidden');
        }
      } else {
        listPane.classList.remove('hidden');
        previewPane.classList.remove('hidden');
        previewPane.classList.add('flex');
      }
    }

    function getCurrentMobileView() {
      return currentMobileView;
    }

    function renderFileList(files, activeFileId, onSelectFile, emptyCountText) {
      fileListContainer.innerHTML = '';

      if (!files || files.length === 0) {
        fileCountText.textContent = emptyCountText || '0 件のファイル';
        fileListContainer.innerHTML =
          '<div class="p-8 text-center text-slate-400 text-xs">' +
            '<p class="mb-1">一致するHTMLファイルが見つかりません</p>' +
            '<p class="text-slate-300">検索ワードまたはフォルダをご確認ください</p>' +
          '</div>';
        return;
      }

      fileCountText.textContent = files.length + ' 件のファイル';

      files.forEach(function (file) {
        var item = doc.createElement('div');
        var isActive = file.id === activeFileId;
        item.dataset.fileId = file.id;
        item.className = 'p-3 cursor-pointer transition-colors border-l-4 ' +
          (isActive
            ? 'bg-blue-50/70 border-blue-600 text-blue-950 font-medium'
            : 'border-transparent hover:bg-slate-50 active:bg-slate-100 text-slate-700');

        item.innerHTML =
          '<div class="flex items-start justify-between gap-2">' +
            '<h3 class="text-sm font-medium leading-snug break-all line-clamp-2">' + escapeHtml(file.name) + '</h3>' +
          '</div>' +
          '<div class="mt-1 flex items-center gap-3 text-xs text-slate-400">' +
            '<span>' + escapeHtml(formatBytes(file.size)) + '</span>' +
            '<span>&bull;</span>' +
            '<span>' + escapeHtml(file.updated || '') + '</span>' +
          '</div>';

        item.addEventListener('click', function () {
          if (typeof onSelectFile === 'function') {
            onSelectFile(file);
          }
        });

        fileListContainer.appendChild(item);
      });
    }

    function highlightActiveFile(fileId) {
      doc.querySelectorAll('#fileListContainer > div').forEach(function (node) {
        if (fileId && node.dataset && node.dataset.fileId === fileId) {
          node.classList.remove('border-transparent', 'hover:bg-slate-50', 'text-slate-700');
          node.classList.add('bg-blue-50/70', 'border-blue-600', 'text-blue-950', 'font-medium');
        } else {
          node.classList.remove('bg-blue-50/70', 'border-blue-600', 'text-blue-950', 'font-medium');
          node.classList.add('border-transparent', 'hover:bg-slate-50', 'text-slate-700');
        }
      });
    }

    function setFolderName(name) {
      if (currentFolderNameEl) {
        currentFolderNameEl.textContent = name || '';
      }
    }

    function setFileCountText(text) {
      if (fileCountText) {
        fileCountText.textContent = text || '';
      }
    }

    function getSearchQuery() {
      return searchInput ? searchInput.value : '';
    }

    function clearSearchInput() {
      if (searchInput) searchInput.value = '';
      if (clearSearchBtn) clearSearchBtn.classList.add('hidden');
    }

    function showPreviewLoading(fileName) {
      if (currentFileName && fileName !== undefined) {
        currentFileName.textContent = fileName;
      }
      if (previewActions) previewActions.classList.remove('hidden');
      if (emptyState) emptyState.classList.add('hidden');
      if (previewLoading) previewLoading.classList.remove('hidden');
    }

    function hidePreviewLoading() {
      if (previewLoading) previewLoading.classList.add('hidden');
    }

    function restorePreviewHeader(fileName) {
      if (currentFileName) {
        currentFileName.textContent = fileName || 'ファイルが選択されていません';
      }
      if (previewActions) previewActions.classList.remove('hidden');
      if (emptyState) emptyState.classList.add('hidden');
      if (previewLoading) previewLoading.classList.add('hidden');
    }

    function setPreviewContent(htmlContent) {
      if (previewFrame) {
        previewFrame.srcdoc = htmlContent || '';
      }
    }

    function resetPreview() {
      if (previewFrame) previewFrame.srcdoc = '';
      if (currentFileName) currentFileName.textContent = 'ファイルが選択されていません';
      if (previewActions) previewActions.classList.add('hidden');
      if (previewLoading) previewLoading.classList.add('hidden');
      if (emptyState) emptyState.classList.remove('hidden');
    }

    function clearListArea(message) {
      if (fileListContainer) fileListContainer.innerHTML = '';
      if (fileCountText) fileCountText.textContent = message || '未認証';
    }

    function renderAuthState(authState) {
      var st = authState.status;

      // ヘッダー認証ボタンの更新
      if (authActionBtn && authActionLabel) {
        authActionBtn.classList.remove(
          'bg-blue-600', 'hover:bg-blue-700', 'text-white',
          'bg-amber-600', 'hover:bg-amber-700',
          'bg-slate-100', 'hover:bg-slate-200', 'text-slate-700', 'border', 'border-slate-200'
        );
        authActionBtn.disabled = false;

        if (st === 'UNCONFIGURED') {
          authActionLabel.textContent = '初期設定';
          authActionBtn.classList.add('bg-blue-600', 'hover:bg-blue-700', 'text-white');
        } else if (st === 'SIGNED_OUT') {
          authActionLabel.textContent = 'サインイン';
          authActionBtn.classList.add('bg-blue-600', 'hover:bg-blue-700', 'text-white');
        } else if (st === 'AUTHENTICATING') {
          authActionLabel.textContent = '認証中...';
          authActionBtn.classList.add('bg-slate-100', 'text-slate-700', 'border', 'border-slate-200');
          authActionBtn.disabled = true;
        } else if (st === 'EXPIRED') {
          authActionLabel.textContent = '再認証';
          authActionBtn.classList.add('bg-amber-600', 'hover:bg-amber-700', 'text-white');
        } else {
          authActionLabel.textContent = 'サインアウト';
          authActionBtn.classList.add('bg-slate-100', 'hover:bg-slate-200', 'text-slate-700', 'border', 'border-slate-200');
        }
      }

      // フォルダ切替ボタン活性制御
      if (changeFolderBtn) {
        changeFolderBtn.disabled = (st === 'UNCONFIGURED' || st === 'SIGNED_OUT' || st === 'AUTHENTICATING');
      }

      // 401 期限切れバナー制御
      if (expiredBanner) {
        if (st === 'EXPIRED') {
          expiredBanner.classList.remove('hidden');
        } else {
          expiredBanner.classList.add('hidden');
        }
      }

      // メイン領域オーバーレイ制御（EXPIRED と AUTHENTICATED では非表示にして作業状態を保持）
      if (authOverlay) {
        if (st === 'UNCONFIGURED' || st === 'SIGNED_OUT' || st === 'AUTHENTICATING') {
          authOverlay.classList.remove('hidden');
        } else {
          authOverlay.classList.add('hidden');
        }
      }

      if (authOverlayUnconfigured && authOverlaySignIn && authOverlayLoading) {
        authOverlayUnconfigured.classList.add('hidden');
        authOverlaySignIn.classList.add('hidden');
        authOverlayLoading.classList.add('hidden');

        if (st === 'UNCONFIGURED') {
          authOverlayUnconfigured.classList.remove('hidden');
          setStatus('初期設定が必要', 'bg-amber-500');
          setFolderName('初期設定待ち');
        } else if (st === 'SIGNED_OUT') {
          authOverlaySignIn.classList.remove('hidden');
          setStatus('未サインイン', 'bg-slate-400');
          setFolderName('サインイン待ち');
        } else if (st === 'AUTHENTICATING') {
          authOverlayLoading.classList.remove('hidden');
          setStatus('認証中...', 'bg-blue-500 animate-pulse');
        } else if (st === 'EXPIRED') {
          setStatus('セッション期限切れ', 'bg-amber-500');
        }
      }

      if (authOverlayError) {
        if (authState.errorMessage && st === 'SIGNED_OUT') {
          authOverlayError.textContent = authState.errorMessage;
          authOverlayError.classList.remove('hidden');
        } else {
          authOverlayError.textContent = '';
          authOverlayError.classList.add('hidden');
        }
      }
    }

    function openManualFolderModal(initialValue) {
      if (!manualFolderModal) return;
      if (folderIdInput) folderIdInput.value = initialValue || '';
      manualFolderModal.classList.remove('hidden');
      setTimeout(function () {
        if (folderIdInput) folderIdInput.focus();
      }, 80);
    }

    function closeManualFolderModal() {
      if (manualFolderModal) {
        manualFolderModal.classList.add('hidden');
      }
    }

    function getManualFolderInput() {
      return folderIdInput ? folderIdInput.value.trim() : '';
    }

    function updateSourceBadge(badgeEl, source) {
      if (!badgeEl) return;
      var info = getSourceLabelInfo(source);
      badgeEl.textContent = info.text;
      badgeEl.className = 'text-[11px] px-2 py-0.5 rounded-full border ' + info.badgeClass;
    }

    function openSettingsModal(resolvedConfig) {
      if (!settingsModal) return;
      var cfg = resolvedConfig || {};
      var sources = cfg.sources || {};

      if (configClientIdInput) configClientIdInput.value = cfg.clientId || '';
      if (configApiKeyInput) configApiKeyInput.value = cfg.apiKey || '';
      if (configAppIdInput) configAppIdInput.value = cfg.appId || '';
      if (configDefaultFolderIdInput) configDefaultFolderIdInput.value = cfg.defaultFolderId || '';

      updateSourceBadge(sourceBadges.clientId, sources.clientId || 'NONE');
      updateSourceBadge(sourceBadges.apiKey, sources.apiKey || 'NONE');
      updateSourceBadge(sourceBadges.appId, sources.appId || 'NONE');
      updateSourceBadge(sourceBadges.defaultFolderId, sources.defaultFolderId || 'NONE');

      if (resetSettingsBtn) {
        resetSettingsBtn.disabled = !cfg.hasLocalOverrides;
        if (cfg.hasLocalOverrides) {
          resetSettingsBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        } else {
          resetSettingsBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
      }

      if (settingsErrorMsg) {
        settingsErrorMsg.textContent = '';
        settingsErrorMsg.classList.add('hidden');
      }

      settingsModal.classList.remove('hidden');
      setTimeout(function () {
        if (configClientIdInput) configClientIdInput.focus();
      }, 80);
    }

    function closeSettingsModal() {
      if (settingsModal) {
        settingsModal.classList.add('hidden');
      }
    }

    function showSettingsError(message) {
      if (settingsErrorMsg) {
        settingsErrorMsg.textContent = message || '';
        settingsErrorMsg.classList.remove('hidden');
      }
    }

    function getSettingsFormValues() {
      return {
        clientId: configClientIdInput ? configClientIdInput.value : '',
        apiKey: configApiKeyInput ? configApiKeyInput.value : '',
        appId: configAppIdInput ? configAppIdInput.value : '',
        defaultFolderId: configDefaultFolderIdInput ? configDefaultFolderIdInput.value : ''
      };
    }

    return {
      showErrorToast: function (title, message) { showToast(title, message, 'error'); },
      showSuccessToast: function (title, message) { showToast(title, message, 'success'); },
      showInfoToast: function (title, message) { showToast(title, message, 'info'); },
      hideToast: hideToast,
      setStatus: setStatus,
      switchMobileView: switchMobileView,
      getCurrentMobileView: getCurrentMobileView,
      renderFileList: renderFileList,
      highlightActiveFile: highlightActiveFile,
      setFolderName: setFolderName,
      setFileCountText: setFileCountText,
      getSearchQuery: getSearchQuery,
      clearSearchInput: clearSearchInput,
      showPreviewLoading: showPreviewLoading,
      hidePreviewLoading: hidePreviewLoading,
      restorePreviewHeader: restorePreviewHeader,
      setPreviewContent: setPreviewContent,
      resetPreview: resetPreview,
      clearListArea: clearListArea,
      renderAuthState: renderAuthState,
      openManualFolderModal: openManualFolderModal,
      closeManualFolderModal: closeManualFolderModal,
      getManualFolderInput: getManualFolderInput,
      openSettingsModal: openSettingsModal,
      closeSettingsModal: closeSettingsModal,
      showSettingsError: showSettingsError,
      getSettingsFormValues: getSettingsFormValues
    };
  }

  /**
   * アプリケーション状態コントローラを生成する
   * @param {Object} deps
   * @return {Object} AppStateController
   */
  function createAppController(deps) {
    var d = deps || {};
    var configProvider = d.configProvider || ConfigMod;
    var storage = d.storage || StorageMod.SafeStorage;
    var storageKeys = d.storageKeys || StorageMod.STORAGE_KEYS;
    var folderResolver = d.folderResolver || FolderResolverMod;
    var authService = d.authService || AuthMod.createAuthService();
    var pickerService = d.pickerService || PickerMod.createPickerService();
    var ui = d.ui;
    var getSearchString = typeof d.getSearchString === 'function'
      ? d.getSearchString
      : function () {
        return (typeof window !== 'undefined' && window.location) ? window.location.search : '';
      };

    var driveApi = d.driveApi || DriveApiMod.createDriveApiClient({
      getAccessToken: function () {
        return authService.getValidToken();
      }
    });

    var resolvedConfig = null;
    var currentFolderId = '';
    var activeFileId = null;
    var currentRawHtml = null;
    var hasLoadedPreview = false;
    var lastLoadedFileName = '';
    var currentSearchRequestId = 0;
    var currentPreviewRequestId = 0;
    var searchDebounceTimer = null;
    var hasAttemptedFallback = false;
    var pendingRetryAction = null;
    var lastAuthStatus = null;

    function cancelPendingSearch() {
      if (searchDebounceTimer !== null) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
      }
    }

    function scheduleSearch(query, delayMs) {
      cancelPendingSearch();
      var waitMs = typeof delayMs === 'number' ? delayMs : 400;
      searchDebounceTimer = setTimeout(function () {
        searchDebounceTimer = null;
        executeSearch(query);
      }, waitMs);
    }

    function isSessionExpiredOrAuthenticated() {
      var st = authService.getState().status;
      return st === 'AUTHENTICATED' || st === 'EXPIRED';
    }

    function routeUnauthorizedOrAbort(retryAction) {
      if (isSessionExpiredOrAuthenticated()) {
        if (retryAction) {
          pendingRetryAction = retryAction;
        }
        authService.handleUnauthorized();
        return true;
      }
      return false;
    }

    function clearWorkingViewState() {
      cancelPendingSearch();
      currentFolderId = '';
      activeFileId = null;
      currentRawHtml = null;
      hasLoadedPreview = false;
      lastLoadedFileName = '';
      currentSearchRequestId++;
      currentPreviewRequestId++;
      pendingRetryAction = null;
      ui.clearSearchInput();
      ui.clearListArea('未認証');
      ui.resetPreview();
      ui.switchMobileView('list');
    }

    function applyFolder(folderId, folderName) {
      cancelPendingSearch();
      currentFolderId = folderId;
      hasAttemptedFallback = false;
      storage.set(storageKeys.LAST_FOLDER_ID, folderId);

      ui.setFolderName(folderName || '読み込み中...');
      ui.clearSearchInput();
      activeFileId = null;
      currentRawHtml = null;
      hasLoadedPreview = false;
      lastLoadedFileName = '';
      currentPreviewRequestId++;
      ui.resetPreview();
      ui.switchMobileView('list');

      return executeSearch('');
    }

    function handleFolderLoadError(failedFolderId, errorMessage) {
      storage.remove(storageKeys.LAST_FOLDER_ID);

      var defaultFolderId = resolvedConfig && resolvedConfig.defaultFolderId
        ? resolvedConfig.defaultFolderId
        : '';

      if (!hasAttemptedFallback && defaultFolderId && defaultFolderId !== failedFolderId) {
        hasAttemptedFallback = true;
        ui.showErrorToast(
          '前回フォルダ復元エラー',
          '前回開いていたフォルダにアクセスできないため、デフォルトフォルダへ切り替えます。'
        );
        currentFolderId = defaultFolderId;
        return executeSearch('');
      }

      ui.showErrorToast('フォルダエラー', errorMessage || 'フォルダが存在しないか、アクセス権限がありません。');
      ui.setFolderName('フォルダを選択');
      ui.setStatus('エラー', 'bg-rose-500');
      ui.renderFileList([], activeFileId, selectFile, 'フォルダを選択してください');
      ui.setFileCountText('フォルダを選択してください');
      openFolderSelection();
      return Promise.resolve();
    }

    function executeSearch(query) {
      var trimmed = typeof query === 'string' ? query : '';
      if (!authService.getValidToken()) {
        routeUnauthorizedOrAbort({ type: 'search', query: trimmed });
        return Promise.resolve({ success: false, errorCode: 'UNAUTHORIZED' });
      }

      if (!currentFolderId) {
        openFolderSelection();
        return Promise.resolve({ success: false, errorCode: 'INVALID_INPUT' });
      }

      var requestId = ++currentSearchRequestId;
      var signal = {
        isCancelled: function () {
          return requestId !== currentSearchRequestId;
        }
      };

      ui.setStatus(trimmed.trim() ? '検索中...' : '読み込み中...', 'bg-blue-500 animate-pulse');
      ui.setFileCountText('読み込み中...');

      var apiPromise = trimmed.trim() === ''
        ? driveApi.getHtmlFileList(currentFolderId, signal)
        : driveApi.searchHtmlFiles(trimmed, currentFolderId, signal);

      return apiPromise.then(function (response) {
        if (requestId !== currentSearchRequestId || response.cancelled) {
          return response;
        }

        if (response.success) {
          if (response.folder && response.folder.id) {
            currentFolderId = response.folder.id;
            storage.set(storageKeys.LAST_FOLDER_ID, currentFolderId);
          }
          if (response.folder && response.folder.name) {
            ui.setFolderName(response.folder.name);
          }
          ui.renderFileList(response.data, activeFileId, selectFile);
          ui.setStatus('準備完了', 'bg-emerald-500');
          if (response.truncated) {
            ui.showInfoToast('取得上限のお知らせ', 'ファイル数が非常に多いため、先頭の一覧のみ表示しています。検索機能をご活用ください。');
          }
          return response;
        }

        if (response.errorCode === 'UNAUTHORIZED') {
          routeUnauthorizedOrAbort({ type: 'search', query: trimmed });
          return response;
        }

        if (SELF_HEAL_ERROR_CODES[response.errorCode]) {
          return handleFolderLoadError(currentFolderId, response.error).then(function () {
            return response;
          });
        }

        // NETWORK_ERROR / RATE_LIMITED / API_DISABLED はフォルダ設定を誤消去しない
        ui.showErrorToast('読み込みエラー', response.error);
        ui.setStatus('エラー', 'bg-rose-500');
        ui.setFileCountText('エラー');
        return response;
      });
    }

    function rollbackPreviewSelection(prevActiveId, prevFileName, prevHasLoaded) {
      activeFileId = prevActiveId;
      ui.highlightActiveFile(prevActiveId);
      if (prevHasLoaded) {
        if (typeof ui.restorePreviewHeader === 'function') {
          ui.restorePreviewHeader(prevFileName);
        } else {
          ui.hidePreviewLoading();
        }
      } else {
        ui.resetPreview();
      }
    }

    function selectFile(file) {
      if (!file || !file.id) return Promise.resolve();

      if (!authService.getValidToken()) {
        routeUnauthorizedOrAbort({ type: 'preview', file: file });
        return Promise.resolve({ success: false, errorCode: 'UNAUTHORIZED' });
      }

      var prevActiveId = activeFileId;
      var prevFileName = lastLoadedFileName;
      var prevHasLoaded = hasLoadedPreview;

      var reqId = ++currentPreviewRequestId;
      activeFileId = file.id;
      ui.highlightActiveFile(file.id);
      ui.showPreviewLoading(file.name);
      ui.setStatus('読み込み中...', 'bg-amber-500 animate-pulse');
      ui.switchMobileView('preview');

      return driveApi.getHtmlFileContent(file.id, file.name).then(function (response) {
        if (reqId !== currentPreviewRequestId) {
          return response;
        }

        ui.hidePreviewLoading();

        if (response.success) {
          currentRawHtml = response.content !== undefined
            ? response.content
            : (response.data ? response.data.content : '');
          hasLoadedPreview = true;
          lastLoadedFileName = file.name || '';
          ui.setPreviewContent(currentRawHtml);
          ui.setStatus('表示中', 'bg-emerald-500');
          return response;
        }

        rollbackPreviewSelection(prevActiveId, prevFileName, prevHasLoaded);

        if (response.errorCode === 'UNAUTHORIZED') {
          routeUnauthorizedOrAbort({ type: 'preview', file: file });
          return response;
        }

        ui.showErrorToast('読み込み失敗', response.error);
        ui.setStatus('エラー', 'bg-rose-500');
        return response;
      });
    }

    function bootstrapInitialFolder() {
      var resolution = folderResolver.resolveInitialFolderId({
        urlParam: folderResolver.getClientUrlFolderId(getSearchString()),
        localStore: storage.get(storageKeys.LAST_FOLDER_ID),
        defaultProp: resolvedConfig ? resolvedConfig.defaultFolderId : ''
      });

      if (!resolution.folderId) {
        ui.setFolderName('フォルダを選択');
        ui.setStatus('フォルダ未設定', 'bg-amber-500');
        ui.renderFileList([], activeFileId, selectFile, 'フォルダを選択してください');
        ui.setFileCountText('フォルダを選択してください');
        openFolderSelection();
        return Promise.resolve();
      }

      currentFolderId = resolution.folderId;
      hasAttemptedFallback = false;
      return executeSearch('');
    }

    function handleAuthStateChange(state) {
      var prevStatus = lastAuthStatus;
      lastAuthStatus = state.status;
      ui.renderAuthState(state);

      if (state.status === 'UNCONFIGURED' || state.status === 'SIGNED_OUT') {
        var hasRemainingViewState =
          currentFolderId !== '' ||
          activeFileId !== null ||
          hasLoadedPreview ||
          pendingRetryAction !== null;

        if (prevStatus === 'AUTHENTICATED' || prevStatus === 'EXPIRED' || hasRemainingViewState) {
          clearWorkingViewState();
        } else {
          cancelPendingSearch();
          ui.clearListArea(state.status === 'UNCONFIGURED' ? '初期設定が必要です' : 'サインインしてください');
        }
        return;
      }

      if (state.status === 'AUTHENTICATED') {
        if (pendingRetryAction) {
          var retry = pendingRetryAction;
          pendingRetryAction = null;
          if (retry.type === 'preview' && retry.file) {
            selectFile(retry.file);
            return;
          }
          if (retry.type === 'manualFolder' && retry.inputVal) {
            submitManualFolder(retry.inputVal);
            return;
          }
          if (retry.type === 'openFolderSelection') {
            openFolderSelection();
            return;
          }
          executeSearch(retry.query || '');
          return;
        }
        bootstrapInitialFolder();
      }
    }

    function openFolderSelection() {
      if (!resolvedConfig || !resolvedConfig.isAuthConfigured) {
        openSettingsModal();
        return;
      }

      var token = authService.getValidToken();
      if (!token) {
        if (!routeUnauthorizedOrAbort({ type: 'openFolderSelection' })) {
          ui.showErrorToast('認証が必要です', 'フォルダを選択するには Google でサインインしてください。');
        }
        return;
      }

      if (!resolvedConfig.isPickerConfigured) {
        ui.openManualFolderModal(currentFolderId);
        return;
      }

      pickerService.openFolderPicker({
        accessToken: token,
        apiKey: resolvedConfig.apiKey,
        appId: resolvedConfig.appId,
        onPicked: function (folder) {
          applyFolder(folder.id, folder.name);
        },
        onFallbackToManual: function () {
          ui.openManualFolderModal(currentFolderId);
        }
      });
    }

    function submitManualFolder(explicitValue) {
      var val = typeof explicitValue === 'string' ? explicitValue.trim() : ui.getManualFolderInput();
      if (!val) {
        ui.showErrorToast('入力エラー', 'フォルダIDまたはURLを入力してください。');
        return Promise.resolve({ success: false, errorCode: 'INVALID_INPUT' });
      }

      if (!authService.getValidToken()) {
        ui.closeManualFolderModal();
        if (!routeUnauthorizedOrAbort({ type: 'manualFolder', inputVal: val })) {
          ui.showErrorToast('認証が必要です', 'フォルダを適用するには Google でサインインしてください。');
        }
        return Promise.resolve({ success: false, errorCode: 'UNAUTHORIZED' });
      }

      ui.setStatus('検証中...', 'bg-blue-500 animate-pulse');
      return driveApi.getFolderDetails(val).then(function (res) {
        if (res.success) {
          ui.closeManualFolderModal();
          return applyFolder(res.folder.id, res.folder.name).then(function () {
            return res;
          });
        }
        if (res.errorCode === 'UNAUTHORIZED') {
          ui.closeManualFolderModal();
          routeUnauthorizedOrAbort({ type: 'manualFolder', inputVal: val });
          return res;
        }
        ui.showErrorToast('指定エラー', res.error);
        ui.setStatus('エラー', 'bg-rose-500');
        return res;
      });
    }

    function reloadPreview() {
      if (hasLoadedPreview && activeFileId !== null) {
        ui.setPreviewContent('');
        setTimeout(function () {
          ui.setPreviewContent(currentRawHtml || '');
        }, 50);
      }
    }

    function handleAuthAction() {
      var st = authService.getState().status;
      if (st === 'UNCONFIGURED') {
        openSettingsModal();
      } else if (st === 'SIGNED_OUT' || st === 'EXPIRED') {
        authService.signIn('').catch(function (err) {
          ui.showErrorToast('認証エラー', err.message);
        });
      } else if (st === 'AUTHENTICATED') {
        cancelPendingSearch();
        authService.signOut();
      }
    }

    function openSettingsModal() {
      resolvedConfig = configProvider.loadConfig(undefined, storage);
      ui.openSettingsModal(resolvedConfig);
    }

    function saveSettings(explicitValues) {
      var values = explicitValues || ui.getSettingsFormValues();
      var prevClientId = resolvedConfig ? resolvedConfig.clientId : '';
      var prevDefaultFolder = resolvedConfig ? resolvedConfig.defaultFolderId : '';

      var res = configProvider.saveConfigOverrides(values, storage);
      if (!res.success) {
        ui.showSettingsError(res.error);
        return res;
      }

      resolvedConfig = res.config;
      ui.closeSettingsModal();
      ui.showSuccessToast('設定を保存しました', '変更内容を適用しました。');

      if (resolvedConfig.clientId !== prevClientId) {
        clearWorkingViewState();
        authService.reinit(resolvedConfig.clientId);
      } else if (
        authService.getValidToken() &&
        !currentFolderId &&
        resolvedConfig.defaultFolderId &&
        resolvedConfig.defaultFolderId !== prevDefaultFolder
      ) {
        applyFolder(resolvedConfig.defaultFolderId, '');
      }

      return res;
    }

    function resetSettings() {
      var prevClientId = resolvedConfig ? resolvedConfig.clientId : '';
      var cleared = configProvider.clearConfigOverrides(storage);
      if (!cleared) {
        ui.showErrorToast('リセットエラー', 'ブラウザ保存の上書き設定を削除できませんでした。ストレージ設定をご確認ください。');
        return false;
      }

      resolvedConfig = configProvider.loadConfig(undefined, storage);
      ui.openSettingsModal(resolvedConfig);
      ui.showInfoToast('初期設定に戻しました', 'ブラウザ保存の上書き設定を削除しました。');

      if (resolvedConfig.clientId !== prevClientId) {
        clearWorkingViewState();
        authService.reinit(resolvedConfig.clientId);
      }
      return true;
    }

    function init() {
      resolvedConfig = configProvider.loadConfig(undefined, storage);
      pickerService.load();
      authService.init(resolvedConfig.clientId, handleAuthStateChange);
    }

    return {
      init: init,
      applyFolder: applyFolder,
      executeSearch: executeSearch,
      scheduleSearch: scheduleSearch,
      cancelPendingSearch: cancelPendingSearch,
      selectFile: selectFile,
      openFolderSelection: openFolderSelection,
      submitManualFolder: submitManualFolder,
      reloadPreview: reloadPreview,
      handleAuthAction: handleAuthAction,
      openSettingsModal: openSettingsModal,
      saveSettings: saveSettings,
      resetSettings: resetSettings,
      getCurrentFolderId: function () { return currentFolderId; },
      getActiveFileId: function () { return activeFileId; },
      hasLoadedPreview: function () { return hasLoadedPreview; },
      getResolvedConfig: function () { return resolvedConfig; }
    };
  }

  /**
   * ブラウザ環境での初期化および DOM イベントバインド
   */
  function mountBrowserApp() {
    if (typeof document === 'undefined') {
      return null;
    }

    var ui = createDomUiAdapter(document);
    var pickerService = PickerMod.createPickerService();
    var controller = createAppController({
      ui: ui,
      pickerService: pickerService
    });

    var changeFolderBtn = document.getElementById('changeFolderBtn');
    var backToListBtn = document.getElementById('backToListBtn');
    var searchInput = document.getElementById('searchInput');
    var clearSearchBtn = document.getElementById('clearSearchBtn');
    var refreshBtn = document.getElementById('refreshBtn');
    var reloadPreviewBtn = document.getElementById('reloadPreviewBtn');
    var toastCloseBtn = document.getElementById('toastCloseBtn');

    // 手動フォルダモーダル
    var closeModalBtn = document.getElementById('closeModalBtn');
    var cancelModalBtn = document.getElementById('cancelModalBtn');
    var submitFolderBtn = document.getElementById('submitFolderBtn');
    var folderIdInput = document.getElementById('folderIdInput');

    // 認証・バナー・オーバーレイ
    var authActionBtn = document.getElementById('authActionBtn');
    var reauthBtn = document.getElementById('reauthBtn');
    var overlayOpenSettingsBtn = document.getElementById('overlayOpenSettingsBtn');
    var overlaySignInBtn = document.getElementById('overlaySignInBtn');
    var overlayConfigLinkBtn = document.getElementById('overlayConfigLinkBtn');

    // GCP 設定モーダル
    var openSettingsBtn = document.getElementById('openSettingsBtn');
    var closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');
    var cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
    var saveSettingsBtn = document.getElementById('saveSettingsBtn');
    var resetSettingsBtn = document.getElementById('resetSettingsBtn');

    if (changeFolderBtn) changeFolderBtn.addEventListener('click', controller.openFolderSelection);
    if (backToListBtn) backToListBtn.addEventListener('click', function () { ui.switchMobileView('list'); });
    if (toastCloseBtn) toastCloseBtn.addEventListener('click', ui.hideToast);

    if (closeModalBtn) closeModalBtn.addEventListener('click', ui.closeManualFolderModal);
    if (cancelModalBtn) cancelModalBtn.addEventListener('click', ui.closeManualFolderModal);
    if (submitFolderBtn) submitFolderBtn.addEventListener('click', function () { controller.submitManualFolder(); });
    if (folderIdInput) {
      folderIdInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          controller.submitManualFolder();
        }
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        var val = e.target.value;
        if (clearSearchBtn) {
          if (val.length > 0) {
            clearSearchBtn.classList.remove('hidden');
          } else {
            clearSearchBtn.classList.add('hidden');
          }
        }
        controller.scheduleSearch(val, 400);
      });
    }

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', function () {
        controller.cancelPendingSearch();
        ui.clearSearchInput();
        controller.executeSearch('');
        if (searchInput) searchInput.focus();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        controller.cancelPendingSearch();
        controller.executeSearch(ui.getSearchQuery());
      });
    }

    if (reloadPreviewBtn) {
      reloadPreviewBtn.addEventListener('click', controller.reloadPreview);
    }

    if (authActionBtn) authActionBtn.addEventListener('click', controller.handleAuthAction);
    if (reauthBtn) reauthBtn.addEventListener('click', controller.handleAuthAction);
    if (overlayOpenSettingsBtn) overlayOpenSettingsBtn.addEventListener('click', controller.openSettingsModal);
    if (overlaySignInBtn) overlaySignInBtn.addEventListener('click', controller.handleAuthAction);
    if (overlayConfigLinkBtn) overlayConfigLinkBtn.addEventListener('click', controller.openSettingsModal);

    if (openSettingsBtn) openSettingsBtn.addEventListener('click', controller.openSettingsModal);
    if (closeSettingsModalBtn) closeSettingsModalBtn.addEventListener('click', ui.closeSettingsModal);
    if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', ui.closeSettingsModal);
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', function () { controller.saveSettings(); });
    if (resetSettingsBtn) resetSettingsBtn.addEventListener('click', controller.resetSettings);

    // gapi が async defer で後から読み込まれた場合にも Picker を初期化
    var gapiScriptEl = document.getElementById('gapiScript');
    if (gapiScriptEl) {
      gapiScriptEl.addEventListener('load', function () {
        pickerService.load();
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', function () {
        if (window.innerWidth >= 768) {
          var listPane = document.getElementById('listPane');
          var previewPane = document.getElementById('previewPane');
          if (listPane) listPane.classList.remove('hidden');
          if (previewPane) {
            previewPane.classList.remove('hidden');
            previewPane.classList.add('flex');
          }
        } else {
          ui.switchMobileView(ui.getCurrentMobileView());
        }
      });
    }

    controller.init();
    return controller;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountBrowserApp);
    } else {
      mountBrowserApp();
    }
  }

  var exported = {
    formatBytes: formatBytes,
    escapeHtml: escapeHtml,
    getSourceLabelInfo: getSourceLabelInfo,
    createDomUiAdapter: createDomUiAdapter,
    createAppController: createAppController
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.HttpViewer = root.HttpViewer || {};
    root.HttpViewer.App = exported;
  }
})(typeof window !== 'undefined' ? window : globalThis);
