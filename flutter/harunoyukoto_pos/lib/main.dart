import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:charset_converter/charset_converter.dart';
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

  void _showPosSnack(String text, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(text),
        backgroundColor: isError ? Colors.red.shade800 : null,
      ),
    );
  }

  void _onHarunoyukotoPosMessage(String raw) {
    final trimmed = raw.trim();
    if (trimmed == 'openDrawer') {
      _openDrawerTcp();
      return;
    }
    if (!trimmed.startsWith('{')) {
      return;
    }
    try {
      final decoded = jsonDecode(trimmed);
      if (decoded is! Map) {
        _showPosSnack('エラー: 印刷データの形式が不正です', isError: true);
        return;
      }
      final map = Map<String, dynamic>.from(decoded);
      final cmd = map['cmd'];
      if (cmd == 'printQr') {
        final dataRaw = map['data'];
        final titleRaw = map['title'];
        if (dataRaw is! String || dataRaw.trim().isEmpty) {
          _showPosSnack('エラー: QR印刷データの形式が不正です', isError: true);
          return;
        }
        final data = dataRaw.trim();
        if (data.length > 2048) {
          _showPosSnack('エラー: QRのデータが長すぎます', isError: true);
          return;
        }
        final title = titleRaw == null
            ? ''
            : titleRaw
                .toString()
                .replaceAll('\r\n', ' ')
                .replaceAll('\n', ' ')
                .replaceAll('\r', ' ')
                .trim();
        _printThermalQr(data: data, title: title);
        return;
      }
      if (cmd != 'printLines') {
        return;
      }
      final linesRaw = map['lines'];
      if (linesRaw is! List) {
        _showPosSnack('エラー: 印刷データの形式が不正です', isError: true);
        return;
      }
      final strs = linesRaw.map((e) {
        if (e == null) return '';
        return e.toString().replaceAll('\r\n', ' ').replaceAll('\n', ' ').replaceAll('\r', ' ');
      }).toList();
      if (strs.isEmpty) {
        _showPosSnack('エラー: 印刷データの形式が不正です', isError: true);
        return;
      }
      _printThermalLines(strs);
    } catch (e, st) {
      debugPrint('HarunoyukotoPos message parse failed: $e\n$st');
      _showPosSnack('データの解析に失敗しました: $e', isError: true);
    }
  }

  void _initWebView(String opsUrlRaw) {
    final uri = _withNativeDrawer(opsUrlRaw);
    final c = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel(
        'HarunoyukotoPos',
        onMessageReceived: (JavaScriptMessage message) {
          _onHarunoyukotoPosMessage(message.message);
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

  /// プリンター向け Shift-JIS（CP932）エンコード。機種により別名の charset を試す。
  Future<Uint8List> _encodePrinterSjis(String text) async {
    const charsetCandidates = [
      'SHIFT_JIS',
      'Shift_JIS',
      'windows-31j',
      'MS932',
      'SJIS',
      'Cp932',
    ];
    Object? lastError;
    for (final charset in charsetCandidates) {
      try {
        if (!await CharsetConverter.checkAvailability(charset)) continue;
        return await CharsetConverter.encode(charset, text);
      } catch (e) {
        lastError = e;
      }
    }
    try {
      return await CharsetConverter.encode('SHIFT_JIS', text);
    } catch (e) {
      debugPrint('Shift-JIS encode failed ($lastError), UTF-8 fallback: $e');
      return Uint8List.fromList(utf8.encode(text));
    }
  }

  /// ESC/POS: 行ごとに Shift-JIS + LF（0x0A）で送信
  Future<Uint8List> _escPosFromTextLines(List<String> lines) async {
    final b = BytesBuilder(copy: false);
    b.addByte(0x1b);
    b.addByte(0x40);
    // 漢字モード（Epson 互換・Shift-JIS 2バイト文字用）
    b.addByte(0x1c);
    b.addByte(0x26);
    b.addByte(0x1b);
    b.addByte(0x61);
    b.addByte(0x00);
    for (final line in lines) {
      final encoded = await _encodePrinterSjis('$line\n');
      b.add(encoded);
    }
    b.addByte(0x0a);
    b.addByte(0x0a);
    b.addByte(0x1d);
    b.addByte(0x56);
    b.addByte(0x00);
    return b.takeBytes();
  }

  /// Epson 互換 QR（Model 2）。[data] は UTF-8 バイトでストアする。
  void _appendEscPosQr(BytesBuilder b, String data, {int moduleSize = 6}) {
    final payload = utf8.encode(data);
    final size = moduleSize.clamp(3, 16);

    // QR: select model 2
    b.add([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    // QR: module size
    b.add([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]);
    // QR: error correction M
    b.add([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]);
    // QR: store data (fn=80, m=48)
    final storeLen = 3 + payload.length;
    final pL = storeLen & 0xff;
    final pH = (storeLen >> 8) & 0xff;
    b.add([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]);
    b.add(payload);
    // QR: print
    b.add([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
  }

  Future<Uint8List> _escPosTableQrSlip({
    required String data,
    required String title,
  }) async {
    final b = BytesBuilder(copy: false);
    b.addByte(0x1b);
    b.addByte(0x40);
    b.addByte(0x1c);
    b.addByte(0x26);
    // 中央寄せ
    b.addByte(0x1b);
    b.addByte(0x61);
    b.addByte(0x01);

    Future<void> line(String text) async {
      b.add(await _encodePrinterSjis('$text\n'));
    }

    await line('こちらからご注文ください');
    await line('');
    if (title.isNotEmpty) {
      await line(title);
      await line('');
    }
    _appendEscPosQr(b, data, moduleSize: 6);
    await line('');
    await line('お帰りの際はこちらを');
    await line('レジまでお持ちください');
    b.addByte(0x0a);
    b.addByte(0x0a);
    b.addByte(0x1d);
    b.addByte(0x56);
    b.addByte(0x00);
    return b.takeBytes();
  }

  Future<void> _sendThermalBytes(Uint8List bytes) async {
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
      socket.add(bytes);
      await socket.flush();
      if (mounted) {
        _showPosSnack('プリンターへデータを送信しました');
      }
    } catch (e, st) {
      debugPrint('Thermal print failed: $e\n$st');
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

  Future<void> _printThermalLines(List<String> lines) async {
    await _sendThermalBytes(await _escPosFromTextLines(lines));
  }

  Future<void> _printThermalQr({
    required String data,
    required String title,
  }) async {
    await _sendThermalBytes(await _escPosTableQrSlip(data: data, title: title));
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
      body: SafeArea(
        child: Stack(
          fit: StackFit.expand,
          children: [
            _controller == null
                ? const Center(child: CircularProgressIndicator())
                : WebViewWidget(controller: _controller!),
            Positioned(
              top: 6,
              right: 6,
              child: Material(
                color: Colors.white.withValues(alpha: 0.92),
                elevation: 2,
                shadowColor: Colors.black26,
                borderRadius: BorderRadius.circular(10),
                child: IconButton(
                  icon: const Icon(Icons.settings_outlined, size: 22),
                  onPressed: _openSettings,
                  tooltip: '設定',
                  visualDensity: VisualDensity.compact,
                ),
              ),
            ),
          ],
        ),
      ),
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
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                '初回設定',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 20),
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
