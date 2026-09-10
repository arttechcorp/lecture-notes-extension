const apiKeyEl = document.getElementById("apiKey");
const savedEl = document.getElementById("saved");
const syncCb = document.getElementById("syncCb");
const revealCb = document.getElementById("revealCb");
const providerEl = document.getElementById("provider");
const keyLink = document.getElementById("keyLink");
const whisperCb = document.getElementById("whisperCb");
const whisperModelEl = document.getElementById("whisperModel");
const ocrEnabledCb = document.getElementById("ocrEnabledCb");

const PROVIDER_URLS = {
  gemini: "https://aistudio.google.com/apikey",
  anthropic: "https://console.anthropic.com/settings/keys"
};

function updateLink() {
  keyLink.href = PROVIDER_URLS[providerEl.value];
}

providerEl.addEventListener("change", updateLink);

async function populateSettings() {
  const { apiKey, provider, whisperEnabled, whisperModel, syncKey, ocrEnabled } = await loadSettings();
  
  whisperModelEl.value = whisperModel || "tiny";
  
  if (provider) {
    providerEl.value = provider;
  }
  
  whisperCb.checked = !!whisperEnabled;
  if (ocrEnabledCb) {
    ocrEnabledCb.checked = ocrEnabled !== false;
  }
  updateLink();

  apiKeyEl.value = apiKey || "";
  syncCb.checked = !!syncKey;
}

populateSettings();

revealCb.addEventListener("change", () => {
  apiKeyEl.type = revealCb.checked ? "text" : "password";
});

whisperCb.addEventListener("change", async () => {
  await chrome.storage.local.set({ whisperEnabled: whisperCb.checked });
  savedEl.hidden = false;
  setTimeout(() => (savedEl.hidden = true), 1500);
});

whisperModelEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ whisperModel: whisperModelEl.value });
  savedEl.hidden = false;
  setTimeout(() => (savedEl.hidden = true), 1500);
});

if (ocrEnabledCb) {
  ocrEnabledCb.addEventListener("change", async () => {
    await chrome.storage.local.set({ ocrEnabled: ocrEnabledCb.checked });
    savedEl.hidden = false;
    setTimeout(() => (savedEl.hidden = true), 1500);
  });
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  const key = apiKeyEl.value.trim();
  const provider = providerEl.value;
  const whisperEnabled = whisperCb.checked;
  const whisperModel = whisperModelEl.value;
  const ocrEnabled = ocrEnabledCb ? ocrEnabledCb.checked : true;
  
  await chrome.storage.local.set({ provider, whisperEnabled, whisperModel, ocrEnabled });
  
  await saveApiKey(key, syncCb.checked);
  savedEl.hidden = false;
  setTimeout(() => (savedEl.hidden = true), 1500);
});
