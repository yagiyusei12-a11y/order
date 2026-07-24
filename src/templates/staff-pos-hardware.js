/**
 * BUSICOM BC-423M（キャッシュドロワー）・ESC/POS サーマル（例: Q806K）向け。
 * Chrome / Edge の Web Serial API で USB シリアルに接続する前提。
 * - window.openCashDrawer を上書きし、接続済みなら ESC/POS パルスでドロア開放。
 * - window.posThermalPrintLines(lines[]) でレシート／領収書を印字。
 *
 * プリンタによりドロアパルス・切断コマンド・文字コードが異なる場合があります。
 * localStorage: posSerialBaudRate = "9600" | "115200"（既定 9600）
 */
(function () {
  /** @type {SerialPort | null} */
  let port = null;
  /** @type {WritableStreamDefaultWriter<Uint8Array> | null} */
  let writer = null;

  const STORAGE_BAUD = "posSerialBaudRate";

  function getBaudRate() {
    try {
      const raw = localStorage.getItem(STORAGE_BAUD);
      const n = raw ? parseInt(raw, 10) : 9600;
      return n === 115200 ? 115200 : 9600;
    } catch (_) {
      return 9600;
    }
  }

  function uint8Concat(parts) {
    let len = 0;
    for (const p of parts) len += p.byteLength;
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.byteLength;
    }
    return out;
  }

  /** ESC/POS キャッシュドロア開放（Epson 互換 ESC p）—配線がプリンタ経由の場合 */
  function drawerKickBytes() {
    return new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  }

  /** 初期化・左寄せ・UTF-8 テキスト（機種により日本語は文字化けする場合あり） */
  function escPosFromTextLines(lines) {
    const enc = new TextEncoder();
    const chunks = [];
    chunks.push(new Uint8Array([0x1b, 0x40]));
    chunks.push(new Uint8Array([0x1b, 0x61, 0x00]));
    for (const line of lines) {
      chunks.push(enc.encode(String(line) + "\n"));
    }
    chunks.push(new Uint8Array([0x0a, 0x0a]));
    chunks.push(new Uint8Array([0x1d, 0x56, 0x00]));
    return uint8Concat(chunks);
  }

  function setStatus(msg) {
    const el = document.getElementById("posHwStatus");
    if (el) el.textContent = msg || "";
  }

  function dispatchDrawerFallback() {
    try {
      window.dispatchEvent(new CustomEvent("pos:drawer-open"));
    } catch (_) {}
  }

  async function releaseWriter() {
    try {
      if (writer) {
        writer.release();
      }
    } catch (_) {}
    writer = null;
  }

  async function closePort() {
    await releaseWriter();
    try {
      if (port) await port.close();
    } catch (_) {}
    port = null;
    setStatus("");
  }

  async function ensureWriter() {
    if (writer) return writer;
    throw new Error("POSプリンタが未接続です。「POSプリンタ接続」を押してください。");
  }

  /** @returns {Promise<boolean>} */
  async function connectPrinter() {
    if (!navigator.serial) {
      throw new Error("このブラウザは Web Serial に対応していません（Chrome / Edge をご利用ください）");
    }
    await closePort();
    port = await navigator.serial.requestPort({});
    const baudRate = getBaudRate();
    await port.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      bufferSize: 4096,
      flowControl: "none",
    });
    writer = port.writable.getWriter();
    setStatus("POS接続済み (" + baudRate + " baud)");
    return true;
  }

  async function disconnectPrinter() {
    await closePort();
    setStatus("切断しました");
  }

  async function writeBytes(buf) {
    const w = await ensureWriter();
    await w.write(buf);
  }

  /**
   * ドロア開放（プリンタ経由）。未接続時は従来どおり CustomEvent のみ。
   */
  window.openCashDrawer = async function openCashDrawerEscPos() {
    if (!navigator.serial) {
      dispatchDrawerFallback();
      return;
    }
    try {
      await writeBytes(drawerKickBytes());
    } catch (_) {
      dispatchDrawerFallback();
    }
  };

  /**
   * @param {string[]} lines
   */
  window.posThermalPrintLines = async function posThermalPrintLines(lines) {
    await writeBytes(escPosFromTextLines(lines));
  };

  /**
   * 卓QRスリップ（Epson 互換 GS ( k）。UTF-8 でデータストア。
   * @param {{ data: string, title?: string }} opts
   */
  window.posThermalPrintQr = async function posThermalPrintQr(opts) {
    const data = String((opts && opts.data) || "").trim();
    if (!data) throw new Error("QR data required");
    if (data.length > 2048) throw new Error("QR data too long");
    const title = String((opts && opts.title) || "")
      .replace(/\r\n/g, " ")
      .replace(/\n/g, " ")
      .replace(/\r/g, " ")
      .trim();
    const enc = new TextEncoder();
    const chunks = [];
    chunks.push(new Uint8Array([0x1b, 0x40]));
    chunks.push(new Uint8Array([0x1b, 0x61, 0x01]));
    function pushLine(text) {
      chunks.push(enc.encode(String(text) + "\n"));
    }
    pushLine("こちらからご注文ください");
    pushLine("");
    if (title) {
      pushLine(title);
      pushLine("");
    }
    const payload = enc.encode(data);
    const moduleSize = 6;
    chunks.push(new Uint8Array([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]));
    chunks.push(new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize]));
    chunks.push(new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]));
    const storeLen = 3 + payload.length;
    chunks.push(
      new Uint8Array([0x1d, 0x28, 0x6b, storeLen & 0xff, (storeLen >> 8) & 0xff, 0x31, 0x50, 0x30])
    );
    chunks.push(payload);
    chunks.push(new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]));
    pushLine("");
    pushLine("お帰りの際はこちらを");
    pushLine("レジまでお持ちください");
    chunks.push(new Uint8Array([0x0a, 0x0a]));
    chunks.push(new Uint8Array([0x1d, 0x56, 0x00]));
    await writeBytes(uint8Concat(chunks));
  };

  window.posPrinterConnected = function () {
    return !!writer;
  };

  window.posConnectPrinter = connectPrinter;
  window.posDisconnectPrinter = disconnectPrinter;

  function bootPosHwUi() {
    const baudSel = document.getElementById("posSerialBaud");
    if (baudSel) {
      try {
        baudSel.value = String(getBaudRate());
      } catch (_) {}
      baudSel.addEventListener("change", () => {
        try {
          localStorage.setItem(STORAGE_BAUD, baudSel.value);
        } catch (_) {}
      });
    }

    const btnConn = document.getElementById("btnPosConnect");
    const btnDisc = document.getElementById("btnPosDisconnect");
    const btnDrawer = document.getElementById("btnPosDrawerOpen");

    if (btnConn) {
      btnConn.onclick = async () => {
        try {
          await connectPrinter();
        } catch (e) {
          setStatus(String(e.message || e));
        }
      };
    }
    if (btnDisc) {
      btnDisc.onclick = async () => {
        try {
          await disconnectPrinter();
        } catch (e) {
          setStatus(String(e.message || e));
        }
      };
    }
    if (btnDrawer) {
      btnDrawer.onclick = async () => {
        try {
          if (typeof window.openCashDrawer === "function") {
            await window.openCashDrawer();
          }
        } catch (e) {
          setStatus(String(e.message || e));
        }
      };
    }

    if (navigator.serial) {
      navigator.serial.addEventListener("disconnect", () => {
        closePort().catch(() => {});
        setStatus("POSプリンタが切断されました");
      });
    }
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", bootPosHwUi);
  } else {
    bootPosHwUi();
  }
})();

