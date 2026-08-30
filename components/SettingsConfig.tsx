"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SETTINGS_SCHEMA, SETTINGS_TABS, type SettingDef } from "@/lib/settings-schema";
import { SETTINGS_GROUPS_ZH, SETTINGS_ZH } from "@/lib/settings-i18n-zh";
import { useI18n } from "@/hooks/useI18n";
import { useChatWidthPct } from "@/lib/chat-width-preference";

/* ------------------------------------------------------------------ */
/* Dotted-path helpers                                                 */
/* ------------------------------------------------------------------ */

function getPath(obj: Record<string, unknown> | null | undefined, dotted: string): unknown {
  if (!obj) return undefined;
  let cur: unknown = obj;
  for (const part of dotted.split(".")) {
    if (typeof cur !== "object" || cur === null || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/* ------------------------------------------------------------------ */
/* Small controls                                                      */
/* ------------------------------------------------------------------ */

const rowLabelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: "var(--text)" };
const rowDescStyle: React.CSSProperties = {
  fontSize: 11.5, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.45, maxWidth: 480,
};

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      style={{
        width: 34, height: 20, borderRadius: 10, padding: 0, border: "none", cursor: disabled ? "not-allowed" : "pointer",
        background: checked ? "var(--accent)" : "var(--border)",
        position: "relative", transition: "background 0.15s", flexShrink: 0, opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 16 : 2, width: 16, height: 16, borderRadius: 8,
        background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
      }} />
    </button>
  );
}

function SelectControl({ value, options, onChange }: {
  value: string; options: Array<{ value: string; label?: string }>; onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 28, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-panel)",
        color: "var(--text)", fontSize: 12.5, padding: "0 8px", minWidth: 160, cursor: "pointer",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label ?? o.value}</option>
      ))}
    </select>
  );
}

function NumberControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      value={text}
      onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n); }}
      style={{
        height: 28, width: 110, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-panel)",
        color: "var(--text)", fontSize: 12.5, padding: "0 8px", fontVariantNumeric: "tabular-nums",
      }}
    />
  );
}

function TextControl({ value, placeholder, password, onChange }: {
  value: string; placeholder?: string; password?: boolean; onChange: (v: string) => void;
}) {
  return (
    <input
      type={password ? "password" : "text"}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 28, minWidth: 220, maxWidth: 320, borderRadius: 6, border: "1px solid var(--border)",
        background: "var(--bg-panel)", color: "var(--text)", fontSize: 12.5, padding: "0 8px",
      }}
    />
  );
}

function JsonControl({ value, onChange }: { value: string; onChange: (raw: string) => void }) {
  const { t } = useI18n();
  const [raw, setRaw] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => { setRaw(value); setBad(false); }, [value]);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
      <textarea
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          try { JSON.parse(e.target.value); setBad(false); onChange(e.target.value); }
          catch { setBad(true); }
        }}
        rows={2}
        spellCheck={false}
        style={{
          width: 320, minHeight: 40, maxHeight: 160, borderRadius: 6, border: `1px solid ${bad ? "var(--error)" : "var(--border)"}`,
          background: "var(--bg-panel)", color: "var(--text)", fontSize: 11.5, padding: "6px 8px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", resize: "vertical",
        }}
      />
      {bad && <span style={{ fontSize: 10.5, color: "var(--error)" }}>{t("settings.invalidJson")}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Setting row                                                         */
/* ------------------------------------------------------------------ */

function SettingRow({ def, value, onChange, credentialSet }: {
  def: SettingDef; value: unknown; onChange: (v: unknown) => void; credentialSet: boolean;
}) {
  const { locale, t } = useI18n();
  const zh = locale === "zh-CN" ? SETTINGS_ZH[def.key] : undefined;
  const label = zh?.label ?? def.ui?.label ?? def.key;
  const desc = zh?.description ?? def.ui?.description ?? def.description;
  const type = def.type;

  const options = useMemo(() => {
    const uiOpts = def.ui?.options;
    if (Array.isArray(uiOpts)) return uiOpts.map((o) => ({ value: o.value, label: o.label ?? o.value }));
    if (Array.isArray(def.values)) return def.values.map((v) => ({ value: String(v), label: String(v) }));
    return null;
  }, [def]);

  let control: React.ReactNode;
  if (def.credential) {
    const isSet = credentialSet;
    control = (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <TextControl
          value={typeof value === "string" ? value : ""}
          placeholder={isSet ? t("settings.credentialSetPlaceholder") : t("settings.credentialUnsetPlaceholder")}
          password
          onChange={(v) => onChange(v)}
        />
        {isSet && (
          <button
            type="button"
            title={t("settings.clear")}
            onClick={() => onChange(null)}
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, height: 28, width: 28, cursor: "pointer", color: "var(--text-dim)", fontSize: 13 }}
          >✕</button>
        )}
      </div>
    );
  } else if (type === "boolean") {
    control = <Switch checked={Boolean(value)} onChange={onChange} />;
  } else if (type === "enum") {
    control = options
      ? <SelectControl value={String(value)} options={options} onChange={onChange} />
      : <TextControl value={String(value ?? "")} onChange={onChange} />;
  } else if (type === "number") {
    control = <NumberControl value={typeof value === "number" ? value : Number(def.default ?? 0)} onChange={onChange} />;
  } else if (type === "record" || type === "array") {
    control = <JsonControl value={typeof value === "string" ? value : JSON.stringify(value ?? def.default ?? (type === "array" ? [] : {}), null, 1)} onChange={onChange} />;
  } else {
    control = <TextControl value={typeof value === "string" ? value : String(value ?? "")} onChange={onChange} />;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, padding: "10px 2px" }}>
      <div style={{ minWidth: 0 }}>
        <div style={rowLabelStyle}>{label}</div>
        {desc && <div style={rowDescStyle}>{desc}</div>}
      </div>
      {control}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Model role assignments (Model tab header)                           */
