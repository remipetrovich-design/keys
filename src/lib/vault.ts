export type SystemId = "vercel" | "github" | "other";
export type ServiceId = "billing" | "licence" | "dev" | "custom";

export type KeyRecord = {
  id: string;
  systems: SystemId[];
  otherSystem: string;
  service: ServiceId;
  customService: string;
  keyName: string;
  secret: string;
};

const STORAGE_KEY = "keys.vault";
const MAGIC = "keys-v1";

type VaultFile = {
  salt: string;
  iv: string;
  cipher: string;
};

type Payload = {
  magic: typeof MAGIC;
  records: KeyRecord[];
};

let sessionKey: CryptoKey | null = null;

export function hasVault(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export function lockVault() {
  sessionKey = null;
}

export async function createVault(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pin, salt);
  await persist(key, salt, []);
  sessionKey = key;
}

export async function unlockVault(pin: string): Promise<KeyRecord[]> {
  const file = readFile();
  if (!file) throw new Error("No vault");
  const key = await deriveKey(pin, fromB64(file.salt));
  const records = await decrypt(key, file);
  sessionKey = key;
  return records;
}

export async function saveRecords(records: KeyRecord[]): Promise<void> {
  if (!sessionKey) throw new Error("Locked");
  const file = readFile();
  if (!file) throw new Error("No vault");
  await persist(sessionKey, fromB64(file.salt), records);
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 120_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function persist(key: CryptoKey, salt: Uint8Array, records: KeyRecord[]) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(
    JSON.stringify({ magic: MAGIC, records } satisfies Payload),
  );
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload),
  );
  const file: VaultFile = {
    salt: toB64(salt),
    iv: toB64(iv),
    cipher: toB64(cipher),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
}

async function decrypt(key: CryptoKey, file: VaultFile): Promise<KeyRecord[]> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(file.iv) as BufferSource },
    key,
    fromB64(file.cipher) as BufferSource,
  );
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as Payload;
  if (parsed.magic !== MAGIC || !Array.isArray(parsed.records)) {
    throw new Error("Bad vault");
  }
  return parsed.records;
}

function readFile(): VaultFile | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as VaultFile;
  if (!parsed.salt || !parsed.iv || !parsed.cipher) throw new Error("Bad vault");
  return parsed;
}

function toB64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromB64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
