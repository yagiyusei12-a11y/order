import { join } from "node:path";

/** プロジェクト直下で起動することを想定（`tsx` / `node dist` とも） */
export function templatePath(name: string): string {
  return join(process.cwd(), "src", "templates", name);
}
