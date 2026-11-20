"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { eDpi, cmPer360, virtualSensitivityScale, MIN_SENS, MAX_SENS } from "@/lib/mouse-math";
import { getSessionForResults, loadSettings, loadTestProgress, saveSettings } from "@/lib/storage";
import { parsePlayerSettings, validateSettingsInput } from "@/lib/validation";
import {
  DEFAULT_SETTINGS,
  TEST_MODES,
} from "@/types";
import type { PlayerSettings } from "@/types";
import { Crosshair, Monitor, Send } from "lucide-react";

export default function SetupPage() {
  return (
    <Suspense fallback={<SetupLoading />}>
      <SetupEntry />
    </Suspense>
  );
}

function SetupLoading() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <div className="h-96 animate-pulse rounded-xl border border-line bg-panel" />
    </main>
  );
}

function SetupEntry() {
  const retestId = useSearchParams().get("fromResult");
  return <SetupForm key={retestId === null ? "setup" : `result:${retestId}`} retestId={retestId} />;
}

function SetupForm({ retestId }: { retestId: string | null }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [form, setForm] = useState<PlayerSettings>({ ...DEFAULT_SETTINGS });
  // DPI / 灵敏度用字符串受控：清空输入框时显示占位符而不是 0
  const [dpiText, setDpiText] = useState(String(DEFAULT_SETTINGS.dpi));
  const [sensText, setSensText] = useState(String(DEFAULT_SETTINGS.baseSensitivity));
  const [errors, setErrors] = useState<string[]>([]);
  const [retestStatus, setRetestStatus] = useState<"loaded" | "missing" | null>(null);
  const [hasProgress, setHasProgress] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = loadSettings() ?? DEFAULT_SETTINGS;
    const source = retestId ? getSessionForResults(retestId) : null;
    const retest = source && parsePlayerSettings({
      ...previous,
      dpi: source.recommendation.dpi,
      baseSensitivity: source.recommendation.sensitivity,
      mode: source.settings.mode,
    });
    const initial = retest ?? previous;
    setForm({ ...initial, screenWidth: window.innerWidth, screenHeight: window.innerHeight });
    setDpiText(String(initial.dpi));
    setSensText(String(initial.baseSensitivity));
    if (retestId !== null) {
      setRetestStatus(retest ? "loaded" : "missing");
      setHasProgress(Boolean(loadTestProgress()));
    }
    setMounted(true);
  }, [retestId]);

  if (!mounted) return <SetupLoading />;

  const set = <K extends keyof PlayerSettings>(key: K, value: PlayerSettings[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors([]);
  };

  const validate = (): string[] => validateSettingsInput({ dpi: form.dpi, baseSensitivity: form.baseSensitivity });

  // 字段级错误：用于 aria-invalid 与红框标注
  const dpiError = errors.find((e) => e.includes("DPI")) ?? null;
  const sensError = errors.find((e) => e.includes("灵敏度")) ?? null;

  const submit = () => {
    const errs = validate();
    setErrors(errs);
    if (errs.length > 0) {
      errorRef.current?.focus();
      return;
    }
    if (!saveSettings({ ...form, screenWidth: window.innerWidth, screenHeight: window.innerHeight })) {
      setErrors(["设置保存失败。请检查浏览器存储是否可用，或清理空间后重试。"]);
      return;
    }
    router.push("/test");
  };

  const currentEDpi = eDpi(Number(form.dpi) || 0, Number(form.baseSensitivity) || 0);
  const currentCm360 = cmPer360(Number(form.dpi) || 0, Number(form.baseSensitivity) || 0);
  const previewScale = virtualSensitivityScale(
    Number(form.baseSensitivity) || 0,
    Number(form.dpi) || 0,
    form.screenWidth || 1920
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">{retestStatus === "loaded" ? "复测设置" : "玩家设置"}</h1>
        <p className="mt-2 text-sm text-dim">
          {retestStatus === "loaded"
            ? "已填入该次测试的 DPI、推荐灵敏度和测试模式。确认参数后即可开始。"
            : "输入你当前的真实参数，作为灵敏度搜索的基准。"}
        </p>
        {retestStatus === "missing" ? (
          <p role="status" className="mt-3 text-sm text-warn">该测试结果已不可用，可以在下方手动设置参数。</p>
        ) : null}
        {hasProgress ? (
          <p className="mt-3 text-sm text-dim">浏览器中有可继续的测试。进入测试后，可以继续原进度或用新设置重新开始。</p>
        ) : null}
      </header>

      {errors.length > 0 && (
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="panel mb-6 border-accent/50 p-4 text-sm text-accent outline-none"
        >
          <div className="font-semibold">请修正以下问题后再继续：</div>
          <ul className="mt-1.5 list-inside list-disc space-y-1">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="panel space-y-6 p-6 sm:p-8"
      >
        {/* DPI & 灵敏度 */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="dpi">Mouse DPI</label>
            <input
              id="dpi"
              type="number"
              inputMode="numeric"
              className={`input font-mono ${dpiError ? "border-accent" : ""}`}
              value={dpiText}
              aria-invalid={dpiError ? true : undefined}
              aria-describedby={dpiError ? "dpi-error" : undefined}
              onChange={(e) => {
                setDpiText(e.target.value);
                set("dpi", Number(e.target.value));
              }}
              onBlur={() => setErrors(validate())}
              placeholder="800"
            />
            {dpiError && (
              <p id="dpi-error" role="alert" className="mt-1.5 text-[11px] text-accent">{dpiError}</p>
            )}
            <p className="mt-1.5 text-[11px] text-dim">可在鼠标驱动中查看（如 400 / 800 / 1600）</p>
          </div>
          <div>
            <label className="label" htmlFor="sens">Current VALORANT Sensitivity</label>
            <input
              id="sens"
              type="number"
              step="0.001"
              min={MIN_SENS}
              max={MAX_SENS}
              inputMode="decimal"
              className={`input font-mono ${sensError ? "border-accent" : ""}`}
              value={sensText}
              aria-invalid={sensError ? true : undefined}
              aria-describedby={sensError ? "sens-error" : undefined}
              onChange={(e) => {
                setSensText(e.target.value);
                set("baseSensitivity", Number(e.target.value));
              }}
              onBlur={() => setErrors(validate())}
              placeholder="0.35"
            />
            {sensError && (
              <p id="sens-error" role="alert" className="mt-1.5 text-[11px] text-accent">{sensError}</p>
            )}
            <p className="mt-1.5 text-[11px] text-dim">设置 → 鼠标 → 灵敏度，保留 3 位小数</p>
          </div>
        </div>

        {/* eDPI 结果 */}
        <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent/5 p-4">
          <div className="text-xs uppercase tracking-widest text-dim">eDPI = DPI × Sensitivity</div>
          <div className="font-mono text-2xl font-bold text-accent">
            {Number.isFinite(currentEDpi) ? Math.round(currentEDpi) : "—"}
          </div>
        </div>

        {/* 真实手感换算预览 */}
        <div className="rounded-lg border border-good/30 bg-good/5 p-4 text-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-good">
            <Crosshair size={13} />
            虚拟准星手感预估
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <div className="text-[11px] text-dim">模拟灵敏度</div>
              <div className="mt-0.5 font-mono text-lg text-fg">
                {Number.isFinite(currentEDpi) ? form.baseSensitivity.toFixed(3) : "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-dim">360° 旋转距离</div>
              <div className="mt-0.5 font-mono text-lg text-fg">
                {currentCm360 > 0 ? `${currentCm360.toFixed(1)} cm` : "—"}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <div className="text-[11px] text-dim">准星速度（px / count）</div>
              <div className="mt-0.5 font-mono text-lg text-fg">
                {previewScale > 0 ? previewScale.toFixed(3) : "—"}
              </div>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-dim/80">
            开始后会尝试使用原始鼠标输入；不支持时会显示提示。准星速度按灵敏度与实际测试区域宽度近似换算，不能替代游戏内校准。
          </p>
        </div>

        {/* 模式 */}
        <div>
          <label className="label">测试模式</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {TEST_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => set("mode", m.value)}
                aria-pressed={form.mode === m.value}
                className={`rounded-lg border p-4 text-left transition ${
                  form.mode === m.value
                    ? "border-accent bg-accent/10"
                    : "border-line bg-panel-2 hover:text-fg"
                }`}
              >
                <div className={`text-sm font-semibold ${form.mode === m.value ? "text-accent" : "text-fg"}`}>
                  {m.label}
                </div>
                <div className="mt-1 text-xs text-dim">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 准星颜色 */}
        <div>
          <label className="label">虚拟准星颜色</label>
          <div className="flex items-center gap-3">
            {["#52f485", "#f43f4e", "#f5b942", "#38bdf8", "#ffffff"].map((c) => {
              const active = form.crosshairColor === c;
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`crosshair color ${c}`}
                  aria-pressed={active}
                  onClick={() => set("crosshairColor", c)}
                  className={`relative grid h-9 w-9 place-items-center rounded-full border-2 transition ${
                    active ? "border-accent scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                >
                  {active && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M5 12l5 5 9-11" stroke={c === "#ffffff" ? "#0b0f14" : "#fff"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 屏幕尺寸（自动读取） */}
        <div className="flex items-center gap-2 text-xs text-dim">
          <Monitor size={14} />
          测试区域：{form.screenWidth} × {form.screenHeight}（自动读取屏幕，请使用桌面浏览器）
        </div>

        <button type="submit" className="btn-primary w-full text-base">
          <Send size={16} />
          进入测试
        </button>
      </form>
    </main>
  );
}
