import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React 19 编译器风格 lint 规则与“ref 驱动的高频测试循环”模式冲突，
      // 此处关闭；保留 rules-of-hooks / exhaustive-deps 等经典规则。
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/no-deriving-state-in-effects": "off",
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-render": "off",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);
