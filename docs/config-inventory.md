# 設定・固定値の棚卸し（マスタ駆動化・マルチテナント向け）

店舗ごとの可変パラメータの置き場所と、まだコードに残る前提・今後の候補を整理する。

## 設定の置き場所

| 領域 | 保存先 | 正規化 |
|------|--------|--------|
| 税・タイムゾーン・キッチン更新・コース締め・テイクアウト受取枠など | `Store.settings` (JSON) | [`mergeStoreSettings`](../src/lib/store-settings.ts) |
| 受付・ネット予約（日数先・枠刻み・営業帯・シフト境界など） | `ReceptionConfig.data` (JSON) | ルート内で都度読み取り（[`reception.ts`](../src/routes/reception.ts) 等） |

## `ReceptionConfig.data`（主なキー）

| キー | 型 / 既定 | 説明 |
|------|-----------|------|
| `netReserveDaysAhead` | number / 30 | 予約可能な日数先 |
| `netReserveSlotMinutes` | number / 15 | 予約枠の刻み（分） |
| `netReserveBusinessWindows` | `{ startMin, endMin }[]` | 営業時間帯（0〜1439 分） |
| `netReserveFallbackToTemplateWindows` | boolean / **true** | **false** のとき、営業帯が空ならテンプレ（11–15 / 17–23）を使わず枠なし |
| `receptionShiftLunchEndHour` | 0–23 / **15** | ランチとディナーの境界「時」。`hh < 値` をランチ（受付シフトキー・座席ロックの legacy キー用） |
| `netReserveEnableNote` | boolean / true | 備考欄 |
| `maxMergeSize` | number | 合体席の最大人数など |
| `mergeAllOrNothingGroups` | 配列 | 合体グループ |
| `receptionSeatLayout` | `{ [席表示ラベル]: { left, top, width, height } }`（0–100 のパーセント） | 受付フル画面の席マップの位置・サイズ（[`staff-script-reception-full.js`](../src/templates/staff-script-reception-full.js)）。`null` で削除可 |

公開 API [`GET /reception/:storeId/net/config`](../src/routes/reception.ts) は `todayYmd`・`maxReservableYmd`・`timezone`・`shiftLunchEndHour`・`netReserveFallbackToTemplateWindows` などを返す（フロントは JST 固定不要）。

## `Store.settings`（[`mergeStoreSettings`](../src/lib/store-settings.ts)）

| フィールド | 既定例 | 備考 |
|------------|--------|------|
| `timezone` | `Asia/Tokyo` | IANA。日付境界・ゲスト時間帯・本ドキュメント後述の壁時計処理の基準 |
| `taxRatePercent` | 10 | |
| `kitchenAutoRefreshSec` | 10 | |
| `guestCourseLastOrderMinutesBeforeEnd` | 30 | |
| `guestLastOrderAfterDeadlinePolicy` | `block_all` | `allow_all` / `singles_only` / `block_all`。コース卓のラストオーダー締め後のゲスト注文。未設定時は旧 `guestEnforceLastOrder`（true→`block_all`、false→`allow_all`）から補完 |
| `guestEnforceLastOrder` | true | 互換用。新規は `guestLastOrderAfterDeadlinePolicy` を優先 |
| `takeoutPickupTimeWindowIds` | [] | |
| `takeoutPickupMinLeadMinutes` | 2 | ネットテイクアウトの受取時刻が「今」から何分以上先か（候補生成・確定APIの両方） |
| `takeoutNetPriceDisplayMode` | `inclusive` | ネットテイクアウト画面の価格表示。`inclusive`（税込）／`exclusive`（税抜）。APIの金額は税込ベースのまま |

## 実装済み（本変更で店舗タイムゾーンへ寄せたもの）

- **会計** [`billing.ts`](../src/routes/billing.ts): 期間フィルタ・日次支払レポートの「日」の開始を `startOfWallCalendarDayUtc(date, store.timezone)` に統一。
- **受付** [`reception.ts`](../src/routes/reception.ts): 「今日」のシフトキー・予約日差分・予約ブロックの日時比較を `store-wall-time` + `Store.settings.timezone` 基準に。
- **テイクアウト** [`takeout-net.ts`](../src/routes/takeout-net.ts): `YYYY-MM-DDTHH:mm` を店舗 TZ の壁時計として解釈。
- **ネット予約フロント** [`reserve-front.html`](../src/templates/reserve-front.html): 日付 min/max を API の `todayYmd` / `maxReservableYmd` に依存。
- **ランチ/ディナー境界**: 固定 15 時ではなく `receptionShiftLunchEndHour`（スタッフ画面「ネット予約設定」で編集）。

壁時計ユーティリティ: [`store-wall-time.ts`](../src/lib/store-wall-time.ts)（DST 跨ぎは +24h ステップのため厳密でない箇所あり。日本など DST なしでは実用上問題になりにくい。）

## まだコードやデータに残る「当社・日本前提」候補（今後の設定化候補）

- **文言・UI**: HTML/JS 内の日本語コピー、金額表示（円）など → i18n / ブランド差し替えは別フェーズ。
- **業務ステータス文字列**: 例: 予約 `予約確定`、座席 `vacant` など → 将来は列挙やマスタ化の余地。
- **支払方法ラベル** `labelJa` 等: 多言語・多通貨時にスキーマ見直し。
- **席コード正規表現**（`C\d+|T\d+`）: 店舗ごとプレフィックスはあるが、命名規則自体はコードに依存。
- **消費税・軽減税率**: テイクアウト 8% などハードコード箇所が残る場合あり → 税率マスタ化は別タスクで確認推奨。
- **既定テンプレ営業帯**（11–15 / 17–23）: [`defaultNetReserveWindows`](../src/lib/net-reserve-slots.ts)。`netReserveFallbackToTemplateWindows === false` で無効化可能。

## 月額 SaaS・テナント階層（別フェーズ・要件確定後）

**現状のスコープ外**（コード変更は未実施）。他社向け月額提供で通常必要になる要素のメモ:

- **Organization（契約単位）** と **Store** の親子、請求・契約状態
- **ユーザー権限**（組織管理者 / 店舗スタッフのスコープ）
- オンボーディング（必須設定ウィザード）、監査ログ

要件が固まったら Prisma スキーマ・認可（JWT の `storeId` 以外）・管理画面の設計から着手する。
