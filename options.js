const apiKeyEl = document.getElementById("apiKey");
const savedEl = document.getElementById("saved");
const syncCb = document.getElementById("syncCb");
const revealCb = document.getElementById("revealCb");
const providerEl = document.getElementById("provider");
const keyLink = document.getElementById("keyLink");
const whisperCb = document.getElementById("whisperCb");
const whisperModelEl = document.getElementById("whisperModel");
const ocrEnabledCb = document.getElementById("ocrEnabledCb");
const ocrEngineSelect = document.getElementById("ocrEngineSelect");

const PROVIDER_URLS = {
  openrouter: "https://openrouter.ai/keys",
  gemini: "https://aistudio.google.com/apikey",
  anthropic: "https://console.anthropic.com/settings/keys"
};

function updateLink() {
  if (keyLink && providerEl) {
    keyLink.href = PROVIDER_URLS[providerEl.value] || "#";
  }
}

if (providerEl) {
  providerEl.addEventListener("change", updateLink);
}

async function populateSettings() {
  const { apiKey, provider, whisperEnabled, whisperModel, syncKey, ocrEnabled, ocrEngine } = await loadSettings();
  
  if (whisperModelEl) {
    whisperModelEl.value = whisperModel || "tiny";
  }
  
  if (providerEl && provider) {
    providerEl.value = provider;
  }
  
  if (whisperCb) {
    whisperCb.checked = !!whisperEnabled;
  }
  if (ocrEnabledCb) {
    ocrEnabledCb.checked = ocrEnabled !== false;
  }
  if (ocrEngineSelect) {
    ocrEngineSelect.value = ocrEngine || "nano";
  }
  updateLink();

  if (apiKeyEl) {
    apiKeyEl.value = apiKey || "";
  }
  if (syncCb) {
    syncCb.checked = !!syncKey;
  }
}

populateSettings();

if (revealCb && apiKeyEl) {
  revealCb.addEventListener("change", () => {
    apiKeyEl.type = revealCb.checked ? "text" : "password";
  });
}

if (whisperCb) {
  whisperCb.addEventListener("change", async () => {
    await chrome.storage.local.set({ whisperEnabled: whisperCb.checked });
    if (savedEl) {
      savedEl.hidden = false;
      setTimeout(() => (savedEl.hidden = true), 1500);
    }
  });
}

if (whisperModelEl) {
  whisperModelEl.addEventListener("change", async () => {
    await chrome.storage.local.set({ whisperModel: whisperModelEl.value });
    if (savedEl) {
      savedEl.hidden = false;
      setTimeout(() => (savedEl.hidden = true), 1500);
    }
  });
}

if (ocrEnabledCb) {
  ocrEnabledCb.addEventListener("change", async () => {
    await chrome.storage.local.set({ ocrEnabled: ocrEnabledCb.checked });
    if (savedEl) {
      savedEl.hidden = false;
      setTimeout(() => (savedEl.hidden = true), 1500);
    }
  });
}

if (ocrEngineSelect) {
  ocrEngineSelect.addEventListener("change", async () => {
    await chrome.storage.local.set({ ocrEngine: ocrEngineSelect.value });
    if (savedEl) {
      savedEl.hidden = false;
      setTimeout(() => (savedEl.hidden = true), 1500);
    }
  });
}

const saveBtn = document.getElementById("saveBtn");
if (saveBtn) {
  saveBtn.addEventListener("click", async () => {
    const key = apiKeyEl ? apiKeyEl.value.trim() : "";
    const provider = providerEl ? providerEl.value : "gemini";
    const whisperEnabled = whisperCb ? whisperCb.checked : false;
    const whisperModel = whisperModelEl ? whisperModelEl.value : "tiny";
    const ocrEnabled = ocrEnabledCb ? ocrEnabledCb.checked : true;
    const ocrEngine = ocrEngineSelect ? ocrEngineSelect.value : "nano";
    
    await chrome.storage.local.set({ provider, whisperEnabled, whisperModel, ocrEnabled, ocrEngine });
    
    await saveApiKey(key, syncCb ? syncCb.checked : false);
    if (savedEl) {
      savedEl.hidden = false;
      setTimeout(() => (savedEl.hidden = true), 1500);
    }
  });
}
