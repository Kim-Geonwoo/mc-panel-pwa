"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { logout, setNickname } from "../lib/api";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

export default function NicknameSetup({
  onDone,
  onLogout,
}: {
  onDone: () => void;
  onLogout: () => void;
}) {
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = nick.trim().length >= 2 && nick.trim().length <= 16;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setNickname(nick.trim());
      onDone();
    } catch (e) {
      setError(
        e instanceof Error && e.message === "taken"
          ? "이미 사용 중인 닉네임입니다."
          : "닉네임은 2–16자여야 합니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>
      <div className="mt-2 flex flex-col items-center gap-7">
        <div className="flex flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-4 text-xl font-bold tracking-tight">닉네임 설정</h1>
          <p className="mt-1.5 text-sm text-muted">
            채팅에 표시될 이름을 정해주세요 (2–16자)
          </p>
        </div>

        <motion.input
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          value={nick}
          onChange={(e) => {
            setNick(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            // 한글 IME 조합 확정 Enter(keyCode 229)는 무시 — 마지막 글자 유실·조기 제출 방지
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") submit();
          }}
          maxLength={16}
          autoFocus
          placeholder="닉네임"
          className="w-full max-w-[330px] rounded-xl border border-line bg-card px-4 py-3.5 text-center text-lg outline-none focus:border-accent"
        />

        <div className="h-5 text-center text-sm text-danger" role="alert">
          {error}
        </div>

        <button
          type="button"
          disabled={!valid || busy}
          onClick={submit}
          className="w-full max-w-[330px] rounded-xl bg-accent py-3.5 font-bold text-accent-fg shadow-card transition active:scale-[0.99] disabled:opacity-40"
        >
          {busy ? "설정 중…" : "시작하기"}
        </button>

        <button
          type="button"
          onClick={async () => {
            await logout();
            onLogout();
          }}
          className="text-xs text-muted underline-offset-2 hover:underline"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
