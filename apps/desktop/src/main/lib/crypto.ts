import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { resolveUserDataDir } from "./runtime-paths";

/**
 * 主密钥文件名（存放在 userData 目录下，受文件系统权限保护）
 * 后续可迁移到 OS keychain（keytar）以增强安全性
 */
const MASTER_KEY_FILENAME = "master.key";

/** AES-256-GCM 密钥长度（字节） */
const KEY_LEN = 32;

/** scrypt 派生参数 */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

let cachedMasterKey: Buffer | null = null;

/**
 * 获取或创建主密钥。
 * 主密钥是 32 字节随机数，存放在 userData/master.key 文件中。
 * 首次调用时生成，之后从文件加载。
 */
function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  const keyPath = join(resolveUserDataDir(), MASTER_KEY_FILENAME);
  if (existsSync(keyPath)) {
    cachedMasterKey = readFileSync(keyPath);
    if (cachedMasterKey.length !== KEY_LEN) {
      throw new Error(`主密钥长度异常：期望 ${KEY_LEN} 字节，实际 ${cachedMasterKey.length} 字节`);
    }
    return cachedMasterKey;
  }

  // 首次创建：确保目录存在
  const userDataDir = resolveUserDataDir();
  if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });

  cachedMasterKey = randomBytes(KEY_LEN);
  writeFileSync(keyPath, cachedMasterKey, { mode: 0o600 });
  return cachedMasterKey;
}

export interface EncryptedPayload {
  /** 加密后的密文（base64） */
  ct: string;
  /** 初始向量（base64） */
  iv: string;
  /** 认证标签（base64） */
  tag: string;
  /** 密文派生用的盐（base64） */
  salt: string;
}

/**
 * 加密字符串。
 * 采用 AES-256-GCM，密钥由主密钥 + 随机盐经 scrypt 派生而来。
 * 这样即使主密钥泄露，没有盐也无法解密历史数据（轻度防护）。
 */
export function encrypt(plaintext: string): EncryptedPayload {
  const masterKey = getMasterKey();
  const salt = randomBytes(16);
  // 注意：scryptSync 是同步阻塞调用，但 API key 加密场景低频，可接受
  const derivedKey = scryptSync(masterKey, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  const iv = randomBytes(12); // GCM 推荐 12 字节 IV
  const cipher = createCipheriv("aes-256-gcm", derivedKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ct: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    salt: salt.toString("base64"),
  };
}

/**
 * 解密字符串。
 * @param payload 加密时生成的载荷
 * @returns 原始明文
 */
export function decrypt(payload: EncryptedPayload): string {
  const masterKey = getMasterKey();
  const salt = Buffer.from(payload.salt, "base64");
  const derivedKey = scryptSync(masterKey, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ct = Buffer.from(payload.ct, "base64");

  const decipher = createDecipheriv("aes-256-gcm", derivedKey, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * 重置主密钥（仅用于调试/重置场景）。
 * 调用后所有已加密数据将无法解密。
 */
export function resetMasterKey(): void {
  cachedMasterKey = null;
  const keyPath = join(resolveUserDataDir(), MASTER_KEY_FILENAME);
  if (existsSync(keyPath)) unlinkSync(keyPath);
}
