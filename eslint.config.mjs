import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      // The build does not enable React Compiler (no reactCompiler in
      // next.config.ts, no compiler babel plugin). preserve-manual-memoization
      // only checks whether hand-written useCallback/useMemo deps match what
      // the Compiler would infer — with the Compiler off, hand-written deps
      // (e.g. stable ref objects instead of ref.current) are the intended
      // memoization, so the rule only produces false positives here. Same
      // rationale as the three compiler-era rules disabled above.
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
];

export default eslintConfig;
