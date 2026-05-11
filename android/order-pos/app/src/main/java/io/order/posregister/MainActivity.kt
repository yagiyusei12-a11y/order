package io.order.posregister

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import io.order.posregister.databinding.ActivityMainBinding

/**
 * 店舗の「卓・会計（OPS）」だけを WebView で表示するレジ専用シェル。
 * 同一オリジンの httpOnly Cookie（スタッフ JWT）がそのまま使える。
 *
 * 次段階: JavaScript ブリッジで Bluetooth SPP / USB シリアルを Kotlin から開き、
 * 既存の Web Serial と同等のドロア・印刷をネイティブ化する。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(findViewById(R.id.toolbar))

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(binding.webView, true)

        setupWebView(binding.webView)

        binding.btnSaveOpen.setOnClickListener {
            val url = binding.editOpsUrl.text?.toString()?.trim().orEmpty()
            if (!url.startsWith("https://")) {
                binding.editOpsUrl.error = "https:// で始まる URL を入力してください"
                return@setOnClickListener
            }
            if (!url.contains("/staff-app/", ignoreCase = true) || !url.contains("/ops", ignoreCase = true)) {
                binding.editOpsUrl.error = "…/staff-app/店舗ID/ops の形式を確認してください"
                return@setOnClickListener
            }
            saveStartUrl(this, url)
            showWebView(url)
        }

        val saved = loadStartUrl(this)
        if (saved != null) {
            binding.editOpsUrl.setText(saved)
            showWebView(saved)
        } else {
            binding.urlForm.isVisible = true
            binding.webView.isVisible = false
        }
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, MENU_CHANGE_URL, 0, R.string.change_url)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == MENU_CHANGE_URL) {
            binding.webView.stopLoading()
            binding.webView.isVisible = false
            binding.urlForm.isVisible = true
            binding.editOpsUrl.setText(loadStartUrl(this).orEmpty())
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    override fun onBackPressed() {
        if (binding.webView.isVisible && binding.webView.canGoBack()) {
            binding.webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(w: WebView) {
        w.settings.javaScriptEnabled = true
        w.settings.domStorageEnabled = true
        w.webChromeClient = WebChromeClient()
        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return false
            }
        }
    }

    private fun showWebView(url: String) {
        binding.urlForm.isVisible = false
        binding.webView.isVisible = true
        binding.webView.loadUrl(url)
    }

    companion object {
        private const val PREFS = "order_pos_prefs"
        private const val KEY_OPS_URL = "ops_start_url"
        private const val MENU_CHANGE_URL = 1

        fun loadStartUrl(ctx: Context): String? =
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_OPS_URL, null)?.trim()?.takeIf { it.isNotEmpty() }

        fun saveStartUrl(ctx: Context, url: String) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_OPS_URL, url).apply()
        }
    }
}
