// 앱 셸.
// 모바일: 셸을 레이아웃 뷰포트 상단에 고정하고 높이를 --app-h(화면 키보드 위의 가시 영역,
// ViewportFix가 VisualViewport API로 추적)로 둔다. 이로써 상태 헤더는 상단에 고정되고
// 채팅 입력창은 키보드 바로 위에 위치한다. 수직 가운데 정렬은 쓰지 않는다 — 예전에는
// 줄어든 셸이 가운데 떠서 입력창이 키보드에 가려졌다.
// 데스크톱(md+): 셸이 일반 흐름의 아이폰 스타일 목업 프레임이 되어 가운데 정렬된다.
// 프레임은 md:relative — 다이나믹 아일랜드와 시트·모달(absolute)의 포지셔닝 기준점이라
// static이면 오버레이가 프레임을 탈출해 페이지에 앵커된다.
export default function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="md:desk-backdrop md:flex md:min-h-[100dvh] md:w-full md:items-center md:justify-center md:p-6">
      <div
        className="fixed inset-x-0 top-0 z-0 mx-auto flex h-[var(--app-h)] w-full max-w-md flex-col overflow-hidden bg-bg
                   md:relative md:inset-auto md:h-[844px] md:w-[390px] md:max-w-none md:rounded-[2.75rem]
                   md:border-[12px] md:border-neutral-900 md:shadow-2xl md:ring-1 md:ring-white/5"
      >
        {/* 다이나믹 아일랜드(데스크톱 목업 전용) */}
        <div className="pointer-events-none absolute left-1/2 top-2.5 z-50 hidden h-7 w-28 -translate-x-1/2 rounded-full bg-black md:block" />
        {children}
      </div>
    </div>
  );
}
