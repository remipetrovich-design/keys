import { useState } from "react";
import { parseSheetFile, parseSheetText, type SheetDraft } from "@/lib/sheet-import";

export function ImportSheet({ onImport }: { onImport: (records: SheetDraft[]) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [records, setRecords] = useState<SheetDraft[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function show(next: SheetDraft[], skippedRows: number) {
    if (next.length === 0) {
      setRecords(null);
      setSkipped(skippedRows);
      setError("No keys found. Use columns for system, service, key name, and secret.");
      return;
    }
    setRecords(next);
    setSkipped(skippedRows);
    setError("");
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const parsed = await parseSheetFile(file);
      show(parsed.records, parsed.skipped);
    } catch {
      setRecords(null);
      setError("Couldn't read that file.");
    }
  }

  function onPaste() {
    const parsed = parseSheetText(paste);
    show(parsed.records, parsed.skipped);
  }

  async function commit() {
    if (!records || records.length === 0) return;
    setBusy(true);
    setError("");
    try {
      await onImport(records);
      setRecords(null);
      setPaste("");
      setSkipped(0);
      setOpen(false);
    } catch {
      setError("Couldn't save the import. Unlock again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-control border border-line px-4 text-sm font-medium text-fg"
      >
        Import sheet
      </button>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted">Import sheet</p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setRecords(null);
            setError("");
          }}
          className="min-h-11 rounded-control px-3 text-sm font-medium text-subtle"
        >
          Close
        </button>
      </div>
      <p className="mt-2 text-sm text-subtle">
        Excel, CSV, or cells copied from Google Sheets. Columns: system, service, key name, secret.
      </p>
      <label className="mt-4 flex min-h-11 cursor-pointer items-center justify-center rounded-control border border-line text-sm font-medium text-fg">
        Choose file
        <input
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            void onFile(file);
            event.target.value = "";
          }}
        />
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-muted">Or paste</span>
        <textarea
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          rows={4}
          className="w-full rounded-control border border-line bg-bg px-3 py-2 font-mono text-sm text-fg outline-none focus-visible:border-accent"
          spellCheck={false}
        />
      </label>
      <button
        type="button"
        onClick={onPaste}
        disabled={paste.trim() === ""}
        className="mt-3 min-h-11 rounded-control border border-line px-4 text-sm font-medium text-fg disabled:opacity-40"
      >
        Read paste
      </button>
      {records ? (
        <div className="mt-4">
          <p className="text-sm text-muted">
            {records.length === 1 ? "1 key ready" : `${records.length} keys ready`}
            {skipped > 0 ? ` · ${skipped} skipped` : ""}
          </p>
          <ul className="mt-2 space-y-1">
            {records.slice(0, 6).map((record, index) => (
              <li key={`${record.keyName}-${index}`} className="truncate font-mono text-sm">
                {record.keyName}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void commit()}
            disabled={busy}
            className="mt-4 min-h-11 w-full rounded-control bg-accent text-sm font-medium text-accent-fg disabled:opacity-60"
          >
            {busy ? "Saving…" : "Add to vault"}
          </button>
        </div>
      ) : null}
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
