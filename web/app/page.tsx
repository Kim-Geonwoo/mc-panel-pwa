"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getLayout, getMe, getToken, UnauthorizedError } from "../lib/api";
import { applyTheme } from "../lib/builder/applyTheme";
import { useI18n } from "../lib/i18n";
import Login from "../components/Login";
import NicknameSetup from "../components/NicknameSetup";
import Panel from "../components/Panel";
import PhoneFrame from "../components/PhoneFrame";

type Stage = "boot" | "login" | "nickname" | "app";

export default function Home() {
  const { t } = useI18n();
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
    } catch (e) {
      // 인증 실패만 로그인으로. 오프라인·일시 장애는 토큰이 살아 있으므로 앱으로
      // 진입시킨다 — 패널의 폴러가 재연결 배너와 401 판정(로그아웃)을 담당한다.
      setStage(e instanceof UnauthorizedError ? "login" : "app");
    }
  }, []);

  useEffect(() => {
    resolve();
  }, [resolve]);

  // 부트 시 서버 레이아웃을 조회해 테마(accent)·타이틀을 반영한다. 실패 시 기본
  // 레이아웃(accent 없음·타이틀 빈값)이라 화면은 그대로다(회귀 0).
  useEffect(() => {
    getLayout().then((l) => {
      applyTheme(l.theme);
      if (l.meta?.title) document.title = l.meta.title;
    });
  }, []);

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
            <span className="animate-pulse">{t("boot.loading")}</span>
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
