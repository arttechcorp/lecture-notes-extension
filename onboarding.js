// 최초 실행 안내. 여기서 준비 상태를 다 판정해 두면, 캡처 도중에 원인 불명으로 죽는 일이 없다.
const $ = (id) => document.getElementById(id);

// --- 1. 동의 --------------------------------------------------------------------
$("consent").addEventListener("change", async (e) => {
  $("doneBtn").disabled = !e.target.checked;
  $("doneHint").textContent = e.target.checked ? "" : "1번 동의가 필요합니다";
  await saveSettings({ consentAccepted: e.target.checked });
});

// --- 2. 온디바이스 상태 -----------------------------------------------------------
function setLocalState(cls, text) {
  const el = $("localState");
  el.className = `state ${cls}`;
  el.textContent = text;
}

async function refreshLocal() {
  if (typeof LanguageModel === "undefined") {
    return setLocalState(
      "bad",
      "이 브라우저에는 내장 AI가 없습니다. Chrome 138 이상인지 확인하세요. 3번에서 API 키를 넣으면 원격으로 쓸 수 있지만, 그 경우 화면 이미지가 외부로 전송됩니다."
    );
  }
  const status = await localAvailability();
  if (status === "available") {
    setLocalState("ok", "사용 가능합니다. 설정할 것이 없습니다 — 화면 이미지가 기기를 벗어나지 않습니다.");
    $("downloadBtn").style.display = "none";
  } else if (status === "downloadable") {
    setLocalState("warn", "사용 가능하지만 모델을 아직 내려받지 않았습니다. 아래 버튼을 누르세요(수 GB, 몇 분 소요).");
    $("downloadBtn").style.display = "inline-block";
  } else if (status === "downloading") {
    setLocalState("warn", "모델을 내려받는 중입니다. 완료 후 다시 확인하세요.");
    $("downloadBtn").style.display = "none";
  } else {
    setLocalState(
      "bad",
      "이 기기에서는 온디바이스 AI를 쓸 수 없습니다. 아래 요구 사항(디스크 22GB·RAM 16GB 또는 VRAM 4GB)을 확인하세요. " +
        "충족하지 못하면 3번에서 API 키를 넣고 설정에서 원격 OCR을 켜야 하는데, 그 경우 화면 이미지가 외부 제공자로 전송됩니다."
    );
    $("downloadBtn").style.display = "none";
  }
}

$("downloadBtn").addEventListener("click", async () => {
  $("downloadBtn").disabled = true;
  try {
    const session = await createLocalSession((p) => setLocalState("warn", `내려받는 중... ${Math.round(p * 100)}%`));
    if (session.destroy) session.destroy();
    await refreshLocal();
  } catch (e) {
    setLocalState("bad", `다운로드 실패: ${e.message || e}`);
  } finally {
    $("downloadBtn").disabled = false;
  }
});

// --- 3. API 키 -------------------------------------------------------------------
function syncKeyLink() {
  $("keyLink").href = PROVIDER_KEY_URL[$("provider").value];
}

$("provider").addEventListener("change", async () => {
  syncKeyLink();
  // 모델 기본값도 제공자에 맞춰 초기화한다.
  await saveSettings({ provider: $("provider").value, summaryModel: PROVIDER_DEFAULT_MODEL[$("provider").value] });
});

// 키가 잘못됐다는 걸 캡처 도중이 아니라 여기서 알아야 한다. 최소 요청 1회를 실제로 보낸다.
$("verifyBtn").addEventListener("click", async () => {
  const key = $("apiKey").value.trim();
  const provider = $("provider").value;
  if (!key) return ($("verifyState").textContent = "키를 먼저 입력하세요.");
  $("verifyBtn").disabled = true;
  $("verifyState").textContent = "확인 중...";
  try {
    const model = PROVIDER_DEFAULT_MODEL[provider];
    const body = buildSummaryBody(provider, model, "간단히 답하라.", "ok");
    await callRemote(provider, model, key, body);
    await saveApiKey(key, $("syncKey").checked);
    await saveSettings({ provider, summaryModel: model });
    $("verifyState").textContent = "확인됨. 저장했습니다.";
  } catch (e) {
    $("verifyState").textContent = `실패: ${String(e.message || e).slice(0, 160)}`;
  } finally {
    $("verifyBtn").disabled = false;
  }
});

$("syncKey").addEventListener("change", async () => {
  const key = $("apiKey").value.trim();
  if (key) await saveApiKey(key, $("syncKey").checked);
});

$("doneBtn").addEventListener("click", () => window.close());

// --- 초기 상태 복원 ---------------------------------------------------------------
(async () => {
  const s = await loadSettings();
  $("provider").value = s.provider;
  $("syncKey").checked = s.syncKey;
  $("consent").checked = s.consentAccepted;
  $("doneBtn").disabled = !s.consentAccepted;
  if (s.consentAccepted) $("doneHint").textContent = "";
  if (s.apiKey) $("apiKey").value = s.apiKey;
  syncKeyLink();
  await refreshLocal();
})();
