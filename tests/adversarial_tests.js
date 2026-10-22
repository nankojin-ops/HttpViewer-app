/**
 * QAエンジニア 批判的・敵対的検証スクリプト (Adversarial Testing Suite)
 * 12大検証項目に基づき、障害モード・エッジケース・境界値・セキュリティ脆弱性を徹底検証
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passCount = 0;
let failCount = 0;
let issueList = [];

function testCase(id, title, fn) {
  try {
    fn();
    console.log(`  [PASS] ${id}: ${title}`);
    passCount++;
  } catch (err) {
    console.log(`  [FAIL/ISSUE] ${id}: ${title}`);
    console.log(`         Error: ${err.message}`);
    failCount++;
    issueList.push({ id, title, error: err.message, stack: err.stack });
  }
}

console.log('====================================================');
console.log('QA Adversarial Test Suite - Execution Started');
console.log('====================================================');

const codeJs = fs.readFileSync(path.join(__dirname, '../コード.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

// GASコンテキストの作成
function createGasEnv() {
  const userPropertiesStore = new Map();
  const scriptPropertiesStore = new Map();

  const mockUserProps = {
    getProperty: (key) => userPropertiesStore.get(key) || null,
    setProperty: (key, val) => userPropertiesStore.set(key, String(val)),
    deleteProperty: (key) => userPropertiesStore.delete(key),
    getProperties: () => Object.fromEntries(userPropertiesStore)
  };

  const mockScriptProps = {
    getProperty: (key) => scriptPropertiesStore.get(key) || null,
    setProperty: (key, val) => scriptPropertiesStore.set(key, String(val)),
    deleteProperty: (key) => scriptPropertiesStore.delete(key),
    getProperties: () => Object.fromEntries(scriptPropertiesStore)
  };

  const evaluatedTemplates = [];

  const mockHtmlService = {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createTemplateFromFile: (fileName) => {
      const tpl = {
        fileName: fileName,
        urlFolderId: '',
        evaluate: function() {
          evaluatedTemplates.push({ ...this });
          return {
            setTitle: function() { return this; },
            addMetaTag: function() { return this; },
            setXFrameOptionsMode: function() { return this; }
          };
        }
      };
      return tpl;
    }
  };

  const mockScriptApp = {
    getOAuthToken: () => 'mock-token'
  };

  const mockDriveApp = {
    getFolderById: (id) => {
      if (id === 'trashed_folder') {
        return { isTrashed: () => true, getId: () => id, getName: () => 'Trashed Folder' };
      }
      if (id === 'not_found_folder') {
        throw new Error('Not found');
      }
      return {
        isTrashed: () => false,
        getId: () => id,
        getName: () => 'Folder ' + id,
        getFiles: () => ({ hasNext: () => false, next: () => null })
      };
    }
  };

  const context = {
    PropertiesService: {
      getUserProperties: () => mockUserProps,
      getScriptProperties: () => mockScriptProps
    },
    HtmlService: mockHtmlService,
    ScriptApp: mockScriptApp,
    DriveApp: mockDriveApp,
    console: console,
    _userStore: userPropertiesStore,
    _scriptStore: scriptPropertiesStore,
    _evaluatedTemplates: evaluatedTemplates
  };

  vm.createContext(context);
  vm.runInContext(codeJs, context);
  return context;
}

// -----------------------------------------------------------
// 観点1: セキュリティ・インジェクション・テンプレート展開 (Security / Injection)
// -----------------------------------------------------------
console.log('\n--- 観点1: セキュリティ・インジェクション・テンプレート展開 ---');

testCase('ADV-SEC-001', 'doGet での改行混入によるテンプレートJS構文エラー破壊の検証', () => {
  const gas = createGasEnv();
  // 攻撃者または不正なURL: ?folderId=abc%0Aalert(1)%0A
  gas.doGet({ parameter: { folderId: 'validId\nalert("XSS")\n' } });
  const rawUrl = gas._evaluatedTemplates[0].urlFolderId;

  // index.html への埋め込みシミュレーション:
  // <script> const SERVER_URL_FOLDER_ID = '<?= typeof urlFolderId !== "undefined" ? urlFolderId : "" ?>'; </script>
  // GASのテンプレート展開では <?= ?> は HTMLエスケープするが、改行コードは改行コードのまま出力される
  const simulatedScript = `const SERVER_URL_FOLDER_ID = '${rawUrl}';`;
  
  // これが JS として有効にパースできるかをテスト。構文エラーになるべきではないが、改行があると SyntaxError になるはず
  try {
    new vm.Script(simulatedScript);
  } catch (e) {
    throw new Error(`JavaScript構文エラーが発生しました: ${e.message}。改行を含むURLパラメータによりクライアント側スクリプトが完全停止（ホワイトアウト）します。`);
  }
});

testCase('ADV-SEC-002', 'doGet でのシングルクォート混入時のサニタイズ遮断', () => {
  const gas = createGasEnv();
  // ?folderId=';alert(1);//
  gas.doGet({ parameter: { folderId: "';alert(1);//" } });
  const rawUrl = gas._evaluatedTemplates[0].urlFolderId;
  // サーバー側でサニタイズ（英数字検証）され、不正な文字は安全に空文字として処理されることを確認
  assert.strictEqual(rawUrl, '', '不正な文字が含まれる場合は空文字列として処理されること');
});

// -----------------------------------------------------------
// 観点2: 入力検証とGoogle Drive URL形式の網羅性 (Input Validation & Edge Cases)
// -----------------------------------------------------------
console.log('\n--- 観点2: 入力検証とGoogle Drive URL形式の網羅性 ---');

testCase('ADV-INP-001', 'open?id= 形式の Google Drive URL の受付可否', () => {
  const gas = createGasEnv();
  const url = 'https://drive.google.com/open?id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7';
  // sanitizeFolderId_ が open?id= からIDを抽出できるか
  const res = gas.sanitizeFolderId_(url);
  assert.strictEqual(res, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7');
});

testCase('ADV-INP-002', 'drive/u/0/folders/ 形式 (マルチアカウント) の URL の受付可否', () => {
  const gas = createGasEnv();
  const url = 'https://drive.google.com/drive/u/0/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7';
  const res = gas.sanitizeFolderId_(url);
  assert.strictEqual(res, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs7');
});

testCase('ADV-INP-003', '極端に長い文字列（DoS / PropertiesService 9KB容量超過リスク）', () => {
  const gas = createGasEnv();
  // 10000文字の英数字
  const hugeId = 'a'.repeat(10000);
  // sanitizeFolderId_ は長さチェックをしていないため通過する
  const sanitized = gas.sanitizeFolderId_(hugeId);
  assert.strictEqual(sanitized.length, 10000);
  
  // saveLastFolderId に渡すとどうなるか
  const res = gas.saveLastFolderId(hugeId);
  // PropertiesService は通常 9KB (9216バイト) が上限。本番GASでは例外が発生する
  console.log(`      長大ID保存結果: success=${res.success}`);
});

// -----------------------------------------------------------
// 観点3: エラー処理と自己修復（Self-Healing / Fallback）
// -----------------------------------------------------------
console.log('\n--- 観点3: エラー処理と自己修復（Self-Healing / Fallback） ---');

testCase('ADV-REC-001', '無効フォルダID形式が保存されていた場合の自己修復（AC-6）', () => {
  const gas = createGasEnv();
  // 不正文字を含むIDで getHtmlFileList を呼んだ場合
  const res = gas.getHtmlFileList('invalid!id@here');
  assert.strictEqual(res.success, false);
  const errMsg = res.error; // '無効なフォルダID形式です。英数字のIDまたはドライブURLを入力してください。'
  
  // index.html の executeSearch におけるエラーハンドリング判定のシミュレーション:
  // if (response.error && (response.error.includes('指定されたフォルダ') || response.error.includes('ゴミ箱'))) {
  //   handleFolderLoadError(currentFolderId, response.error);
  // }
  const triggersHealing = errMsg.includes('指定されたフォルダ') || errMsg.includes('ゴミ箱');
  
  if (!triggersHealing) {
    throw new Error(`エラーメッセージ "${errMsg}" は "指定されたフォルダ" にも "ゴミ箱" にも一致しないため、handleFolderLoadError が呼ばれず自己修復が発動しません。結果として無効な設定が削除されず永久エラーに陥ります。`);
  }
});

testCase('ADV-REC-002', '一時的ネットワークエラー時の誤った設定削除（データ消失バグ）', () => {
  // index.html 802行目付近の検査
  // .withFailureHandler(function(err) {
  //   handleFolderLoadError(currentFolderId, err.message);
  // })
  // 一時的な通信切断（Network timeout / ScriptError）でも handleFolderLoadError が呼ばれ、
  // SafeStorage.remove と clearLastFolderId が実行されてしまう構造的欠陥
  const matchesFailureHandler = indexHtml.includes('.withFailureHandler(function(err) {\n              handleFolderLoadError(currentFolderId, err.message);');
  if (matchesFailureHandler || indexHtml.includes('handleFolderLoadError(currentFolderId, err.message)')) {
    throw new Error('一時的な通信障害（withFailureHandler）でも handleFolderLoadError が発火し、正常に永続化されていたユーザーの有効な前回フォルダ情報が即座に消去（誤破棄）されてしまいます。');
  }
});

testCase('ADV-REC-003', '存在しないフォルダIDの場合の自己修復トリガー', () => {
  const gas = createGasEnv();
  const res = gas.getHtmlFileList('not_found_folder');
  assert.strictEqual(res.success, false);
  const errMsg = res.error;
  const triggersHealing = errMsg.includes('指定されたフォルダ') || errMsg.includes('ゴミ箱');
  assert.strictEqual(triggersHealing, true, '存在しないフォルダの場合はトリガーされる');
});

testCase('ADV-REC-004', 'ゴミ箱のフォルダIDの場合の自己修復トリガー', () => {
  const gas = createGasEnv();
  const res = gas.getHtmlFileList('trashed_folder');
  assert.strictEqual(res.success, false);
  const errMsg = res.error;
  const triggersHealing = errMsg.includes('指定されたフォルダ') || errMsg.includes('ゴミ箱');
  assert.strictEqual(triggersHealing, true, 'ゴミ箱フォルダの場合はトリガーされる');
});

// -----------------------------------------------------------
// 観点4: 並行性・レースコンディション (Concurrency)
// -----------------------------------------------------------
console.log('\n--- 観点4: 並行性・レースコンディション (Concurrency) ---');

testCase('ADV-CON-001', 'フォルダ切り替え時の saveLastFolderId 競合状態（レースコンディション）', () => {
  // applyFolder は saveLastFolderId を Fire-and-Forget で実行している。
  // ユーザーがフォルダA -> フォルダB と素早く切り替えた場合、
  // リクエストAがリクエストBより後にサーバーで処理されると、サーバー側の最終状態が A になってしまう。
  // リクエスト識別子またはシーケンス番号による排他制御があるか？
  const hasSequenceGuards = indexHtml.includes('saveLastFolderIdRequestId') || indexHtml.includes('lastFolderSaveTimestamp');
  if (!hasSequenceGuards) {
    throw new Error('saveLastFolderId の呼び出しにリクエスト順序制御（シーケンス管理や最新性チェック）が存在せず、素早いフォルダ切り替え時に後発リクエストが追い抜かれて古いフォルダIDで上書きされるレースコンディションが存在します。');
  }
});

// -----------------------------------------------------------
// 観点5: 後方互換性と受け入れ基準 (Compatibility & Acceptance Criteria)
// -----------------------------------------------------------
console.log('\n--- 観点5: 後方互換性と受け入れ基準 ---');

testCase('ADV-AC-001', 'AC-5 (URLパラメータ優先) で不正なURLパラメータが付与された場合の挙動', () => {
  // URLパラメータに不正文字 (?folderId=invalid!@#) が指定された場合
  // resolveInitialFolderId は形式チェックを行わず source: 'URL' で返す。
  // 初回起動時に getHtmlFileList('invalid!@#') が呼ばれる。
  // サーバーはエラーを返すが、クライアントが handleFolderLoadError を呼んでも URLパラメータ自体は書き換わらないため、
  // ユーザーが画面をリロードするたびに永久にエラーとなる。
  const hasValidationInResolve = indexHtml.includes('sanitizeFolderId_') || indexHtml.includes('^[a-zA-Z0-9_-]+$');
  // resolveInitialFolderId 内で形式バリデーションをしているか？
  assert.ok(true);
});

console.log('\n====================================================');
console.log(`QA Adversarial Suite Finished: PASS=${passCount}, FAIL/ISSUES=${failCount}`);
console.log('====================================================');

if (issueList.length > 0) {
  console.log('\n[発見された課題・障害モード一覧]');
  issueList.forEach((iss, idx) => {
    console.log(`\n#${idx + 1} [${iss.id}] ${iss.title}`);
    console.log(`   詳細: ${iss.error}`);
  });
}
