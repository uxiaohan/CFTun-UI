import { chownSync, closeSync, mkdirSync, openSync, unlinkSync } from "node:fs";

const appUid = 65532;
const appGid = 65532;
const dataDir = process.env.DATA_DIR ?? "/data";

if (process.getuid?.() === 0) {
  try {
    mkdirSync(dataDir, { recursive: true });
    chownSync(dataDir, appUid, appGid);
  } catch (error) {
    console.error(`无法初始化数据目录 ${dataDir}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  process.setgroups?.([]);
  process.setgid?.(appGid);
  process.setuid?.(appUid);
}

const probe = `${dataDir}/.cftun-ui-write-test-${process.pid}`;
try {
  closeSync(openSync(probe, "wx", 0o600));
  unlinkSync(probe);
} catch (error) {
  console.error(`数据目录 ${dataDir} 对 UID ${process.getuid?.()} 不可写: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

await import("./server.js");
