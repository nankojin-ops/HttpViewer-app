/**
 * アプリケーション初期設定テンプレート（ハイブリッド方式: B-1）
 *
 * GitHub Pages 上で全利用者に共通の GCP 設定を事前配布したい場合は、
 * 以下の各プロパティに値を設定してください。
 * 空文字のまま公開した場合でも、初回アクセス時にブラウザ上の「GCP設定モーダル」から
 * 各ユーザーが自身の設定を入力・保存して利用できます。
 *
 * 【セキュリティ上の注意】
 * - OAuth クライアントシークレット等の秘密鍵は絶対に記述しないでください。
 * - apiKey には必ず Google Cloud Console 側で HTTP リファラー制限と
 *   Google Picker API のみの API 制限を設定してください。
 */
(function (root) {
  'use strict';

  var APP_DEFAULT_CONFIG = {
    // Google OAuth 2.0 クライアント ID（ウェブアプリケーション用）
    clientId: '',
    // Google Picker 用 API キー（未設定時は手動フォルダ入力モーダルへフォールバック）
    apiKey: '',
    // Google Cloud プロジェクト番号（数値文字列、任意）
    appId: '',
    // 既定で開く Google ドライブフォルダ ID またはフォルダ URL（任意）
    defaultFolderId: ''
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = APP_DEFAULT_CONFIG;
  }
  if (root) {
    root.APP_DEFAULT_CONFIG = APP_DEFAULT_CONFIG;
  }
})(typeof window !== 'undefined' ? window : globalThis);
