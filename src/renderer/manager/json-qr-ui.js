"use strict";
(function () {
  const $ = id => document.getElementById(id), protocol = window.DeskWeekJsonQr;
  const exportDialog = $("jsonQrExportDialog"), scanDialog = $("jsonQrScanDialog"), importDialog = $("jsonImportDialog");
  let total = 0, page = 0, flipTimer, exportGeneration = 0, stream, frameTimer, cameraGeneration = 0, scanning = false, pending = null, importing = false;
  let collector = new protocol.Collector();
  const message = value => { $("jsonQrScanStatus").textContent = value; };
  function stopFlip() { clearInterval(flipTimer); flipTimer = null; $("jsonQrAuto").textContent = "自动翻页"; }
  async function showPage(index) {
    if (!exportDialog.open || !total) return;
    const generation = ++exportGeneration;
    try {
      const target = (index + total) % total, image = await window.deskWeek.qrExportPage(target);
      if (generation !== exportGeneration || !exportDialog.open) return;
      page = target; $("jsonQrImage").src = image; $("jsonQrPage").textContent = `${page + 1} / ${total}`;
    } catch (e) { stopFlip(); $("jsonQrExportInfo").textContent = e.message; }
  }
  async function openExport() {
    try {
      const result = await window.deskWeek.startQrExport(); total = result.total; page = 0;
      $("jsonQrExportInfo").textContent = `${result.count} 条任务 · ${total} 张二维码${total > 20 ? "；张数较多，建议使用 JSON 文件传输" : ""}`;
      for (const id of ["jsonQrPrev", "jsonQrNext", "jsonQrAuto"]) $(id).disabled = total === 1;
      $("jsonQrImage").removeAttribute("src"); exportDialog.showModal(); await showPage(0);
    } catch (e) { toast(`生成失败：${e.message}`); }
  }
  exportDialog.addEventListener("close", () => { if (exportDialog.open) return; ++exportGeneration; stopFlip(); $("jsonQrImage").removeAttribute("src"); window.deskWeek.closeQrExport().catch(() => {}); });
  $("jsonQrExportClose").onclick = () => exportDialog.close();
  $("jsonQrPrev").onclick = () => { stopFlip(); showPage(page - 1); };
  $("jsonQrNext").onclick = () => { stopFlip(); showPage(page + 1); };
  $("jsonQrAuto").onclick = () => { if (flipTimer) stopFlip(); else { flipTimer = setInterval(() => showPage(page + 1), 3000); $("jsonQrAuto").textContent = "暂停翻页"; } };
  function releaseCamera() {
    ++cameraGeneration; clearTimeout(frameTimer); frameTimer = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null; $("jsonQrVideo").srcObject = null;
  }
  function closeScan() { releaseCamera(); window.deskWeek.setQrCameraActive(false).catch(() => {}); }
  async function startCamera(deviceId) {
    releaseCamera(); const generation = cameraGeneration;
    if (!scanDialog.open) return;
    message("正在开启摄像头…");
    try {
      await window.deskWeek.setQrCameraActive(true);
      if (generation !== cameraGeneration || !scanDialog.open) return;
      const opened = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (generation !== cameraGeneration || !scanDialog.open) { opened.getTracks().forEach(t => t.stop()); return; }
      stream = opened; const video = $("jsonQrVideo"); video.srcObject = opened; await video.play();
      if (generation !== cameraGeneration || !scanDialog.open) return;
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput"), select = $("jsonQrCamera");
      select.replaceChildren(...devices.map((d, i) => { const option = document.createElement("option"); option.value = d.deviceId; option.textContent = d.label || `摄像头 ${i + 1}`; return option; }));
      select.value = opened.getVideoTracks()[0]?.getSettings().deviceId || "";
      message("请对准任务 JSON 二维码；多张时逐张收集，顺序不限");
      const loop = async () => {
        if (generation !== cameraGeneration || !scanDialog.open) return;
        if (!scanning && video.readyState >= 2 && video.videoWidth) {
          const canvas = $("jsonQrCanvas"), scale = Math.min(1, 1280 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
          const ctx = canvas.getContext("2d", { willReadFrequently: true }); ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = window.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "dontInvert" });
          if (code) await acceptScan(code.data);
        }
        if (generation === cameraGeneration && scanDialog.open) frameTimer = setTimeout(loop, 180);
      };
      loop();
    } catch (e) {
      if (generation !== cameraGeneration || !scanDialog.open) return;
      releaseCamera();
      message(`无法使用摄像头：${e.name === "NotAllowedError" ? "请在 Windows 隐私设置中允许桌面应用使用摄像头，然后重试" : e.message}。也可使用 JSON 文件导入。`);
    }
  }
  async function acceptScan(text) {
    if (scanning) return;
    scanning = true;
    try {
      const result = await collector.accept(text);
      message(`已收集 ${result.received} / ${result.total} 张`);
      if (result.text) { scanDialog.close(); await previewImport(result.text); }
    } catch (e) { message(`${e.message}（已收集 ${collector.progress.received} / ${collector.progress.total}）`); }
    finally { scanning = false; }
  }
  async function previewImport(text) {
    const parsed = protocol.validate(text);
    if (parsed.items.some(task => task.date && !isValidDateKey(task.date))) throw new Error("任务日期不受当前版本支持");
    if (importDialog.open) throw new Error("请先处理当前待导入的数据");
    const current = await window.deskWeek.loadStore(), ids = new Set(current.items.map(t => t.id)), same = parsed.items.filter(t => ids.has(t.id)).length;
    pending = parsed;
    $("jsonImportInfo").textContent = `读取 ${parsed.items.length} 条任务（含垃圾箱），其中 ${same} 条与现有 ID 相同。数据尚未写入。`;
    importDialog.showModal();
  }
  async function applyImport(replace) {
    if (importing || !pending) return;
    importing = true;
    try {
      const current = await window.deskWeek.loadStore(), incoming = normalizeItems(pending.items);
      if (replace) await window.deskWeek.replaceStore({ items: incoming, prefs: pending.prefs || current.prefs });
      else {
        const merged = new Map(current.items.map(t => [t.id, t])); incoming.forEach(t => merged.set(t.id, t));
        await window.deskWeek.saveStore({ items: [...merged.values()], prefs: current.prefs });
      }
      pending = null; importDialog.close(); toast("导入完成");
    } catch (e) { toast(`导入失败：${e.message}`); }
    finally { importing = false; }
  }
  $("managerQrExport").onclick = openExport;
  $("managerQrScan").onclick = () => { collector = new protocol.Collector(); scanDialog.showModal(); startCamera(); };
  $("jsonQrScanClose").onclick = () => scanDialog.close(); scanDialog.addEventListener("close", () => { if (!scanDialog.open) closeScan(); });
  $("jsonQrCamera").onchange = () => startCamera($("jsonQrCamera").value);
  $("jsonQrCameraRetry").onclick = () => startCamera();
  $("jsonQrReset").onclick = () => { collector.reset(); message("进度已清空，请扫描同一份数据"); };
  $("jsonImportCancel").onclick = () => importDialog.close(); importDialog.addEventListener("close", () => { if (!importDialog.open) pending = null; });
  $("jsonImportMerge").onclick = () => applyImport(false); $("jsonImportReplace").onclick = () => applyImport(true);
  window.addEventListener("pagehide", () => { closeScan(); stopFlip(); });
  // Shared by file input and camera decoder; camera frames never leave the renderer.
  window.DeskWeekQrUI = { previewImport, acceptScan };
})();
