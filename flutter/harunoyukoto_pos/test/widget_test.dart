import 'package:flutter_test/flutter_test.dart';

import 'package:harunoyukoto_pos/main.dart';

void main() {
  testWidgets('AppBar title is visible', (WidgetTester tester) async {
    await tester.pumpWidget(const HarunoyukotoPosApp());
    expect(find.text('はるのゆこと レジシステム'), findsOneWidget);
  });
}
