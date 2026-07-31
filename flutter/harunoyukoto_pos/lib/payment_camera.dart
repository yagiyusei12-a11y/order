import 'dart:convert';
import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';

/// 内カメラを無プレビューで暖機し、JPEG を返す。
class PaymentCameraService {
  CameraController? _controller;
  Future<void>? _initFuture;
  bool _capturing = false;

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
    // 一部端末のシャッター音・フラッシュを抑える
    try {
      await ctrl.setFlashMode(FlashMode.off);
    } catch (_) {}
    _controller = ctrl;
  }

  /// 成功時 JPEG bytes。失敗時 null（呼び出し側は会計を止めない）
  Future<Uint8List?> captureJpeg() async {
    if (_capturing) return null;
    _capturing = true;
    try {
      final ok = await ensureReady();
      if (!ok) return null;
      final ctrl = _controller;
      if (ctrl == null || !ctrl.value.isInitialized) return null;
      if (ctrl.value.isTakingPicture) return null;

      final file = await ctrl.takePicture();
      final bytes = await File(file.path).readAsBytes();
      try {
        await File(file.path).delete();
      } catch (_) {}

      // 大きすぎる場合は簡易間引きせずそのまま（サーバー側 2.5MB 上限）
      if (bytes.length > 2 * 1024 * 1024) {
        debugPrint('PaymentCamera: jpeg too large ${bytes.length}');
        // medium でも大きい場合は諦めて送る／失敗扱い
        if (bytes.length > 2.4 * 1024 * 1024) return null;
      }
      return bytes;
    } catch (e, st) {
      debugPrint('PaymentCamera capture failed: $e\n$st');
      // 再初期化を促す
      await disposeController();
      return null;
    } finally {
      _capturing = false;
    }
  }

  Future<void> disposeController() async {
    final c = _controller;
    _controller = null;
    _initFuture = null;
    if (c != null) {
      try {
        await c.dispose();
      } catch (_) {}
    }
  }

  static String toBase64(Uint8List bytes) => base64Encode(bytes);
}
