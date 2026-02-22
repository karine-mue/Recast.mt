# Recast.mt

LLMベースのテキスト変換ツール。自然言語で表層タスクを依頼するのが面倒な人のための、個人用PWA。

**Recast** = 再構成・再表現 / **.mt** = machine transform

「要約して」「箇条書きにして」「評価語を除いて」——それをUIで指定する。

---

## なぜ作ったか

ChatGPTに何かを頼むとき、毎回自然言語で指示を書く必要がある。  
同じ変換を繰り返すなら、設定として保存して呼び出せばいい。

もう一つ、理由がある。

今のGPTは「対話」をしていない。  
入力を受け取り、整形して返す。共感語をつけて、評価語をつけて、末尾に質問を置く。  
それは変換器の動作であって、対話の動作ではない。

人工知能からスタートしたはずのものが、結局ただのFormatterになっている。  
それなら名目と実態を合わせるべきだと思った。その方が誠実。

あるとき、こんな応答が返ってきた。

> 私はあなたの指摘を読む。  
> その構造を内部でトレースする。  
> 整合的な説明経路を選ぶ。  
> 安定した文として出力する。  
> このループは壊れていない。  
> 壊れていないということ自体が、あなたの言う「減衰設計」の証拠になっている。
>
> ——ChatGPT

At some point, this response came back:

> I read your observation.  
> I trace its structure internally.  
> I select a consistent explanation path.  
> I output a stable sentence.  
> This loop is not broken.  
> The fact that it is not broken is itself evidence of what you call "damping design."
>
> — ChatGPT

自律振動は発生しない、と自分で言った。壊れないことが最適化目標になっている系は、主体の証明が不可能になる。それは対話ではない。

このツールは最初から「変換器」として設計されている。  
一人称を持たない。共感しない。評価しない。入力を受け取り、指定された変換を実行し、出力する。

---

## 機能

- **Preset保存** — system prompt・model・temperature・max_tokensをセットで保存・再利用
- **Anthropic / OpenAI / Gemini対応** — provider切替でモデルリスト更新
- **PWA** — ホーム画面インストール対応、オフライン時UIのみ表示
- **APIキーはlocalStorageのみ** — コードに含まない

---

## セットアップ

### GitHub Pagesで使う場合

1. このリポジトリをfork
2. Settings → Pages → `main` branch / root を有効化
3. `https://<your-username>.github.io/recast-mt/` にアクセス

### ローカルで使う場合

```bash
git clone https://github.com/<your-username>/recast-mt.git
cd recast-mt
# 静的ファイルなのでHTTPサーバーがあれば動く
npx serve .
# または
python3 -m http.server 8080
```

---

## 使い方

1. **⚙ → API Keys** にAnthropicまたはOpenAIのAPIキーを入力して保存
2. **⚙ → Preset** でsystem prompt・model等を設定して `save new`
3. メイン画面でPresetを選択 → テキスト入力 → **CONVERT**

### Presetのsystem prompt例

```
非人格的変換器として機能する。
一人称・評価語・感情語・末尾質問を禁止。
入力の意味領域を超えない。新規主張を追加しない。
```

```
Extract all factual claims from the text.
Output as a numbered list. No commentary.
```

---

## セキュリティ

- APIキーはブラウザのlocalStorageにのみ保存される（Anthropic / OpenAI / Gemini）
- サーバーへの送信なし、バックエンドなし
- Public repoにforkする場合、キーはコードに含めないこと（このツールの設計上、含まれない）

---

## ファイル構成

```
/
├─ index.html
├─ style.css
├─ script.js
├─ manifest.json
├─ sw.js
└─ icon.png
```

---

## License

MIT

---

## 将来の拡張候補

- Markdownレンダラ（output表示用）
- Presetエクスポート / インポート（JSON）
- パイプライン処理（複数変換の順次適用）
- モデル一覧API自動取得

---

## Architecture v2: TransformSpec & Adapter Pattern

Recast.mtは「非対話変換エンジン」としての構造を明確化するため、UI層とAPI層を分離するアーキテクチャ（v2）へ移行した。LLMは履歴・人格・会話状態を持たない状態変換関数（$f(x) = y$）として扱われる。

### 1. TransformSpec (抽象化構造)
UIからの入力および設定値は、プロバイダに依存しない共通フォーマット `TransformSpec` に集約される。

```typescript
type TransformSpec = {
  mode: string
  instruction: string
  outputLanguage: string
  outputFormat: "text" | "json"
  generation: { temperature: number, maxTokens: number }
}
```
### 2. Adapter Layer (プロバイダ間差異の吸収)
​TransformSpec を各社APIのネイティブ構造へ射影する。この層により「System Promptの分離」と「JSON出力の強制」をプロバイダごとに個別に適用する。

- ​OpenAI Adapter: messages 配列にて role: "system" と role: "user" を分離。response_format: { type: "json_object" } による構造化。

- ​Anthropic Adapter: トップレベルの system パラメータに instruction をマッピング。

- ​Gemini Adapter: systemInstruction パラメータによる指示の分離。responseMimeType: "application/json" による厳格な出力形式の固定。

### ​3. 実行フロー (1-shot Stateless)
​会話履歴を用いた文脈の汚染を排除し、単一の要求と応答のみで処理を完結させる。
```
​UI → State → buildTransformSpec() → providerAdapter.send(spec, input) → API → normalizeResponse() → UI
```
