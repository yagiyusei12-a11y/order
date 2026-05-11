order-pos（Android レジシェル）
================================

1. Android Studio で android/order-pos を開く（初回は Gradle Wrapper の生成を促されたら従う）。
2. 実機またはエミュレータで起動。
3. 表示された入力欄に、ブラウザで開いている「卓・会計」の URL をそのまま貼る。
   例: https://（あなたのドメイン）/staff-app/（店舗ID）/ops
4. 「保存して開く」。初回はスタッフログイン画面になるので、ブラウザと同様にログイン。
5. メニュー「URLを変更」で別店舗・別 URL に切り替え可能。

Bluetooth ドロア・印刷をアプリ側でやる場合は、WebView に @JavascriptInterface を足し、
Kotlin から SPP 送信する拡張をこのモジュールに追加する（現状は WebView 内の Web Serial は Android で非対応のため、未接続時はドロアボタンは効かないことがあります）。