/* ------------------------------------------------------------------ */

const ROLE_ORDER = ["default", "slow", "smol", "vision", "plan", "advisor", "tiny", "designer", "commit", "task"] as const;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"];

function RolesEditor({ roles, models, onChange }: {
  roles: Record<string, string> | undefined;
  models: Record<string, string> | null;
  onChange: (next: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  const modelOptions = useMemo(() => {
    if (!models) return [];
    return Object.entries(models).map(([key, label]) => ({
      // /api/models keys are "provider:modelId"; config role values are "provider/modelId[:level]"
      value: key.replace(":", "/"),
      label: `${label} (${key.split(":")[0]})`,
    }));
  }, [models]);

  const [edits, setEdits] = useState<Record<string, { model: string; level: string }>>({});

  const roleValue = (role: string) => edits[role] ?? parseRole(roles?.[role]);
  function parseRole(v?: string) {
    if (!v) return { model: "", level: "" };
    const idx = v.lastIndexOf(":");
    if (idx > 0 && THINKING_LEVELS.includes(v.slice(idx + 1))) {
      return { model: v.slice(0, idx), level: v.slice(idx + 1) };
    }
    return { model: v, level: "" };
  }
  const compose = (role: string) => {
    const e = edits[role] ?? parseRole(roles?.[role]);
    if (!e.model) return;
    const next = { ...roles };
    if (e.level) next[role] = `${e.model}:${e.level}`;
    else next[role] = e.model;
    onChange(next);
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, marginBottom: 14, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setShow(!show)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
          padding: "10px 12px", background: "var(--bg-panel)", border: "none", cursor: "pointer",
          color: "var(--text)", fontSize: 13, fontWeight: 600,
        }}
      >
        <span>{t("settings.modelRoles")}</span>
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 400 }}>
          {t("settings.rolesConfigured", { count: Object.keys(roles ?? {}).length })}
          <span style={{ marginLeft: 8 }}>{show ? "▴" : "▾"}</span>
        </span>
      </button>
      {show && (
        <div style={{ padding: "4px 12px 10px" }}>
          {ROLE_ORDER.map((role) => {
            const e = roleValue(role);
            return (
              <div key={role} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
                <span style={{ width: 68, fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>{role}</span>
                <select
                  value={e.model}
                  onChange={(ev) => setEdits((prev) => ({ ...prev, [role]: { ...(prev[role] ?? e), model: ev.target.value } }))}
                  style={{ flex: 1, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text)", fontSize: 12, padding: "0 6px" }}
                >
                  <option value="">{t("settings.roleUnset")}</option>
                  {modelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                  value={e.level}
                  onChange={(ev) => setEdits((prev) => ({ ...prev, [role]: { ...(prev[role] ?? e), level: ev.target.value } }))}
                  style={{ width: 88, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text)", fontSize: 12, padding: "0 6px" }}
                >
                  <option value="">{t("settings.none")}</option>
                  {THINKING_LEVELS.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => compose(role)}
                  disabled={!e.model}
                  style={{
                    height: 26, padding: "0 10px", borderRadius: 6, border: "none", cursor: e.model ? "pointer" : "not-allowed",
                    background: e.model ? "var(--accent)" : "var(--bg-hover)", color: e.model ? "#fff" : "var(--text-dim)",
                    fontSize: 11.5, fontWeight: 600,
                  }}
                >{t("settings.apply")}</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Web-local settings (browser prefs, apply immediately, not in config.yml) */
/* ------------------------------------------------------------------ */

/** Chat column width — web-local, rendered inside the Display group. */
function ChatWidthRow() {
  const { t } = useI18n();
  const [chatWidthPct, setChatWidthPct] = useChatWidthPct();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, padding: "10px 2px" }}>
      <div style={{ minWidth: 0 }}>
        <div style={rowLabelStyle}>{t("settings.chatWidth")}</div>
        <div style={rowDescStyle}>{t("settings.chatWidthDesc")}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <NumberControl value={chatWidthPct} onChange={setChatWidthPct} />
        <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>%</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main panel                                                          */
/* ------------------------------------------------------------------ */

export const SettingsConfig = memo(function SettingsConfig({ onClose }: { onClose: () => void }) {
  const { locale, t } = useI18n();
  const [values, setValues] = useState<Record<string, unknown> | null>(null);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [activeTab, setActiveTab] = useState<string>("model");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, string> | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = Object.keys(edits).length > 0;

  useEffect(() => {
    let alive = true;
    void fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (alive) setValues(d.values ?? {}); })
      .catch(() => {});
    void fetch("/api/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (alive) setModels(d.models ?? null); })
      .catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { alive = false; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const displayValue = useCallback((def: SettingDef): unknown => {
    if (def.key in edits) return edits[def.key];
    return getPath(values, def.key) ?? def.default;
  }, [edits, values]);

  const change = useCallback((def: SettingDef, v: unknown) => {
    setEdits((prev) => {
      const next = { ...prev, [def.key]: v };
      return next;
    });
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows: SettingDef[] = [];
    for (const def of SETTINGS_SCHEMA) {
      if (!def.ui || def.ui.tab !== activeTab) continue;
      if (def.ui.condition) {
        const condValue = def.ui.condition in edits ? edits[def.ui.condition] : getPath(values, def.ui.condition);
        if (!condValue) continue;
      }
      if (q) {
        const hay = `${def.ui.label} ${def.ui.description ?? ""} ${def.key}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      rows.push(def);
    }
    return rows;
  }, [activeTab, query, edits, values]);

  const groups = useMemo(() => {
    const map = new Map<string, SettingDef[]>();
    for (const def of visible) {
      const g = def.ui!.group;
      const list = map.get(g) ?? [];
      list.push(def);
      map.set(g, list);
    }
    return [...map.entries()];
  }, [visible]);

  const save = async () => {
    if (!dirtyRef.current) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: edits }),
      });
      const d = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setEdits({});
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
      const fresh = await fetch("/api/config", { cache: "no-store" }).then((r) => r.json());
      setValues(fresh.values ?? {});
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const modelRoles = useMemo(() => {
    const raw = getPath(values, "modelRoles");
    return (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : undefined) as Record<string, string> | undefined;
  }, [values]);
  const roleEdits = useMemo(() => {
    const raw = edits["modelRoles"];
    return (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : undefined) as Record<string, string> | undefined;
  }, [edits]);

  const tabOrder = useMemo(() => {
    const ids = new Set(SETTINGS_SCHEMA.filter((s) => s.ui).map((s) => s.ui!.tab));
    return SETTINGS_TABS.filter((t) => ids.has(t.id));
  }, []);

  // Tab labels ship Chinese-only in the generated schema; translate when a key exists.
  const tabLabel = (tab: { id: string; label: string }): string => {
    const key = `settings.tab.${tab.id}`;
    const translated = t(key);
    return translated === key ? tab.label : translated;
  };

  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)",
    }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: 960, maxWidth: "94vw", height: "min(80vh, 760px)", display: "flex", flexDirection: "column",
        background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden",
        boxShadow: "var(--shadow-modal)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "14px 18px",
          borderBottom: "1px solid var(--border)", background: "var(--bg-panel)",
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("settings.title")}</div>
          <div style={{ flex: 1, maxWidth: 340, position: "relative" }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("settings.searchPlaceholder")}
              style={{
                width: "100%", height: 30, borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--bg)", color: "var(--text)", fontSize: 12.5, padding: "0 10px 0 28px",
              }}
            />
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" style={{ position: "absolute", left: 10, top: 9 }}>
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
            </svg>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("settings.effectiveNewSessions")}</span>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 8, height: 30, padding: "0 14px", cursor: "pointer", color: "var(--text-muted)", fontSize: 12.5 }}>{t("settings.close")}</button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirtyRef.current || saving}
            style={{
              height: 30, padding: "0 16px", borderRadius: 8, border: "none", cursor: dirtyRef.current && !saving ? "pointer" : "not-allowed",
              background: dirtyRef.current ? "var(--accent)" : "var(--bg-hover)", color: dirtyRef.current ? "#fff" : "var(--text-dim)",
              fontSize: 12.5, fontWeight: 600,
            }}
          >
            {savedOk ? t("settings.saved") : saving ? t("settings.saving") : t("settings.save")}
          </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Tab rail */}
          <div style={{
            width: 190, flexShrink: 0, borderRight: "1px solid var(--border)", background: "var(--bg-panel)",
            overflowY: "auto", padding: "8px 0",
          }}>
            {tabOrder.map((tab) => {
              const active = tab.id === activeTab;
              const count = query
                ? SETTINGS_SCHEMA.filter((s) => s.ui && s.ui.tab === tab.id && `${s.ui.label} ${s.ui.description ?? ""} ${s.key}`.toLowerCase().includes(query.toLowerCase())).length
                : SETTINGS_SCHEMA.filter((s) => s.ui && s.ui.tab === tab.id).length;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                    padding: "8px 14px", background: active ? "var(--bg-selected)" : "transparent",
                    border: "none", borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
                    cursor: "pointer", color: active ? "var(--text)" : "var(--text-muted)", fontSize: 12.5, fontWeight: active ? 600 : 400,
                  }}
                >
                  <span style={{ fontSize: 14 }}>{tab.icon}</span>
                  <span style={{ flex: 1 }}>{tabLabel(tab)}</span>
                  <span style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Settings list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "6px 18px 24px" }}>
            {activeTab === "model" && (
              <RolesEditor
                roles={roleEdits ?? modelRoles}
                models={models}
                onChange={(next) => change({ key: "modelRoles", type: "record" } as SettingDef, next)}
              />
            )}
            {saveError && (
              <div style={{ fontSize: 12, color: "var(--error)", background: "var(--error-bg)", borderRadius: 6, padding: "8px 10px", marginBottom: 10 }}>
                {t("settings.saveFailed", { error: saveError })}
              </div>
            )}
            {groups.map(([group, rows]) => (
              <div key={group} style={{ marginTop: group === groups[0][0] ? 0 : 18 }}>
                <div style={{
                  fontSize: 10.5, fontWeight: 700, letterSpacing: 0.08, textTransform: "uppercase",
                  color: "var(--text-dim)", paddingBottom: 6, borderBottom: "1px solid var(--border)",
                  marginBottom: 2,
                }}>
                  {locale === "zh-CN" ? (SETTINGS_GROUPS_ZH[group] ?? group) : group}
                </div>
                {rows.map((def) => (
                  <SettingRow
                    key={def.key}
                    def={def}
                    value={displayValue(def)}
                    credentialSet={getPath(values, def.key) === "__set__"}
                    onChange={(v) => change(def, v)}
                  />
                ))}
                {activeTab === "appearance" && group === "Display" && <ChatWidthRow />}
              </div>
            ))}
            {groups.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>{t("settings.noMatch")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  , document.body);
});
