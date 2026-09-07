const apiKeyEl = document.getElementById("apiKey");
const savedEl = document.getElementById("saved");
const syncCb = document.getElementById("syncCb");
const revealCb = document.getElementById("revealCb");

async function loadKey() {
  let { apiKey } = await chrome.storage.local.get("apiKey");
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

loadKey();

revealCb.addEventListener("change", () => {
  apiKeyEl.type = revealCb.checked ? "text" : "password";
});

document.getElementById("saveBtn").addEventListener("click", async () => {
  const key = apiKeyEl.value.trim();
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
