const apiKeyEl = document.getElementById("apiKey");
const savedEl = document.getElementById("saved");

chrome.storage.local.get("apiKey").then(({ apiKey }) => {
  if (apiKey) apiKeyEl.value = apiKey;
});

document.getElementById("saveBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({ apiKey: apiKeyEl.value.trim() });
  savedEl.hidden = false;
  setTimeout(() => (savedEl.hidden = true), 1500);
});
