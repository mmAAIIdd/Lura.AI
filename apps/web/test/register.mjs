/**
 * Разрешение алиаса «@/» для node --test.
 *
 * Исходники ходят друг к другу через «@/lib/...» — алиас из tsconfig.json.
 * Его знает сборщик Next и не знает Node, а тесты идут без сборщика, поэтому
 * алиас разворачивается здесь тем же правилом, что записано в tsconfig: «@/*»
 * — путь от корня apps/web. Расширение дописывается тут же: в TypeScript его
 * не пишут, а ESM без него не резолвит.
 *
 * Транспайлера при этом не появляется: типы с .ts снимает сам Node 22+, а этот
 * файл только называет модулю его настоящий путь. Формат указывается явно —
 * иначе Node определяет его чтением файла и предупреждает об этом на каждый
 * модуль, а лечится то предупреждение полем "type": "module" в package.json,
 * то есть сменой модульной системы всего приложения ради тестов.
 *
 * registerHooks, а не register: хуки нужны в том же потоке, где выставляется
 * STUDIO_DATA_DIR, и отдельный поток загрузчика этого окружения не увидит.
 */
import { registerHooks } from "node:module";

/* test/ лежит внутри apps/web — корень алиаса на уровень выше. */
const ROOT = new URL("../", import.meta.url);
const CANDIDATES = ["", ".ts", ".tsx", "/index.ts"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const base = new URL(specifier.slice(2), ROOT).href;
    let failure;
    for (const candidate of CANDIDATES) {
      try {
        const resolved = nextResolve(base + candidate, context);
        const format = resolved.url.endsWith(".ts") || resolved.url.endsWith(".tsx") ? "module-typescript" : resolved.format;
        return { ...resolved, format, shortCircuit: true };
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  },
});
