import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const HarunoyukotoPosApp());
}

/// はるのゆこと レジ: OPS（WebView）＋ LAN の ESC/POS 経由でドロアキック。
class HarunoyukotoPosApp extends StatelessWidget {
  const HarunoyukotoPosApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'はるのゆこと レジ',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepOrange),
        useMaterial3: true,
      ),
      home: const OpsShellPage(),
    );
  }
}

class OpsShellPage extends StatefulWidget {
  const OpsShellPage({super.key});

  @override
  State<OpsShellPage> createState() => _OpsShellPageState();
}

class _OpsShellPageState extends State<OpsShellPage> {
  /// ESC/POS キャッシュドロア開放（Epson 互換 ESC p）
  static final Uint8List _drawerKick = Uint8List.fromList([
    0x1B,
    0x70,
    0x00,
    0x19,
    0xFA,
  ]);

  static const int _printerPort = 9100;
  static const Duration _connectTimeout = Duration(seconds: 3);

  static const String _kOpsUrl = 'ops_page_url';
  static const String _kPrinterIp = 'printer_ip';

  WebViewController? _controller;
  bool _loadingPrefs = true;
  String? _opsUrl;
  String _printerIp = '';

  @override
  void initState() {
    super.initState();
    _loadPrefs();
  }

  Future<void> _loadPrefs() async {
    final p = await SharedPreferences.getInstance();
    final url = p.getString(_kOpsUrl)?.trim();
    final ip = p.getString(_kPrinterIp)?.trim() ?? '';
    if (!mounted) return;
    setState(() {
      _opsUrl = url != null && url.isNotEmpty ? url : null;
      _printerIp = ip;
      _loadingPrefs = false;
    });
    if (_opsUrl != null && _opsUrl!.isNotEmpty) {
      _initWebView(_opsUrl!);
    }
  }

  Uri _withNativeDrawer(String input) {
    final u = Uri.parse(input.trim());
    final q = Map<String, String>.from(u.queryParameters);
    q['nativeDrawer'] = '1';
    return u.replace(queryParameters: q);
  }

  void _initWebView(String opsUrlRaw) {
    final uri = _withNativeDrawer(opsUrlRaw);
    final c = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel(
        'HarunoyukotoPos',
        onMessageReceived: (JavaScriptMessage message) {
          if (message.message == 'openDrawer') {
            _openDrawerTcp();
          }
        },
      )
      ..loadRequest(uri);
    setState(() => _controller = c);
  }

  Future<void> _savePrefs({required String opsUrl, required String printerIp}) async {
    final trimmed = opsUrl.trim();
    if (trimmed.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('OPS の URL を入力してください')),
        );
      }
      return;
    }
    final p = await SharedPreferences.getInstance();
    await p.setString(_kOpsUrl, trimmed);
    await p.setString(_kPrinterIp, printerIp.trim());
    if (!mounted) return;
    setState(() {
      _opsUrl = trimmed;
      _printerIp = printerIp.trim();
    });
    _initWebView(trimmed);
  }

  bool _looksLikeIpv4(String host) {
    final re = RegExp(r'^\d{1,3}(\.\d{1,3}){3}$');
    if (!re.hasMatch(host)) return false;
    return host.split('.').every((p) {
      final n = int.tryParse(p);
      return n != null && n >= 0 && n <= 255;
    });
  }

  Future<void> _openDrawerTcp() async {
    final ip = _printerIp.trim();
    if (ip.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('設定でプリンター IP を入力してください')),
        );
      }
      return;
    }
    if (!_looksLikeIpv4(ip)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('プリンター IP の形式が正しくありません')),
        );
      }
      return;
    }

    Socket? socket;
    try {
      socket = await Socket.connect(
        ip,
        _printerPort,
        timeout: _connectTimeout,
      );
      socket.add(_drawerKick);
      await socket.flush();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('ドロアを開けました')),
        );
      }
    } catch (e, st) {
      debugPrint('Drawer open failed: $e\n$st');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('プリンターに接続できませんでした: $e')),
        );
      }
    } finally {
      try {
        socket?.destroy();
      } catch (_) {}
    }
  }

  Future<void> _openSettings() async {
    final urlCtrl = TextEditingController(text: _opsUrl ?? '');
    final ipCtrl = TextEditingController(text: _printerIp);

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(ctx).bottom,
            left: 24,
            right: 24,
            top: 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                '設定',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: urlCtrl,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  labelText: 'OPS の URL',
                  hintText: 'https://…/staff-app/店舗ID/ops',
                ),
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 12),
              TextField(
                controller: ipCtrl,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  labelText: 'プリンター IP（ドロア）',
                  hintText: '192.168.0.100',
                ),
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () async {
                        Navigator.pop(ctx);
                        await _savePrefs(
                          opsUrl: urlCtrl.text,
                          printerIp: ipCtrl.text,
                        );
                      },
                      child: const Text('保存して再読込'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: () async {
                        Navigator.pop(ctx);
                        setState(() => _printerIp = ipCtrl.text.trim());
                        await _openDrawerTcp();
                      },
                      child: const Text('ドロアテスト'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
            ],
          ),
        );
      },
    );

    urlCtrl.dispose();
    ipCtrl.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingPrefs) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (_opsUrl == null || _opsUrl!.isEmpty) {
      return _SetupWizard(onSave: _savePrefs);
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('はるのゆこと レジ'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: _openSettings,
            tooltip: '設定',
          ),
        ],
      ),
      body: _controller == null
          ? const Center(child: CircularProgressIndicator())
          : WebViewWidget(controller: _controller!),
    );
  }
}

class _SetupWizard extends StatefulWidget {
  const _SetupWizard({required this.onSave});

  final Future<void> Function({
    required String opsUrl,
    required String printerIp,
  }) onSave;

  @override
  State<_SetupWizard> createState() => _SetupWizardState();
}

class _SetupWizardState extends State<_SetupWizard> {
  final _urlCtrl = TextEditingController();
  final _ipCtrl = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _urlCtrl.dispose();
    _ipCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      await widget.onSave(
        opsUrl: _urlCtrl.text,
        printerIp: _ipCtrl.text,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('はるのゆこと レジ')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _urlCtrl,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  labelText: 'OPS の URL',
                  hintText: 'https://…/staff-app/店舗ID/ops',
                ),
                keyboardType: TextInputType.url,
                enabled: !_busy,
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _ipCtrl,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  labelText: 'プリンター IP（ドロア）',
                ),
                keyboardType: TextInputType.number,
                enabled: !_busy,
              ),
              const SizedBox(height: 24),
              SizedBox(
                height: 48,
                child: FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: _busy
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('開始'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
