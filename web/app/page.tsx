"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getMe, getToken, UnauthorizedError } from "../lib/api";
import Login from "../components/Login";
import NicknameSetup from "../components/NicknameSetup";
import Panel from "../components/Panel";
import PhoneFrame from "../components/PhoneFrame";

type Stage = "boot" | "login" | "nickname" | "app";

export default function Home() {
  const [stage, setStage] = useState<Stage>("boot");

  // 진입 화면 결정: 토큰 없음 -> 로그인, 토큰 있으나 닉네임 없음 -> 닉네임, 그 외 -> 앱.
  const resolve = useCallback(async () => {
    if (!getToken()) {
      setStage("login");
      return;
    }
    try {
      const me = await getMe();
      setStage(me.nickname ? "app" : "nickname");
    } catch {
      setStage("login");
    }
  }, []);

  useEffect(() => {
    resolve();
  }, [resolve]);

  const onLogout = useCallback(() => setStage("login"), []);

  const fade = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 },
    transition: { duration: 0.22 },
  };

  return (
    <PhoneFrame>
      <AnimatePresence mode="wait">
        {stage === "boot" && (
          <motion.div key="boot" {...fade} className="flex flex-1 items-center justify-center text-muted">
            <span className="animate-pulse">불러오는 중…</span>
          </motion.div>
        )}
        {stage === "login" && (
          <motion.div key="login" {...fade} className="pt-safe pb-safe flex flex-1 flex-col justify-center overflow-y-auto px-5">
            <Login onAuthed={resolve} />
          </motion.div>
        )}
        {stage === "nickname" && (
          <motion.div key="nick" {...fade} className="pt-safe pb-safe flex flex-1 flex-col justify-center overflow-y-auto px-5">
            <NicknameSetup onDone={() => setStage("app")} onLogout={onLogout} />
          </motion.div>
        )}
        {stage === "app" && (
          <motion.div key="app" {...fade} className="flex min-h-0 flex-1 flex-col">
            <Panel onLogout={onLogout} />
          </motion.div>
        )}
      </AnimatePresence>
    </PhoneFrame>
  );
}
