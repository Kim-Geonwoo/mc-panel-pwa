"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { login } from "../lib/api";
import { useI18n } from "../lib/i18n";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

export default function Login({ onAuthed }: { onAuthed: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const digits = code.padEnd(6, " ").slice(0, 6).split("");

  async function submit(value: string) {
    if (busy || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await login(value);
      onAuthed();
    } catch (e) {
      const msg =
        e instanceof Error && e.message === "too_many"
          ? t("login.errTooMany")
          : t("login.errInvalid");
      setError(msg);
      setShake((s) => s + 1);
      setCode("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function onChange(v: string) {
    const next = v.replace(/\D/g, "").slice(0, 6);
    setCode(next);
    setError(null);
    if (next.length === 6) submit(next);
  }

  return (
    <div className="flex w-full flex-col">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>

      <div className="mt-2 flex flex-col items-center gap-7 sm:gap-8">
        <div className="flex flex-col items-center text-center">
          <Logo size={60} />
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{t("login.title")}</h1>
          <p className="mt-1.5 text-sm text-muted">
            {t("login.subtitle")}
          </p>
        </div>

        <motion.div
          key={shake}
          animate={shake ? { x: [0, -7, 7, -7, 7, 0] } : {}}
          transition={{ duration: 0.4 }}
          className="relative w-full max-w-[330px]"
          onClick={() => inputRef.current?.focus()}
        >
          <div className="flex justify-between gap-1.5 sm:gap-2">
            {digits.map((d, i) => {
              const active = i === Math.min(code.length, 5) && code.length < 6;
              return (
                <span
                  key={i}
                  className={[
                    "grid aspect-[3/4] flex-1 place-items-center rounded-xl border text-2xl font-bold tabular-nums shadow-card",
                    error
                      ? "border-danger"
                      : active
                        ? "border-accent"
                        : "border-line",
                    "bg-card",
                  ].join(" ")}
                >
                  {d.trim()}
                </span>
              );
            })}
          </div>
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => onChange(e.target.value)}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            aria-label={t("login.codeAria")}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </motion.div>

        <div className="h-5 text-center text-sm text-danger" role="alert">
          {error}
        </div>

        <button
          type="button"
          disabled={busy || code.length !== 6}
          onClick={() => submit(code)}
          className="w-full max-w-[330px] rounded-xl bg-accent py-3.5 font-bold text-accent-fg shadow-card transition active:scale-[0.99] disabled:opacity-40"
        >
          {busy ? t("login.checking") : t("login.submit")}
        </button>
      </div>
    </div>
  );
}
