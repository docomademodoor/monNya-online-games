# 大富豪画面 CSS 調整ガイド

このガイドは、大富豪の対戦画面をPC・スマートフォン幅で確認しながら調整する手順です。チンチロ画面は対象外です。

## プレビュー

1. 開発サーバーを起動します。

   ```bash
   npm run dev
   ```

2. 対戦中または結果のプレビューを開きます。

   - 対戦中: `http://localhost:3000/layout-preview.html?screen=game`
   - 対戦結果: `http://localhost:3000/layout-preview.html?screen=result`

3. プレビュー枠の右下をドラッグして幅・高さを変えます。対戦中画面の上部バーから結果画面にも切り替えられます。

プレビュー中はCSSの更新を自動検知し、スタイルだけを読み直します。通常画面ではなくプレビューURLを使ってください。幅432pxを超えても、対戦画面のレール幅は最大432pxです。スマートフォン用メディアクエリの確認には幅640px以下を使います。

## 変更箇所

大富豪のレイアウト調整は `public/css/daifugo.css`、画面の生成と人数別席プリセットは `public/js/app.js` にあります。共通ルールは `public/css/style.css` にあります。画面別CSSはstyle.cssの後に読み込みます。

共通CSSには過去のルールやメディアクエリが残っています。大富豪の見た目を変更するときは、まず `daifugo.css` の調整トークンとコメント付きセクションを編集してください。既存CSSの `!important` も後読み込みの画面別CSSから上書きできます。

調整用トークンは `daifugo.css` の先頭にまとめています。トークンを使う項目は、その値を変えるだけでレイアウトへ反映されます。

## よく調整する項目

| 調整したいもの | 主な場所・セレクター |
| --- | --- |
| 画面幅、ヘッダー高、場の寸法 | `--daifugo-board-width`、`--daifugo-header-height`、`--daifugo-field-*` |
| 手札カードの幅・高さ | 1行9列のGridで自動計算。列間は `--daifugo-hand-row-gap`、高さは `--daifugo-hand-card-aspect` |
| 場・背景色・縦位置 | `--daifugo-board-background`、`--daifugo-field-top`、`--daifugo-field-message-top` |
| 手札領域と操作ドック | `--daifugo-action-height`、`--daifugo-hand-height`、`--daifugo-three-row-hand-height` |
| 相手席の標準・8人時サイズ | `--daifugo-seat-*`。席の位置は同ファイル内の固定席表 |
| カード内の文字サイズ、色、名前表示 | 「カードと相手プレイヤー」セクションの専用セレクター |
| 9枚ごとの改行数 | `app.js` の `maxHandCardsPerRow` |

### 相手プレイヤーの席

席は3列×3行のCSS Gridです。`data-seat-slot="行-列"` の形式で、`1-1` は左上、`1-2` は上中央、`3-3` は右下です。`daifugo.css` の「固定席表」にある `grid-area` を編集すると、その席の画面上の場所が変わります。

人数ごとに誰をどの席へ割り当てるかは `app.js` の `DAIFUGO_OPPONENT_SEAT_PRESETS` が決めます。プレイヤー順を変えるときは、この配列を編集します。席の座標を変えるだけならCSS、人数別の割当順を変えるならJSが担当です。両方を同時に変える前に、既存の席が重複していないか確認してください。

## 調整の進め方

1. プレビュー枠を対象の幅・高さにします。
2. `daifugo.css` の該当トークンまたはセクションを編集します。
3. 共通色や基本装飾など調整ファイルにない項目だけ `style.css` を確認します。
4. 自動反映後、PC幅とスマートフォン幅の両方で位置・重なり・文字の読みやすさを見ます。
5. CSSだけの変更では通常Vitestは不要です。JSの席割当やゲーム処理を変えた場合は、変更箇所に関連するテストを実行します。

プレビューに反映されない場合は、開発サーバーが `npm run dev` で起動しているか、画面別CSSが `style.css` より後に読み込まれているかを確認してください。