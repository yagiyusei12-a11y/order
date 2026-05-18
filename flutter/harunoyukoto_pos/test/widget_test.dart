import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:harunoyukoto_pos/main.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('初回はセットアップ画面に OPS URL 入力がある', (WidgetTester tester) async {
    await tester.pumpWidget(const HarunoyukotoPosApp());
    await tester.pumpAndSettle();
    expect(find.text('OPS の URL'), findsOneWidget);
    expect(find.text('初回設定'), findsOneWidget);
  });
}
