import crypto from "node:crypto";


// ============================================================
// SECRET CRYPTO
// ============================================================
//
// Encrypts small secrets (currently: TOTP 2FA secrets) at rest
// with AES-256-GCM.
//
// KEY
// ---
// Set ENCRYPTION_KEY to 32 bytes, as 64 hex chars or base64.
// Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// BACK-COMPAT
// -----------
// If ENCRYPTION_KEY is not set, values are stored/returned as
// plaintext so existing deployments keep working. Encrypted
// values are tagged with a prefix, so a database that mixes
// legacy plaintext and new ciphertext still reads correctly.
// ============================================================

const PREFIX = "enc:v1:";


const getKey = () => {
    const raw = process.env.ENCRYPTION_KEY;

    if (!raw) {
        return null;
    }

    const key = /^[0-9a-fA-F]{64}$/.test(raw.trim())
        ? Buffer.from(raw.trim(), "hex")
        : Buffer.from(raw.trim(), "base64");

    return key.length === 32 ? key : null;
};


export const isEncrypted = (value) =>
    typeof value === "string" && value.startsWith(PREFIX);


export const encryptSecret = (plain) => {
    if (plain === null || plain === undefined) {
        return plain;
    }

    const key = getKey();

    if (!key) {
        return String(plain);
    }

    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(
        "aes-256-gcm",
        key,
        iv
    );

    const encrypted = Buffer.concat([
        cipher.update(String(plain), "utf8"),
        cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    return (
        PREFIX +
        Buffer.concat([iv, tag, encrypted]).toString(
            "base64"
        )
    );
};


export const decryptSecret = (stored) => {
    if (stored === null || stored === undefined) {
        return stored;
    }

    if (!isEncrypted(stored)) {
        // Legacy plaintext value.
        return String(stored);
    }

    const key = getKey();

    if (!key) {
        throw new Error(
            "ENCRYPTION_KEY is required to read an encrypted secret."
        );
    }

    const raw = Buffer.from(
        stored.slice(PREFIX.length),
        "base64"
    );

    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);

    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        iv
    );

    decipher.setAuthTag(tag);

    return Buffer.concat([
        decipher.update(data),
        decipher.final(),
    ]).toString("utf8");
};
