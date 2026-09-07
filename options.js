const apiKeyEl = document.getElementById("apiKey");
const savedEl = document.getElementById("saved");
const syncCb = document.getElementById("syncCb");
const revealCb = document.getElementById("revealCb");
const providerEl = document.getElementById("provider");
const keyLink = document.getElementById("keyLink");
const whisperCb = document.getElementById("whisperCb");

const PROVIDER_URLS = {
  gemini: "https://aistudio.google.com/apikey",
  anthropic: "https://console.anthropic.com/settings/keys"
};

function updateLink() {
  keyLink.href = PROVIDER_URLS[providerEl.value];
}

providerEl.addEventListener("change", updateLink);

async function loadSettings() {
  let { apiKey, provider, whisperEnabled } = await chrome.storage.local.get(["apiKey", "provider", "whisperEnabled"]);
  
  if (provider) {
    providerEl.value = provider;
  }
  if (whisperEnabled) {
    whisperCb.checked = true;
  }
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

document.getElementById("saveBtn").addEventListener("click", async () => {
  const key = apiKeyEl.value.trim();
  const provider = providerEl.value;
  const whisperEnabled = whisperCb.checked;
  
  await chrome.storage.local.set({ provider, whisperEnabled });
  
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
