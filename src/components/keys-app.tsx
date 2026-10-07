import { useEffect, useId, useRef, useState } from "react";
import { Github, Hexagon, Triangle } from "lucide-react";
import { ImportSheet } from "@/components/import-sheet";
import type { SheetDraft } from "@/lib/sheet-import";
import {
  createVault,
  hasVault,
  lockVault,
  saveRecords,
  unlockVault,
  type KeyRecord,
  type ServiceId,
  type SystemId,
} from "@/lib/vault";

const SYSTEMS: { id: SystemId; label: string }[] = [
  { id: "vercel", label: "Vercel" },
  { id: "github", label: "GitHub" },
  { id: "other", label: "Other" },
];

const SERVICES: { id: ServiceId; label: string }[] = [
  { id: "billing", label: "Billing" },
  { id: "licence", label: "Licence" },
  { id: "dev", label: "Dev" },
  { id: "custom", label: "Custom" },
];

type Draft = {
  id: string | null;
  systems: SystemId[];
  otherSystem: string;
  service: ServiceId | null;
  customService: string;
  keyName: string;
  secret: string;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  systems: [],
  otherSystem: "",
  service: null,
  customService: "",
  keyName: "",
  secret: "",
};

type Phase = "setup" | "locked" | "open";

export function KeysApp() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [records, setRecords] = useState<KeyRecord[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);
  const armTimer = useRef<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setPhase(hasVault() ? "locked" : "setup");
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    };
  }, []);

  async function onPinSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPinError("");
    if (!/^\d{4,8}$/.test(pin)) {
      setPinError("Use 4 to 8 digits.");
      return;
    }
    if (phase === "setup" && pin !== confirmPin) {
      setPinError("PINs don't match.");
      return;
    }
    setPinBusy(true);
    try {
      if (phase === "setup") {
        await createVault(pin);
        setRecords([]);
      } else {
        const next = await unlockVault(pin);
        setRecords(next);
      }
      setPin("");
      setConfirmPin("");
      setPhase("open");
    } catch {
      setPinError(phase === "setup" ? "Couldn't create the vault." : "Wrong PIN.");
    } finally {
      setPinBusy(false);
    }
  }

  function lock() {
    lockVault();
    setRecords([]);
    setDraft(EMPTY_DRAFT);
    setFormError("");
    setPin("");
    setConfirmPin("");
    setCopyingId(null);
    setCopiedId(null);
    setRemoveId(null);
    setPhase("locked");
  }

  async function onImport(incoming: SheetDraft[]) {
    const next = [
      ...incoming.map((record) => ({ ...record, id: crypto.randomUUID() })),
      ...records,
    ];
    await saveRecords(next);
    setRecords(next);
    setRemoveId(null);
  }

  function validate(next: Draft): string {
    if (next.systems.length === 0) return "Pick at least one system.";
    if (next.systems.includes("other") && next.otherSystem.trim() === "") {
      return "Name the other system.";
    }
    if (!next.service) return "Pick a service.";
    if (next.service === "custom" && next.customService.trim() === "") {
      return "Name the custom service.";
    }
    if (next.keyName.trim() === "") return "Add a key name.";
    if (next.secret.trim() === "") return "Add the secret.";
    return "";
  }

  async function onSave(event: React.FormEvent) {
    event.preventDefault();
    const error = validate(draft);
    setFormError(error);
    if (error) return;
    const record: KeyRecord = {
      id: draft.id ?? crypto.randomUUID(),
      systems: draft.systems,
      otherSystem: draft.otherSystem.trim(),
      service: draft.service as ServiceId,
      customService: draft.customService.trim(),
      keyName: draft.keyName.trim(),
      secret: draft.secret,
    };
    const next = draft.id
      ? records.map((item) => (item.id === record.id ? record : item))
      : [record, ...records];
    try {
      await saveRecords(next);
    } catch {
      setFormError("Couldn't save. Unlock again.");
      return;
    }
    setRecords(next);
    setDraft(EMPTY_DRAFT);
    setFormError("");
    setRemoveId(null);
  }

  function edit(record: KeyRecord) {
    setDraft({
      id: record.id,
      systems: record.systems,
      otherSystem: record.otherSystem,
      service: record.service,
      customService: record.customService,
      keyName: record.keyName,
      secret: record.secret,
    });
    setFormError("");
    setRemoveId(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function remove(id: string) {
    if (removeId !== id) {
      setRemoveId(id);
      return;
    }
    const next = records.filter((item) => item.id !== id);
    try {
      await saveRecords(next);
    } catch {
      setFormError("Couldn't save. Unlock again.");
      return;
    }
    setRecords(next);
    setRemoveId(null);
    if (draft.id === id) setDraft(EMPTY_DRAFT);
  }

  function armCopy(id: string) {
    setCopyingId(id);
    if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    armTimer.current = window.setTimeout(() => {
      setCopyingId((current) => (current === id ? null : current));
    }, 4000);
  }

  async function copySecret(id: string, secret: string) {
    setCopyingId(id);
    if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    try {
      await navigator.clipboard.writeText(secret);
    } catch {
      const field = document.createElement("textarea");
      field.value = secret;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopiedId(id);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => {
      setCopiedId(null);
      setCopyingId(null);
    }, 900);
  }

  const groups = groupBySystem(records);

  if (phase !== "open") {
    return (
      <PinGate
        phase={phase}
        pin={pin}
        confirmPin={confirmPin}
        error={pinError}
        busy={pinBusy}
        onPin={setPin}
        onConfirm={setConfirmPin}
        onSubmit={onPinSubmit}
      />
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-16">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-bg py-5">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-control bg-accent text-sm font-medium text-accent-fg">
            K
          </span>
          <div>
            <h1 className="text-xl font-medium tracking-tight">Keys</h1>
            <p className="text-sm text-muted tabular-nums">
              {records.length === 0 ? "Nothing saved" : `${records.length} saved`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={lock}
          className="min-h-11 rounded-control border border-line px-4 text-sm font-medium text-fg"
        >
          Lock
        </button>
      </header>

      <div className="mb-4">
        <ImportSheet onImport={onImport} />
      </div>

      <form ref={formRef} onSubmit={onSave} className="rounded-card border border-line bg-surface p-5">
        <p className="mb-4 text-sm font-medium text-muted">{draft.id ? "Edit key" : "New key"}</p>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-muted">System</legend>
          <div className="flex flex-wrap gap-2">
            {SYSTEMS.map((system) => {
              const pressed = draft.systems.includes(system.id);
              return (
                <button
                  key={system.id}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      systems: pressed
                        ? current.systems.filter((id) => id !== system.id)
                        : [...current.systems, system.id],
                    }))
                  }
                  className={chipClass(pressed)}
                >
                  {system.label}
                </button>
              );
            })}
          </div>
          {draft.systems.includes("other") ? (
            <label className="mt-3 block">
              <span className="mb-2 block text-sm font-medium text-muted">Other system</span>
              <input
                value={draft.otherSystem}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, otherSystem: event.target.value }))
                }
                className={fieldClass}
                autoComplete="off"
              />
            </label>
          ) : null}
        </fieldset>

        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-medium text-muted">Service</legend>
          <div role="radiogroup" aria-label="Service" className="flex flex-wrap gap-2">
            {SERVICES.map((service) => {
              const pressed = draft.service === service.id;
              return (
                <button
                  key={service.id}
                  type="button"
                  role="radio"
                  aria-checked={pressed}
                  onClick={() => setDraft((current) => ({ ...current, service: service.id }))}
                  className={chipClass(pressed)}
                >
                  {service.label}
                </button>
              );
            })}
          </div>
          {draft.service === "custom" ? (
            <label className="mt-3 block">
              <span className="mb-2 block text-sm font-medium text-muted">Custom service</span>
              <input
                value={draft.customService}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, customService: event.target.value }))
                }
                className={fieldClass}
                autoComplete="off"
              />
            </label>
          ) : null}
        </fieldset>

        <label className="mt-5 block">
          <span className="mb-2 block text-sm font-medium text-muted">Key name</span>
          <input
            value={draft.keyName}
            onChange={(event) => setDraft((current) => ({ ...current, keyName: event.target.value }))}
            className={fieldClass}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <div className="mt-5">
          <label htmlFor="secret-field" className="mb-2 block text-sm font-medium text-muted">
            Secret
          </label>
          <div
            className="secret-line relative"
            data-copying={copyingId === "draft" ? "true" : "false"}
          >
            <input
              id="secret-field"
              value={draft.secret}
              onChange={(event) =>
                setDraft((current) => ({ ...current, secret: event.target.value }))
              }
              className={`${fieldClass} min-h-14 pr-24 font-mono`}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
            />
            {draft.secret ? (
              <button
                type="button"
                className="copy-slot absolute top-1 right-1 bottom-1 min-h-11 rounded-control bg-accent px-3 text-sm font-medium text-accent-fg"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => copySecret("draft", draft.secret)}
              >
                {copiedId === "draft" ? "Copied" : "Copy"}
              </button>
            ) : null}
          </div>
        </div>

        {formError ? <p className="mt-4 text-sm text-danger">{formError}</p> : null}

        <div className="mt-5 flex gap-2">
          <button
            type="submit"
            className="min-h-11 flex-1 rounded-control bg-accent text-sm font-medium text-accent-fg"
          >
            {draft.id ? "Save key" : "Add key"}
          </button>
          {draft.id ? (
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setFormError("");
              }}
              className="min-h-11 rounded-control border border-line px-4 text-sm font-medium text-fg"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      <section className="mt-8">
        {records.length === 0 ? (
          <div className="rounded-card border border-dashed border-line px-5 py-10 text-center">
            <p className="text-sm text-muted">Saved keys show up here, grouped by system.</p>
          </div>
        ) : (
          <div className={"grid gap-4 " + (groups.length > 1 ? "sm:grid-cols-2" : "")}>
            {groups.map((group, index) => (
              <section
                key={group.id}
                className="group-card overflow-hidden rounded-card border border-line bg-surface"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <header className="flex items-center justify-between gap-3 bg-accent px-5 py-4 text-accent-fg">
                  <div className="flex min-w-0 items-center gap-3">
                    <SystemMark group={group} />
                    <h2 className="truncate text-lg font-medium tracking-tight">{group.label}</h2>
                  </div>
                  <p className="shrink-0 text-sm tabular-nums">
                    {group.records.length === 1 ? "1 key" : `${group.records.length} keys`}
                  </p>
                </header>
                <ul>
                  {group.records.map((record) => {
                    const also = alsoOn(record, group);
                    return (
                      <li key={record.id} className="border-b border-line px-5 py-4 last:border-b-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-mono text-sm font-medium break-all">{record.keyName}</p>
                          <span className="rounded-full border border-line bg-bg px-2 py-1 text-xs font-medium text-muted">
                            {serviceLabel(record)}
                          </span>
                        </div>
                        {also ? <p className="mt-1 text-sm text-subtle">Also on {also}</p> : null}
                        <div
                          className="secret-line relative mt-3 rounded-control border border-line bg-bg px-3 py-3"
                          data-copying={copyingId === record.id ? "true" : "false"}
                        >
                          <button
                            type="button"
                            onClick={() => armCopy(record.id)}
                            className="w-full border-0 bg-transparent py-0 pr-16 pl-0 text-left font-mono text-sm break-all text-fg"
                          >
                            {record.secret}
                          </button>
                          <button
                            type="button"
                            className="copy-slot absolute top-2 right-2 min-h-11 rounded-control bg-accent px-3 text-sm font-medium text-accent-fg"
                            onClick={() => copySecret(record.id, record.secret)}
                          >
                            {copiedId === record.id ? "Copied" : "Copy"}
                          </button>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => edit(record)}
                            className="min-h-11 rounded-control px-3 text-sm font-medium text-muted"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(record.id)}
                            className={`min-h-11 rounded-control px-3 text-sm font-medium ${
                              removeId === record.id ? "text-danger" : "text-subtle"
                            }`}
                          >
                            {removeId === record.id ? "Confirm remove" : "Remove"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function PinGate({
  phase,
  pin,
  confirmPin,
  error,
  busy,
  onPin,
  onConfirm,
  onSubmit,
}: {
  phase: Phase;
  pin: string;
  confirmPin: string;
  error: string;
  busy: boolean;
  onPin: (value: string) => void;
  onConfirm: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const pinId = useId();
  const confirmId = useId();
  const setup = phase === "setup";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-10">
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-control bg-accent text-lg font-medium text-accent-fg">
          K
        </span>
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Keys</h1>
          <p className="text-sm text-muted">
            {setup ? "Set a PIN. This list stays on this browser." : "Enter your PIN."}
          </p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="mt-6 rounded-card border border-line bg-surface p-5">
          <label htmlFor={pinId} className="mb-2 block text-sm font-medium text-muted">
            PIN
          </label>
          <input
            id={pinId}
            value={pin}
            onChange={(event) => onPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            autoComplete="off"
            type="password"
            className={fieldClass}
          />
          {setup ? (
            <>
              <label htmlFor={confirmId} className="mt-4 mb-2 block text-sm font-medium text-muted">
                Confirm PIN
              </label>
              <input
                id={confirmId}
                value={confirmPin}
                onChange={(event) => onConfirm(event.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                autoComplete="off"
                type="password"
                className={fieldClass}
              />
            </>
          ) : null}
          {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="mt-5 min-h-11 w-full rounded-control bg-accent text-sm font-medium text-accent-fg disabled:opacity-60"
          >
            {busy ? "Checking…" : setup ? "Set PIN" : "Unlock"}
          </button>
          {setup ? (
            <p className="mt-4 text-sm text-subtle">A forgotten PIN cannot be recovered.</p>
          ) : null}
        </form>
    </main>
  );
}

function SystemMark({ group }: { group: SystemGroup }) {
  const className = "size-5";
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-fg text-accent">
      {group.id === "vercel" ? (
        <Triangle className={className} strokeWidth={1.75} aria-hidden />
      ) : group.id === "github" ? (
        <Github className={className} strokeWidth={1.75} aria-hidden />
      ) : group.mark.length === 1 ? (
        <span className="text-sm font-medium">{group.mark}</span>
      ) : (
        <Hexagon className={className} strokeWidth={1.75} aria-hidden />
      )}
    </span>
  );
}

function groupBySystem(records: KeyRecord[]): SystemGroup[] {
  const map = new Map<string, SystemGroup>();
  function ensure(id: string, label: string, mark: string) {
    let group = map.get(id);
    if (!group) {
      group = { id, label, mark, records: [] };
      map.set(id, group);
    }
    return group;
  }
  for (const record of records) {
    for (const system of record.systems) {
      if (system === "vercel") ensure("vercel", "Vercel", "V").records.push(record);
      else if (system === "github") ensure("github", "GitHub", "G").records.push(record);
      else {
        const name = record.otherSystem.trim() || "Other";
        ensure(`other:${name.toLowerCase()}`, name, name.slice(0, 1).toUpperCase()).records.push(record);
      }
    }
  }
  return [...map.values()].sort((a, b) => {
    const rank = (id: string) => (id === "vercel" ? 0 : id === "github" ? 1 : 2);
    const diff = rank(a.id) - rank(b.id);
    return diff !== 0 ? diff : a.label.localeCompare(b.label);
  });
}

function alsoOn(record: KeyRecord, group: SystemGroup): string {
  return record.systems
    .flatMap((system) => {
      if (system === "vercel") return group.id === "vercel" ? [] : ["Vercel"];
      if (system === "github") return group.id === "github" ? [] : ["GitHub"];
      const name = record.otherSystem.trim() || "Other";
      return group.id === `other:${name.toLowerCase()}` ? [] : [name];
    })
    .join(" · ");
}

type SystemGroup = {
  id: string;
  label: string;
  mark: string;
  records: KeyRecord[];
};

function serviceLabel(record: KeyRecord): string {
  if (record.service === "billing") return "Billing";
  if (record.service === "licence") return "Licence";
  if (record.service === "dev") return "Dev";
  return record.customService.trim() || "Custom";
}

function chipClass(pressed: boolean): string {
  return (
    "min-h-11 rounded-control border px-4 text-sm font-medium " +
    (pressed ? "border-accent bg-accent text-accent-fg" : "border-line bg-transparent text-fg")
  );
}

const fieldClass =
  "min-h-11 w-full rounded-control border border-line bg-bg px-3 text-sm text-fg outline-none focus-visible:border-accent";
