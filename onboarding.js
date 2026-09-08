// 최초 실행 안내. 여기서 준비 상태를 다 판정해 두면, 캡처 도중에 원인 불명으로 죽는 일이 없다.
const $ = (id) => document.getElementById(id);

// --- 1. 동의 --------------------------------------------------------------------
$("consent").addEventListener("change", async (e) => {
  $("doneBtn").disabled = !e.target.checked;
  $("doneHint").textContent = e.target.checked ? "" : "1번 동의가 필요합니다";
  await saveSettings({ consentAccepted: e.target.checked });
});

// --- 2. 온디바이스 상태 -----------------------------------------------------------
function setLocalState(cls, text, detail) {
  const el = $("localState");
  el.className = `state ${cls}`;
  el.textContent = detail ? `${text}

[진단] 이미지 입력: ${detail}` : text;
  el.style.whiteSpace = "pre-wrap";
}

// downloading 상태는 스스로 풀리기를 기다려야 한다. 그런데 페이지 로드 때 한 번만
// 확인하면 "완료 후 다시 확인하세요"라고 해놓고 다시 확인할 방법을 안 주는 꼴이다.
// 진행률도 안 보여서 받고 있는지 멈췄는지 구분이 안 된다. 그래서 직접 폴링한다.
let pollTimer = null;
let downloadingSince = 0;

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

const mmss = (ms) => {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}분 ${String(sec % 60).padStart(2, "0")}초`;
};

async function refreshLocal() {
  if (typeof LanguageModel === "undefined") {
    stopPolling();
    return setLocalState(
      "bad",
      "이 브라우저에는 내장 AI가 없습니다. Chrome 138 이상인지 확인하세요. 3번에서 API 키를 넣으면 원격으로 쓸 수 있지만, 그 경우 화면 이미지가 외부로 전송됩니다."
    );
  }
  const status = await localAvailability();
  // 텍스트 전용 상태도 같이 읽는다. 둘이 갈리면 원인이 "모델이 없다"가 아니라
  // "이미지 입력 능력이 없다"라는 뜻이고, 조치가 완전히 다르다.
  const textStatus = await localAvailability({});
  if (status !== "downloading") {
    stopPolling();
    downloadingSince = 0;
  }
  if (status === "available") {
    setLocalState("ok", "사용 가능합니다. 설정할 것이 없습니다 — 화면 이미지가 기기를 벗어나지 않습니다.");
    $("downloadBtn").style.display = "none";
  } else if (status === "downloadable") {
    setLocalState(
      "warn",
      textStatus === "available"
        ? "텍스트 모델은 준비됐지만 이미지 입력 능력이 아직 없습니다. 이 확장은 화면 OCR에 이미지 입력이 필요합니다. " +
            "아래 버튼을 누르면 그 부분을 내려받습니다. (chrome://components 에 버전이 보여도 이 상태일 수 있습니다.)"
        : "사용 가능하지만 모델을 아직 내려받지 않았습니다. 아래 버튼을 누르세요(수 GB, 몇 분 소요)."
    );
    $("downloadBtn").style.display = "inline-block";
  } else if (status === "downloading") {
    if (!downloadingSince) downloadingSince = Date.now();
    setLocalState(
      "warn",
      `모델을 내려받는 중입니다 (경과 ${mmss(Date.now() - downloadingSince)}). 완료되면 이 화면이 저절로 바뀝니다. ` +
        "수 GB라 네트워크에 따라 오래 걸릴 수 있습니다. 실제 진행률은 chrome://on-device-internals 에서 볼 수 있습니다."
    );
    $("downloadBtn").style.display = "none";
    // 완료를 스스로 감지한다. 5초면 화면이 살아 있다는 게 보이고 부담도 없다.
    stopPolling();
    pollTimer = setTimeout(refreshLocal, 5000);
  } else {
    setLocalState(
      "bad",
      "이 기기에서는 온디바이스 AI를 쓸 수 없습니다. 아래 요구 사항(디스크 22GB·RAM 16GB 또는 VRAM 4GB)을 확인하세요. " +
        "충족하지 못하면 3번에서 API 키를 넣고 설정에서 원격 OCR을 켜야 하는데, 그 경우 화면 이미지가 외부 제공자로 전송됩니다."
    );
    $("downloadBtn").style.display = "none";
  }
  // 두 값이 갈리면 chrome://components 의 버전 표시와 여기가 왜 어긋나는지가 설명된다.
  $("localState").textContent += `\n\n[진단] 이미지 입력 ${status} · 텍스트 전용 ${textStatus}`;
}

$("downloadBtn").addEventListener("click", async () => {
  $("downloadBtn").disabled = true;
  try {
    const session = await createLocalSession((p) => setLocalState("warn", `내려받는 중... ${Math.round(p * 100)}%`));
    if (session.destroy) session.destroy();
    await refreshLocal();
  } catch (e) {
    setLocalState("bad", `다운로드 실패: ${e.message || e} — 아래 "다시 확인"으로 상태를 새로 읽을 수 있습니다.`);
  } finally {
    $("downloadBtn").disabled = false;
  }
});

$("recheckBtn").addEventListener("click", () => {
  downloadingSince = 0; // 수동 확인이면 경과 시간도 새로 센다
  refreshLocal();
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
