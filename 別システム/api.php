<?php
header('Content-Type: application/json');
$dbFile = __DIR__ . '/database.sqlite';
$isNew = !file_exists($dbFile);

$masterIds = ['C1','C2','C3','C4','C5','C6','C7','C8','C9','C10','T31','T32','T33','T34','T35','T36','T37','T21','T23','T22','T24','T52','T53','T54','T61','T62','T63','T64'];

try {
    $pdo = new PDO('sqlite:' . $dbFile);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    if ($isNew) {
        $pdo->exec("CREATE TABLE config (id INTEGER PRIMARY KEY, data TEXT)");
        $pdo->exec("CREATE TABLE state (id INTEGER PRIMARY KEY, call_reserved INTEGER, call_type TEXT, entry_queue TEXT)");
        $pdo->exec("CREATE TABLE shifts (shift_key TEXT PRIMARY KEY, seats TEXT, waiting TEXT)");
        $pdo->exec("CREATE TABLE reservations (res_id TEXT PRIMARY KEY, data TEXT)");
        $pdo->exec("INSERT INTO config (id, data) VALUES (1, '{\"staff\":6,\"override\":false,\"manualWait\":30}')");
        $pdo->exec("INSERT INTO state (id, call_reserved, call_type, entry_queue) VALUES (1, 0, '', '[]')");
    }

    $lastMod = filemtime($dbFile);
    $etag = md5((string)$lastMod);
    header("Etag: $etag");

    // ★修正：データ取得時に、もし席が空っぽになっていたら自動で28席を復元する
    function getFullState($pdo, $masterIds) {
        $state = [];
        $confRaw = $pdo->query("SELECT data FROM config WHERE id=1")->fetchColumn();
        $state['config'] = json_decode($confRaw, true);

        $sysState = $pdo->query("SELECT call_reserved, call_type, entry_queue FROM state WHERE id=1")->fetch(PDO::FETCH_ASSOC);
        $state['callReserved'] = (bool)$sysState['call_reserved'];
        $state['callType'] = $sysState['call_type'];
        $state['entryQueue'] = json_decode($sysState['entry_queue'], true);

        $state['shifts'] = [];
        $stmt = $pdo->query("SELECT shift_key, seats, waiting FROM shifts");
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $seats = json_decode($row['seats'], true);
            // 席データが消えてしまっている場合の自動復元
            if (!$seats || empty($seats)) {
                $seats = [];
                foreach($masterIds as $id) { $seats[] = ["id"=>$id,"status"=>"vacant","current"=>0,"cleanStart"=>null,"entryTime"=>null]; }
                $pdo->prepare("UPDATE shifts SET seats=? WHERE shift_key=?")->execute([json_encode($seats), $row['shift_key']]);
            }
            $state['shifts'][$row['shift_key']] = [
                'seats' => $seats,
                'waiting' => json_decode($row['waiting'], true)
            ];
        }

        $state['reservations'] = [];
        $stmt = $pdo->query("SELECT data FROM reservations");
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $state['reservations'][] = json_decode($row['data'], true);
        }
        return $state;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        if ($input) {
            $pdo->beginTransaction();
            $shiftKey = $input['shiftKey'] ?? '';
            $type = $input['type'] ?? '';

            if ($shiftKey) {
                $stmt = $pdo->prepare("SELECT COUNT(*) FROM shifts WHERE shift_key=?");
                $stmt->execute([$shiftKey]);
                if ($stmt->fetchColumn() == 0) {
                    $initSeats = [];
                    foreach($masterIds as $id) { $initSeats[] = ["id"=>$id,"status"=>"vacant","current"=>0,"cleanStart"=>null,"entryTime"=>null]; }
                    $stmtInsert = $pdo->prepare("INSERT INTO shifts (shift_key, seats, waiting) VALUES (?, ?, '[]')");
                    $stmtInsert->execute([$shiftKey, json_encode($initSeats)]);
                }
            }

            if ($type === 'updateAll' && $shiftKey) {
                // 席データが空配列で送信されるのを防ぐ
                if(!empty($input['seats'])) {
                    $stmt = $pdo->prepare("UPDATE shifts SET seats=?, waiting=? WHERE shift_key=?");
                    $stmt->execute([json_encode($input['seats']), json_encode($input['waiting']), $shiftKey]);
                }
                if (isset($input['newEntry'])) {
                    $sysState = $pdo->query("SELECT entry_queue FROM state WHERE id=1")->fetchColumn();
                    $q = json_decode($sysState, true); $q[] = $input['newEntry'];
                    $pdo->prepare("UPDATE state SET entry_queue=? WHERE id=1")->execute([json_encode($q)]);
                }
            }
            elseif ($type === 'updateSeats' && $shiftKey && !empty($input['payload'])) {
                $stmt = $pdo->prepare("UPDATE shifts SET seats=? WHERE shift_key=?");
                $stmt->execute([json_encode($input['payload']), $shiftKey]);
            }
            elseif ($type === 'updateConfig') {
                $confRaw = $pdo->query("SELECT data FROM config WHERE id=1")->fetchColumn();
                $conf = array_merge(json_decode($confRaw, true), $input['payload']);
                $pdo->prepare("UPDATE config SET data=? WHERE id=1")->execute([json_encode($conf)]);
            }
            elseif ($type === 'callReserved') { $pdo->prepare("UPDATE state SET call_reserved=1, call_type=? WHERE id=1")->execute([$input['callType'] ?? 'normal']); }
            elseif ($type === 'resetCall') { $pdo->prepare("UPDATE state SET call_reserved=0, call_type='' WHERE id=1")->execute(); }
            elseif ($type === 'popEntry') {
                $sysState = $pdo->query("SELECT entry_queue FROM state WHERE id=1")->fetchColumn();
                $q = json_decode($sysState, true); array_shift($q);
                $pdo->prepare("UPDATE state SET entry_queue=? WHERE id=1")->execute([json_encode($q)]);
            }
            elseif ($type === 'addReservation') {
                $res = $input['reservation'];
                $pdo->prepare("INSERT OR REPLACE INTO reservations (res_id, data) VALUES (?, ?)")->execute([$res['resId'], json_encode($res, JSON_UNESCAPED_UNICODE)]);
            }
            elseif ($type === 'bulkUpdateReservations') {
                $newReservations = $input['reservations'] ?? [];
                $stmt = $pdo->prepare("INSERT OR REPLACE INTO reservations (res_id, data) VALUES (?, ?)");
                foreach ($newReservations as $res) { if (isset($res['resId'])) $stmt->execute([$res['resId'], json_encode($res, JSON_UNESCAPED_UNICODE)]); }
            }

            $pdo->commit(); echo json_encode(["status"=>"success"]); exit;
        }
    } else {
        if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && $_SERVER['HTTP_IF_NONE_MATCH'] == $etag) { header('HTTP/1.1 304 Not Modified'); exit; }
        echo json_encode(getFullState($pdo, $masterIds), JSON_UNESCAPED_UNICODE);
    }
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) { $pdo->rollBack(); }
    http_response_code(500); echo json_encode(["error" => $e->getMessage()]);
}