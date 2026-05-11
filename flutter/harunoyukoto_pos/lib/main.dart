import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';

void main() {
  runApp(const HarunoyukotoPosApp());
}

/// はるのゆこと レジ（第一段階）: LAN 上の ESC/POS サーマルへ TCP でドロアキックのみ送信。
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
      home: const CashDrawerPage(),
    );
  }
}

class CashDrawerPage extends StatefulWidget {
  const CashDrawerPage({super.key});

  @override
  State<CashDrawerPage> createState() => _CashDrawerPageState();
}

class _CashDrawerPageState extends State<CashDrawerPage> {
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

  final TextEditingController _ipController = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _ipController.dispose();
    super.dispose();
  }

  bool _looksLikeIpv4(String host) {
    final re = RegExp(r'^\d{1,3}(\.\d{1,3}){3}$');
    if (!re.hasMatch(host)) return false;
    return host.split('.').every((p) {
      final n = int.tryParse(p);
      return n != null && n >= 0 && n <= 255;
    });
  }

  Future<void> _openDrawer() async {
    final ip = _ipController.text.trim();
    if (ip.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('プリンターの IP アドレスを入力してください')),
      );
      return;
    }
    if (!_looksLikeIpv4(ip)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('IP アドレスの形式が正しくありません')),
      );
      return;
    }

    setState(() => _busy = true);
    Socket? socket;
    try {
      socket = await Socket.connect(
        ip,
        _printerPort,
        timeout: _connectTimeout,
      );
      socket.add(_drawerKick);
      await socket.flush();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('ドロアを開けました')),
      );
    } catch (e, st) {
      debugPrint('Drawer open failed: $e\n$st');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('プリンターに接続できませんでした: $e')),
      );
    } finally {
      try {
        socket?.destroy();
      } catch (_) {
        // ignore
      }
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('はるのゆこと レジシステム'),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _ipController,
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  labelText: 'プリンター IP アドレス',
                  hintText: '192.168.0.100',
                ),
                enabled: !_busy,
              ),
              const SizedBox(height: 28),
              SizedBox(
                height: 56,
                child: ElevatedButton(
                  onPressed: _busy ? null : _openDrawer,
                  child: _busy
                      ? const SizedBox(
                          width: 26,
                          height: 26,
                          child: CircularProgressIndicator(strokeWidth: 2.5),
                        )
                      : const Text(
                          'ドロアを開ける',
                          style: TextStyle(fontSize: 18),
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
