const apiKeyEl = document.getElementById("apiKey");
const savedEl = document.getElementById("saved");
const syncCb = document.getElementById("syncCb");
const revealCb = document.getElementById("revealCb");
const providerEl = document.getElementById("provider");
const keyLink = document.getElementById("keyLink");
const whisperCb = document.getElementById("whisperCb");
const ocrEngineEl = document.getElementById("ocrEngine");
const remoteScopeEl = document.getElementById("remoteScope");

const PROVIDER_URLS = {
  gemini: "https://aistudio.google.com/apikey",
  anthropic: "https://console.anthropic.com/settings/keys"
};

function updateLink() {
  keyLink.href = PROVIDER_URLS[providerEl.value];
}

providerEl.addEventListener("change", updateLink);

async function loadSettings() {
  let { apiKey, provider, whisperEnabled, ocrEngine, remoteScope } = await chrome.storage.local.get(["apiKey", "provider", "whisperEnabled", "ocrEngine", "remoteScope"]);
  ocrEngineEl.value = ocrEngine || "auto";
  remoteScopeEl.value = remoteScope || "summary";
  
  if (provider) {
    providerEl.value = provider;
  }
  
  whisperCb.checked = !!whisperEnabled;
  updateLink();

  if (apiKey) {
    apiKeyEl.value = apiKey;
    syncCb.checked = false;
    return;
  }
  const syncData = await chrome.storage.sync.get("apiKey");
  if (syncData.apiKey) {
    apiKeyEl.value = syncData.apiKey;
    syncCb.checked = true;
  }
}

loadSettings();

revealCb.addEventListener("change", () => {
  apiKeyEl.type = revealCb.checked ? "text" : "password";
});

remoteScopeEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ remoteScope: remoteScopeEl.value });
  savedEl.hidden = false;
  setTimeout(() => (savedEl.hidden = true), 1500);
});

ocrEngineEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ ocrEngine: ocrEngineEl.value });
  savedEl.hidden = false;
  setTimeout(() => (savedEl.hidden = true), 1500);
});

whisperCb.addEventListener("change", async () => {
  await chrome.storage.local.set({ whisperEnabled: whisperCb.checked });
  savedEl.hidden = false;
  setTimeout(() => (savedEl.hidden = true), 1500);
});

document.getElementById("saveBtn").addEventListener("click", async () => {
  const key = apiKeyEl.value.trim();
  const provider = providerEl.value;
  const whisperEnabled = whisperCb.checked;
  
  await chrome.storage.local.set({ provider, whisperEnabled, ocrEngine: ocrEngineEl.value, remoteScope: remoteScopeEl.value });
  
  if (syncCb.checked) {
    await chrome.storage.sync.set({ apiKey: key });
    await chrome.storage.local.remove("apiKey");
  } else {
    await chrome.storage.local.set({ apiKey: key });
    await chrome.storage.sync.remove("apiKey");
  }
  savedEl.hidden = false;
  setTimeout(() => (savedEl.hidden = true), 1500);
});
