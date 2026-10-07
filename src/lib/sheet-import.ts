import * as XLSX from "xlsx";
import type { KeyRecord, ServiceId, SystemId } from "@/lib/vault";

export type SheetDraft = Omit<KeyRecord, "id">;

export type SheetParse = {
  records: SheetDraft[];
  skipped: number;
};

const MAX_ROWS = 500;

export async function parseSheetFile(file: File): Promise<SheetParse> {
  const buffer = await file.arrayBuffer();
  const book = XLSX.read(buffer, { type: "array" });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return { records: [], skipped: 0 };
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];
  return recordsFromRows(rows.map((row) => row.map((cell) => String(cell ?? ""))));
}

export function parseSheetText(text: string): SheetParse {
  const trimmed = text.trim();
  if (!trimmed) return { records: [], skipped: 0 };
  return recordsFromRows(parseDelimited(trimmed, detectDelimiter(trimmed)));
}

function recordsFromRows(rows: string[][]): SheetParse {
  const filled = rows
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell !== ""))
    .slice(0, MAX_ROWS);
  if (filled.length === 0) return { records: [], skipped: 0 };

  const header = headerMap(filled[0]);
  const body = header ? filled.slice(1) : filled;
  const records: SheetDraft[] = [];
  let skipped = 0;

  for (const row of body) {
    const systemRaw = header ? cell(row, header.system) : (row[0] ?? "");
    const serviceRaw = header ? cell(row, header.service) : (row[1] ?? "");
    const keyName = (header ? cell(row, header.keyName) : (row[2] ?? "")).trim();
    const secret = header ? cell(row, header.secret) : (row[3] ?? "");
    if (!keyName || secret.trim() === "") {
      skipped += 1;
      continue;
    }
    const systems = parseSystems(systemRaw);
    const service = parseService(serviceRaw);
    records.push({
      systems: systems.systems,
      otherSystem: systems.otherSystem,
      service: service.service,
      customService: service.customService,
      keyName,
      secret,
    });
  }

  return { records, skipped };
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return row[index] ?? "";
}

function headerMap(row: string[]): { system?: number; service?: number; keyName?: number; secret?: number } | null {
  const names = row.map((value) => value.trim().toLowerCase().replace(/[_-]+/g, " "));
  const find = (aliases: string[]) => names.findIndex((name) => aliases.includes(name));
  const system = find(["system", "systems", "main system", "platform", "provider"]);
  const service = find(["service", "type", "kind", "category"]);
  const keyName = find(["key name", "key", "name", "variable", "env", "keyname"]);
  const secret = find(["secret", "value", "token", "password", "credential", "key value"]);
  if (keyName === -1 || secret === -1) return null;
  return {
    system: system === -1 ? undefined : system,
    service: service === -1 ? undefined : service,
    keyName,
    secret,
  };
}

function parseSystems(raw: string): { systems: SystemId[]; otherSystem: string } {
  const parts = raw
    .split(/[,;/|]+|\band\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const systems = new Set<SystemId>();
  const others: string[] = [];
  for (const part of parts) {
    const name = part.toLowerCase();
    if (name === "vercel") systems.add("vercel");
    else if (name === "github" || name === "gh") systems.add("github");
    else if (name === "other") systems.add("other");
    else {
      systems.add("other");
      others.push(part);
    }
  }
  if (systems.size === 0) {
    systems.add("other");
    others.push("Sheet");
  }
  return { systems: [...systems], otherSystem: others.join(", ") };
}

function parseService(raw: string): { service: ServiceId; customService: string } {
  const name = raw.trim().toLowerCase();
  if (name === "billing" || name === "bill") return { service: "billing", customService: "" };
  if (name === "licence" || name === "license" || name === "licensing") {
    return { service: "licence", customService: "" };
  }
  if (name === "dev" || name === "development" || name === "developer") {
    return { service: "dev", customService: "" };
  }
  if (!raw.trim() || name === "custom") {
    return { service: "custom", customService: name === "custom" ? "" : raw.trim() };
  }
  return { service: "custom", customService: raw.trim() };
}

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  if (first.includes("\t")) return "\t";
  const commas = (first.match(/,/g) ?? []).length;
  const semis = (first.match(/;/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
