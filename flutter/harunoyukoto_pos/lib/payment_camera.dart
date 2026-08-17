import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';

/// 内カメラを無プレビューで暖機し、JPEG を返す。
/// Android はプレビュー Texture がないと黒フレームになりやすいので、
/// [previewController] を小さな CameraPreview に載せる想定。
class PaymentCameraService {
  CameraController? _controller;
  Future<void>? _initFuture;
  Future<Uint8List?>? _inFlight;
  final ValueNotifier<int> previewEpoch = ValueNotifier(0);

  CameraController? get previewController {
    final c = _controller;
    if (c != null && c.value.isInitialized) return c;
    return null;
  }

  void _notifyPreview() {
    previewEpoch.value++;
  }

  Future<bool> ensureReady() async {
    final status = await Permission.camera.request();
    if (!status.isGranted) {
      debugPrint('PaymentCamera: camera permission denied');
      return false;
    }
    _initFuture ??= _initFrontCamera();
    try {
      await _initFuture;
      return _controller?.value.isInitialized == true;
    } catch (e, st) {
      debugPrint('PaymentCamera init failed: $e\n$st');
      _initFuture = null;
      _notifyPreview();
      return false;
    }
  }

  Future<void> _initFrontCamera() async {
    final cams = await availableCameras();
    if (cams.isEmpty) {
      throw StateError('no cameras');
    }
    final front = cams.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.front,
      orElse: () => cams.first,
    );
    final ctrl = CameraController(
      front,
      ResolutionPreset.medium,
      enableAudio: false,
      imageFormatGroup: ImageFormatGroup.jpeg,
    );
    await ctrl.initialize();
    try {
      await ctrl.setFlashMode(FlashMode.off);
    } catch (_) {}
    _controller = ctrl;
    _notifyPreview();
    // センサー露光待ち。直後の takePicture は黒になりやすい。
    await Future<void>.delayed(const Duration(milliseconds: 600));
  }

  /// 成功時 JPEG bytes。失敗・黒フレームのみのときは null（呼び出し側は会計を止めない）
  Future<Uint8List?> captureJpeg() async {
    while (_inFlight != null) {
      try {
        await _inFlight;
      } catch (_) {}
    }
    final started = _captureJpegLocked();
    _inFlight = started;
    try {
      return await started;
    } finally {
      if (identical(_inFlight, started)) {
        _inFlight = null;
      }
    }
  }

  Future<Uint8List?> _captureJpegLocked() async {
    try {
      for (var round = 0; round < 2; round++) {
        if (round > 0) {
          await disposeController();
        }
        final ok = await ensureReady();
        if (!ok) return null;
        final ctrl = _controller;
        if (ctrl == null || !ctrl.value.isInitialized) return null;

        for (var i = 0; i < 4; i++) {
          if (i > 0) {
            await Future<void>.delayed(const Duration(milliseconds: 280));
          }
          if (ctrl.value.isTakingPicture) {
            await Future<void>.delayed(const Duration(milliseconds: 200));
          }
          final bytes = await _takeOnce(ctrl);
          if (bytes == null || bytes.isEmpty) continue;
          if (await jpegIsMostlyBlack(bytes)) {
            debugPrint('PaymentCamera: discarded black frame (try $round.$i)');
            continue;
          }
          return bytes;
        }
      }
      debugPrint('PaymentCamera: gave up after black/empty frames');
      return null;
    } catch (e, st) {
      debugPrint('PaymentCamera capture failed: $e\n$st');
      await disposeController();
      return null;
    }
  }

  Future<Uint8List?> _takeOnce(CameraController ctrl) async {
    try {
      if (!ctrl.value.isInitialized) return null;
      final file = await ctrl.takePicture();
      final bytes = await File(file.path).readAsBytes();
      try {
        await File(file.path).delete();
      } catch (_) {}

      if (bytes.length > 2 * 1024 * 1024) {
        debugPrint('PaymentCamera: jpeg too large ${bytes.length}');
        if (bytes.length > 2.4 * 1024 * 1024) return null;
      }
      return bytes;
    } catch (e, st) {
      debugPrint('PaymentCamera takePicture failed: $e\n$st');
      return null;
    }
  }

  Future<void> disposeController() async {
    final c = _controller;
    _controller = null;
    _initFuture = null;
    _notifyPreview();
    if (c != null) {
      try {
        await c.dispose();
      } catch (_) {}
    }
  }

  static String toBase64(Uint8List bytes) => base64Encode(bytes);
}

/// ほぼ全画素が黒に近い JPEG（露光前）なら true。暗い店内の人物は false。
Future<bool> jpegIsMostlyBlack(Uint8List jpeg) async {
  try {
    final codec = await ui.instantiateImageCodec(
      jpeg,
      targetWidth: 48,
      targetHeight: 48,
    );
    final frame = await codec.getNextFrame();
    final image = frame.image;
    final bd = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    image.dispose();
    if (bd == null) return false;
    final px = bd.buffer.asUint8List();
    final n = px.length ~/ 4;
    if (n == 0) return true;
    var dark = 0;
    var sum = 0;
    for (var i = 0; i < px.length; i += 4) {
      final y = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) ~/ 1000;
      sum += y;
      if (y < 18) dark++;
    }
    final avg = sum / n;
    return avg < 14 && dark >= (n * 0.92).floor();
  } catch (e) {
    debugPrint('PaymentCamera jpeg probe failed: $e');
    return false;
  }
}
