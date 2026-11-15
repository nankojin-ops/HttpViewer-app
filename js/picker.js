/**
 * Google Picker API サービスモジュール（PickerService）
 *
 * GitHub Pages ファーストパーティオリジン向けに window.location.origin を設定し、
 * 共有ドライブ（SUPPORT_DRIVES）を含めたフォルダ選択 UI を提供する。
 * apiKey / appId 未設定、gapi 未ロード、または構築失敗時は安全に手動入力モーダルへフォールバックする。
 */
(function (root) {
  'use strict';

  /**
   * PickerService インスタンスを生成する
   * @param {Object} [options]
   * @param {Function} [options.getGapi]
   * @param {Function} [options.getGooglePicker]
   * @param {Function} [options.getOrigin]
   * @param {Function} [options.getWindowSize]
   * @return {Object} PickerService
   */
  function createPickerService(options) {
    var opts = options || {};
    var pickerApiLoaded = false;
    var statusListeners = [];
    var activePicker = null;

    function disposeActivePicker() {
      if (!activePicker) {
        return;
      }
      var target = activePicker;
      activePicker = null;
      if (typeof target.dispose === 'function') {
        try {
          target.dispose();
        } catch (e) {
          console.warn('[PickerService] picker.dispose() error:', e);
        }
      }
    }

    function resolveGapi() {
      if (typeof opts.getGapi === 'function') {
        return opts.getGapi();
      }
      if (typeof gapi !== 'undefined') {
        return gapi;
      }
      if (root && root.gapi) {
        return root.gapi;
      }
      return null;
    }

    function resolveGooglePicker() {
      if (typeof opts.getGooglePicker === 'function') {
        return opts.getGooglePicker();
      }
      if (typeof google !== 'undefined' && google.picker) {
        return google.picker;
      }
      if (root && root.google && root.google.picker) {
        return root.google.picker;
      }
      return null;
    }

    function resolveOrigin() {
      if (typeof opts.getOrigin === 'function') {
        return opts.getOrigin();
      }
      if (typeof window !== 'undefined' && window.location && window.location.origin) {
        return window.location.origin;
      }
      return '';
    }

    function resolveWindowSize() {
      if (typeof opts.getWindowSize === 'function') {
        return opts.getWindowSize();
      }
      if (typeof window !== 'undefined') {
        return {
          width: window.innerWidth || 1024,
          height: window.innerHeight || 768
        };
      }
      return { width: 1024, height: 768 };
    }

    function notifyStatus(loaded) {
      statusListeners.forEach(function (listener) {
        try {
          listener(loaded);
        } catch (e) {
          console.warn('[PickerService] status listener error:', e);
        }
      });
    }

    /**
     * gapi.load('picker') を呼び出して Picker API を初期化する
     * @param {Function} [onStatusChange]
     */
    function load(onStatusChange) {
      if (typeof onStatusChange === 'function') {
        statusListeners.push(onStatusChange);
      }

      if (resolveGooglePicker()) {
        pickerApiLoaded = true;
        notifyStatus(true);
        return;
      }

      var gapiObj = resolveGapi();
      if (!gapiObj || typeof gapiObj.load !== 'function') {
        pickerApiLoaded = false;
        notifyStatus(false);
        return;
      }

      try {
        gapiObj.load('picker', {
          callback: function () {
            pickerApiLoaded = Boolean(resolveGooglePicker());
            notifyStatus(pickerApiLoaded);
          },
          onerror: function () {
            pickerApiLoaded = false;
            notifyStatus(false);
          }
        });
      } catch (e) {
        console.warn('[PickerService] gapi.load("picker") error:', e);
        pickerApiLoaded = false;
        notifyStatus(false);
      }
    }

    /**
     * Picker API が利用可能か判定する
     * @return {boolean}
     */
    function isLoaded() {
      if (!pickerApiLoaded && resolveGooglePicker()) {
        pickerApiLoaded = true;
      }
      return pickerApiLoaded && Boolean(resolveGooglePicker());
    }

    /**
     * Google Picker フォルダ選択ダイアログを表示する
     * 条件を満たさない場合は例外を投げず onFallbackToManual を呼び出す
     * @param {Object} params
     * @param {string} params.accessToken
     * @param {string} params.apiKey
     * @param {string} params.appId
     * @param {string} [params.origin]
     * @param {Function} params.onPicked
     * @param {Function} [params.onCancel]
     * @param {Function} params.onFallbackToManual
     */
    function openFolderPicker(params) {
      var p = params || {};
      var fallback = typeof p.onFallbackToManual === 'function' ? p.onFallbackToManual : function () {};

      if (!p.accessToken) {
        fallback('有効なアクセストークンがないため、手動入力に切り替えます。');
        return;
      }

      if (!p.apiKey || !p.appId) {
        fallback('Picker 用 API Key または Project Number (App ID) が未設定のため、手動入力に切り替えます。');
        return;
      }

      if (!isLoaded()) {
        // gapi が後から読み込まれていた場合は再ロードを試みて今回はフォールバックする
        if (resolveGapi()) {
          load();
        }
        fallback('Google Picker ライブラリが未読み込みのため、手動入力に切り替えます。');
        return;
      }

      var pickerNs = resolveGooglePicker();
      if (!pickerNs || typeof pickerNs.PickerBuilder !== 'function' || typeof pickerNs.DocsView !== 'function') {
        fallback('Google Picker API が利用できないため、手動入力に切り替えます。');
        return;
      }

      try {
        disposeActivePicker();

        var view = new pickerNs.DocsView(pickerNs.ViewId.FOLDERS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true);

        var winSize = resolveWindowSize();
        var dialogWidth = Math.min(winSize.width * 0.92, 800);
        var dialogHeight = Math.min(winSize.height * 0.85, 600);
        var effectiveOrigin = p.origin || resolveOrigin();

        var builder = new pickerNs.PickerBuilder()
          .addView(view)
          .enableFeature(pickerNs.Feature.SUPPORT_DRIVES)
          .setOAuthToken(p.accessToken)
          .setDeveloperKey(p.apiKey)
          .setAppId(p.appId)
          .setSize(dialogWidth, dialogHeight)
          .setLocale('ja');

        if (effectiveOrigin) {
          builder.setOrigin(effectiveOrigin);
        }

        builder.setCallback(function (data) {
          if (!data) return;
          var action = data[pickerNs.Response.ACTION];
          if (action === pickerNs.Action.PICKED) {
            disposeActivePicker();
            var docs = data[pickerNs.Response.DOCUMENTS];
            if (Array.isArray(docs) && docs.length > 0 && typeof p.onPicked === 'function') {
              var doc = docs[0];
              p.onPicked({
                id: doc[pickerNs.Document.ID],
                name: doc[pickerNs.Document.NAME]
              });
            }
          } else if (action === pickerNs.Action.CANCEL) {
            disposeActivePicker();
            if (typeof p.onCancel === 'function') {
              p.onCancel();
            }
          }
        });

        var picker = builder.build();
        activePicker = picker;
        picker.setVisible(true);
      } catch (err) {
        disposeActivePicker();
        console.warn('[PickerService] Picker build/open failed, falling back to manual modal:', err);
        fallback('Google Picker の起動に失敗したため、手動入力に切り替えます。');
      }
    }

    return {
      load: load,
      isLoaded: isLoaded,
      openFolderPicker: openFolderPicker
    };
  }

  var exported = {
    createPickerService: createPickerService
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (root) {
    root.HttpViewer = root.HttpViewer || {};
    root.HttpViewer.PickerService = exported;
    root.HttpViewer.createPickerService = createPickerService;
  }
})(typeof window !== 'undefined' ? window : globalThis);
