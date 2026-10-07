const STORAGE_KEY = "keys:vault:v1";
let vaultEntries = [];
let activePin = "";

const lockScreen = document.getElementById("lock-screen");
const vaultScreen = document.getElementById("vault-screen");
const unlockForm = document.getElementById("unlock-form");
const unlockButton = document.getElementById("unlock-button");
const pinInput = document.getElementById("pin-input");
const vaultStatus = document.getElementById("vault-status");
const lockButton = document.getElementById("lock-button");
const entryForm = document.getElementById("entry-form");
const entriesBody = document.getElementById("entries-body");
const exportButton = document.getElementById("export-button");
const resetButton = document.getElementById("reset-button");

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(pin, saltBytes) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 200000,
      hash: "SHA-256",
    },
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

  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    cipherText: bytesToBase64(new Uint8Array(encrypted)),
  };
}

async function decryptEntries(pin, stored) {
  const salt = base64ToBytes(stored.salt);
  const iv = base64ToBytes(stored.iv);
  const cipherText = base64ToBytes(stored.cipherText);
  const key = await deriveKey(pin, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherText);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function setStatus(message, isError = false) {
  vaultStatus.textContent = message;
  vaultStatus.style.color = isError ? "#fca5a5" : "#9ca3af";
}

function hasVault() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return false;
  try {
    const parsed = JSON.parse(data);
    return Boolean(parsed && parsed.cipherText && parsed.iv && parsed.salt);
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function saveVault() {
  const encrypted = await encryptEntries(activePin, vaultEntries);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted));
}

function renderEntries() {
  if (!vaultEntries.length) {
    entriesBody.innerHTML = '<tr><td colspan="5" class="empty-row">No keys yet. Add your first secret.</td></tr>';
    return;
  }

  entriesBody.innerHTML = vaultEntries
    .map(
      (entry, index) => `
        <tr>
          <td>${escapeHtml(entry.system)}</td>
          <td>${escapeHtml(entry.service)}</td>
          <td>${escapeHtml(entry.name)}</td>
          <td class="secret-cell">${escapeHtml(entry.secret)}</td>
          <td><button class="action-btn" type="button" data-index="${index}">Delete</button></td>
        </tr>
      `
    )
    .join("");

  entriesBody.querySelectorAll(".action-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const index = Number(button.dataset.index);
      vaultEntries.splice(index, 1);
      await saveVault();
      renderEntries();
    });
  });
}

function showVault() {
  lockScreen.classList.add("hidden");
  vaultScreen.classList.remove("hidden");
  lockButton.classList.remove("hidden");
  pinInput.value = "";
}

function showLock() {
  lockScreen.classList.remove("hidden");
  vaultScreen.classList.add("hidden");
  lockButton.classList.add("hidden");
  pinInput.value = "";
}

async function unlockVault(pin) {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    activePin = pin;
    vaultEntries = [];
    await saveVault();
    setStatus("Vault created. Save your first key below.");
    showVault();
    return;
  }

  try {
    const parsed = JSON.parse(stored);
    vaultEntries = await decryptEntries(pin, parsed);
    activePin = pin;
    setStatus("Vault unlocked. Your keys are decrypted locally in the browser.");
    renderEntries();
    showVault();
  } catch (error) {
    console.error(error);
    setStatus("Incorrect PIN. Try again.", true);
    throw new Error("Incorrect PIN");
  }
}

unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = pinInput.value.trim();

  if (!pin || pin.length < 4) {
    setStatus("Use a PIN with at least 4 characters.", true);
    return;
  }

  unlockButton.disabled = true;
  try {
    await unlockVault(pin);
  } catch {
    // handled by the status message
  } finally {
    unlockButton.disabled = false;
  }
});

lockButton.addEventListener("click", () => {
  activePin = "";
  vaultEntries = [];
  showLock();
  setStatus("Vault locked. Enter your PIN to reopen it.");
});

entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const system = document.getElementById("system-input").value.trim();
  const service = document.getElementById("service-input").value.trim();
  const name = document.getElementById("name-input").value.trim();
  const secret = document.getElementById("secret-input").value.trim();

  if (!system || !service || !name || !secret) {
    return;
  }

  vaultEntries.push({ system, service, name, secret });
  document.getElementById("system-input").value = "";
  document.getElementById("service-input").value = "";
  document.getElementById("name-input").value = "";
  document.getElementById("secret-input").value = "";

  await saveVault();
  renderEntries();
});

exportButton.addEventListener("click", () => {
  if (!vaultEntries.length) {
    setStatus("Add at least one key before exporting.", true);
    return;
  }

  const rows = ["system,service,name,secret"];
  for (const entry of vaultEntries) {
    rows.push(
      [entry.system, entry.service, entry.name, entry.secret]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    );
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "keys.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setStatus("CSV export downloaded.");
});

resetButton.addEventListener("click", async () => {
  const shouldReset = window.confirm("Reset the vault and delete all saved keys?");
  if (!shouldReset) return;

  localStorage.removeItem(STORAGE_KEY);
  activePin = "";
  vaultEntries = [];
  setStatus("Vault reset. Create a new PIN to continue.");
  showLock();
});

function initialize() {
  if (hasVault()) {
    setStatus("Vault found. Enter your PIN to unlock it.");
  } else {
    setStatus("No vault exists yet. Create one with a PIN.");
  }
  renderEntries();
}

initialize();
