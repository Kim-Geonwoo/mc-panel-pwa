import "@testing-library/jest-dom";

// jsdom에는 matchMedia가 없다 — uPlot(성능 차트)이 모듈 임포트 시점에 호출하므로
// 최소 셈을 제공한다(리스너는 no-op, 매치는 항상 false).
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
