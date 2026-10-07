const STORAGE_KEY = "keys:vault:v1";
let vaultEntries = [];
let activePin = "";
let editingIndex = null;
let searchTerm = "";

const $ = (id) => document.getElementById(id);
const lockScreen = $("lock-screen");
const vaultScreen = $("vault-screen");
const unlockForm = $("unlock-form");
const unlockButton = $("unlock-button");
const pinInput = $("pin-input");
const vaultStatus = $("vault-status");
const lockButton = $("lock-button");
const entryForm = $("entry-form");
const entriesBody = $("entries-body");
const exportButton = $("export-button");
const backupButton = $("backup-button");
const restoreButton = $("restore-button");
const restoreInput = $("restore-input");
const resetButton = $("reset-button");
const searchInput = $("search-input");
const saveEntryButton = $("save-entry-button");
const cancelEditButton = $("cancel-edit-button");

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function deriveKey(pin, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: 200000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptEntries(pin, entries) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const payload = new TextEncoder().encode(JSON.stringify(entries));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload);
  return { salt: bytesToBase64(salt), iv: bytesToBase64(iv), cipherText: bytesToBase64(new Uint8Array(encrypted)) };
}
async function decryptEntries(pin, stored) {
  const key = await deriveKey(pin, base64ToBytes(stored.salt));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(stored.iv) },
    key,
    base64ToBytes(stored.cipherText)
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}
function setStatus(message, isError = false) {
  vaultStatus.textContent = message;
  vaultStatus.classList.toggle("error", isError);
}
function getStoredVault() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return parsed && parsed.cipherText && parsed.iv && parsed.salt ? parsed : null;
  } catch { return null; }
}
function hasVault() { return Boolean(getStoredVault()); }
function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
async function saveVault() {
  if (!activePin) throw new Error("Vault is locked");
  localStorage.setItem(STORAGE_KEY, JSON.stringify(await encryptEntries(activePin, vaultEntries)));
}
function filteredEntries() {
  const q = searchTerm.toLowerCase();
  return vaultEntries.map((entry, index) => ({ entry, index })).filter(({ entry }) =>
    !q || [entry.system, entry.service, entry.name].some((value) => String(value).toLowerCase().includes(q))
  );
}
function renderEntries() {
  const rows = filteredEntries();
  if (!rows.length) {
    entriesBody.innerHTML = '<tr><td colspan="5" class="empty-row">' + (vaultEntries.length ? "No matching keys." : "No keys yet. Add your first secret.") + "</td></tr>";
    return;
  }
  entriesBody.innerHTML = rows.map(({ entry, index }) => `
    <tr>
      <td>${escapeHtml(entry.system)}</td>
      <td>${escapeHtml(entry.service)}</td>
      <td>${escapeHtml(entry.name)}</td>
      <td class="secret-cell"><span class="secret-value" data-secret="${escapeHtml(entry.secret)}">••••••••••••</span></td>
      <td class="row-actions">
        <button class="mini-btn reveal-btn" type="button" data-index="${index}">Reveal</button>
        <button class="mini-btn copy-btn" type="button" data-index="${index}">Copy</button>
        <button class="mini-btn edit-btn" type="button" data-index="${index}">Edit</button>
        <button class="action-btn delete-btn" type="button" data-index="${index}">Delete</button>
      </td>
    </tr>`).join("");

  entriesBody.querySelectorAll(".reveal-btn").forEach((button) => button.addEventListener("click", () => {
    const secret = vaultEntries[Number(button.dataset.index)].secret;
    const span = button.closest("tr").querySelector(".secret-value");
    const revealing = button.textContent === "Reveal";
    span.textContent = revealing ? secret : "••••••••••••";
    button.textContent = revealing ? "Hide" : "Reveal";
  }));
  entriesBody.querySelectorAll(".copy-btn").forEach((button) => button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(vaultEntries[Number(button.dataset.index)].secret);
      setStatus("Secret copied to clipboard.");
    } catch {
      setStatus("Clipboard access was blocked by this browser.", true);
    }
  }));
  entriesBody.querySelectorAll(".edit-btn").forEach((button) => button.addEventListener("click", () => startEdit(Number(button.dataset.index))));
  entriesBody.querySelectorAll(".delete-btn").forEach((button) => button.addEventListener("click", async () => {
    const index = Number(button.dataset.index);
    if (!window.confirm("Delete this key?")) return;
    vaultEntries.splice(index, 1);
    await saveVault();
    cancelEdit();
    renderEntries();
    setStatus("Key deleted.");
  }));
}
function showVault() {
  lockScreen.classList.add("hidden");
  vaultScreen.classList.remove("hidden");
  lockButton.classList.remove("hidden");
  pinInput.value = "";
  renderEntries();
}
function showLock() {
  lockScreen.classList.remove("hidden");
  vaultScreen.classList.add("hidden");
  lockButton.classList.add("hidden");
  pinInput.value = "";
}
function clearEntryForm() {
  ["system-input", "service-input", "name-input", "secret-input"].forEach((id) => $(id).value = "");
}
function startEdit(index) {
  const entry = vaultEntries[index];
  editingIndex = index;
  $("system-input").value = entry.system;
  $("service-input").value = entry.service;
  $("name-input").value = entry.name;
  $("secret-input").value = entry.secret;
  saveEntryButton.textContent = "Save changes";
  cancelEditButton.classList.remove("hidden");
  $("system-input").focus();
}
function cancelEdit() {
  editingIndex = null;
  clearEntryForm();
  saveEntryButton.textContent = "Add key";
  cancelEditButton.classList.add("hidden");
}
async function unlockVault(pin) {
  const stored = getStoredVault();
  if (!stored) {
    activePin = pin;
    vaultEntries = [];
    await saveVault();
    setStatus("Vault created. Save your first key below.");
    showVault();
    return;
  }
  try {
    vaultEntries = await decryptEntries(pin, stored);
    if (!Array.isArray(vaultEntries)) throw new Error("Invalid vault");
    activePin = pin;
    setStatus("Vault unlocked. Secrets stay encrypted while stored.");
    showVault();
  } catch (error) {
    console.error(error);
    setStatus("Incorrect PIN or unreadable vault.", true);
    throw error;
  }
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = pinInput.value.trim();
  if (pin.length < 4) return setStatus("Use a PIN with at least 4 characters.", true);
  unlockButton.disabled = true;
  try { await unlockVault(pin); } catch {} finally { unlockButton.disabled = false; }
});
lockButton.addEventListener("click", () => {
  activePin = "";
  vaultEntries = [];
  editingIndex = null;
  showLock();
  setStatus("Vault locked. Enter your PIN to reopen it.");
});
entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const entry = {
    system: $("system-input").value.trim(),
    service: $("service-input").value.trim(),
    name: $("name-input").value.trim(),
    secret: $("secret-input").value.trim()
  };
  if (Object.values(entry).some((value) => !value)) return setStatus("Complete all key fields.", true);
  if (editingIndex === null) vaultEntries.push(entry);
  else vaultEntries[editingIndex] = entry;
  await saveVault();
  const wasEditing = editingIndex !== null;
  cancelEdit();
  renderEntries();
  setStatus(wasEditing ? "Key updated." : "Key saved.");
});
cancelEditButton.addEventListener("click", cancelEdit);
searchInput.addEventListener("input", () => { searchTerm = searchInput.value.trim(); renderEntries(); });
backupButton.addEventListener("click", () => {
  const stored = getStoredVault();
  if (!stored) return setStatus("No encrypted vault is available to back up.", true);
  download("keys-encrypted-backup.json", JSON.stringify({ format: "keys-vault-backup", version: 1, vault: stored }, null, 2), "application/json");
  setStatus("Encrypted backup downloaded.");
});
restoreButton.addEventListener("click", () => restoreInput.click());
restoreInput.addEventListener("change", async () => {
  const file = restoreInput.files && restoreInput.files[0];
  restoreInput.value = "";
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    const vault = backup && backup.format === "keys-vault-backup" ? backup.vault : backup;
    if (!vault || !vault.salt || !vault.iv || !vault.cipherText) throw new Error("Invalid backup");
    if (!window.confirm("Replace the vault stored in this browser with this encrypted backup?")) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
    activePin = "";
    vaultEntries = [];
    showLock();
    setStatus("Backup restored. Enter its PIN to unlock.");
  } catch {
    setStatus("That file is not a valid Keys encrypted backup.", true);
  }
});
exportButton.addEventListener("click", () => {
  if (!vaultEntries.length) return setStatus("Add at least one key before exporting.", true);
  if (!window.confirm("CSV export contains your secrets in plain text. Continue?")) return;
  const rows = ["system,service,name,secret"];
  for (const entry of vaultEntries) rows.push([entry.system, entry.service, entry.name, entry.secret].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  download("keys.csv", rows.join("\n"), "text/csv;charset=utf-8");
  setStatus("Plain-text CSV export downloaded.");
});
resetButton.addEventListener("click", () => {
  if (!window.confirm("Reset the vault and permanently delete all saved keys from this browser?")) return;
  localStorage.removeItem(STORAGE_KEY);
  activePin = "";
  vaultEntries = [];
  cancelEdit();
  showLock();
  setStatus("Vault reset. Create a new PIN to continue.");
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && activePin) {
    activePin = "";
    vaultEntries = [];
    showLock();
    setStatus("Vault auto-locked when the page was hidden.");
  }
});
function initialize() {
  setStatus(hasVault() ? "Vault found. Enter your PIN to unlock it." : "No vault exists yet. Create one with a PIN.");
  unlockButton.textContent = hasVault() ? "Unlock vault" : "Create vault";
  renderEntries();
}
initialize();
