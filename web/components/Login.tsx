"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { login } from "../lib/api";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

export default function Login({ onAuthed }: { onAuthed: () => void }) {
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
          ? "시도가 너무 많습니다. 잠시 후 다시 시도하세요."
          : "코드가 올바르지 않습니다.";
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
          <h1 className="mt-4 text-2xl font-bold tracking-tight">MC Server Panel</h1>
          <p className="mt-1.5 text-sm text-muted">
            디스코드에 게시된 6자리 코드를 입력하세요
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
            aria-label="6자리 코드"
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
          {busy ? "확인 중…" : "입장하기"}
        </button>
      </div>
    </div>
  );
}
