import type { AppDatabase } from "./db.ts";

const COOKIE = "cftun_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const SECURE = process.env.SECURE_COOKIES === "true" ? "; Secure" : "";

export class AuthService {
  constructor(private readonly db: AppDatabase) {}

  configured(): boolean { return Boolean(this.db.getSetting("admin_password_hash")); }

  async initialize(username: string, password: string): Promise<void> {
    if (this.configured()) throw new Error("管理员已经初始化");
    validateCredentials(username, password);
    this.db.setSettings({ admin_username: username, admin_password_hash: await Bun.password.hash(password, { algorithm: "argon2id" }) });
  }

  async login(username: string, password: string): Promise<{ cookie: string; expiresAt: string }> {
    const expectedUser = this.db.getSetting("admin_username");
    const hash = this.db.getSetting("admin_password_hash");
    if (!expectedUser || !hash || username !== expectedUser || !await Bun.password.verify(password, hash)) throw new Error("用户名或密码错误");
    const id = randomToken();
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
    this.db.createSession(id, username, expiresAt);
    return { cookie: `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict${SECURE}; Max-Age=${SESSION_SECONDS}`, expiresAt };
  }

  async update(username: string, currentPassword: string, password: string): Promise<void> {
    const expectedUser = this.db.getSetting("admin_username");
    const hash = this.db.getSetting("admin_password_hash");
    if (!expectedUser || !hash || !await Bun.password.verify(currentPassword, hash)) throw new Error("当前密码错误");
    validateCredentials(username, password);
    this.db.setSettings({ admin_username: username, admin_password_hash: await Bun.password.hash(password, { algorithm: "argon2id" }) });
    this.db.sqlite.query("DELETE FROM admin_sessions").run();
  }

  authenticate(request: Request): { username: string; sessionId: string } | null {
    const raw = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
    const sessionId = raw?.slice(COOKIE.length + 1);
    if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
    const session = this.db.session(sessionId);
    return session ? { username: session.username, sessionId } : null;
  }

  logout(request: Request): string {
    const auth = this.authenticate(request);
    if (auth) this.db.deleteSession(auth.sessionId);
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict${SECURE}; Max-Age=0`;
  }
}

function validateCredentials(username: string, password: string): void {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(username)) throw new Error("用户名需为 1 至 64 位，仅支持字母、数字、下划线、点和短横线");
  if (password.length < 6 || password.length > 256) throw new Error("密码长度必须为 6 至 256 个字符");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}
