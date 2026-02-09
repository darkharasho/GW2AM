const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

function deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512');
}

function encrypt(text, masterKey) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('hex');
}

function decrypt(encryptedText, masterKey) {
    const buffer = Buffer.from(encryptedText, 'hex');
    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
}

// Test
try {
    const password = "mysecretpassword";
    const salt = crypto.randomBytes(64);
    const key = deriveKey(password, salt);
    const text = "SENSITIVE_DATA_123";
    const encrypted = encrypt(text, key);
    const decrypted = decrypt(encrypted, key);

    console.log("Original:", text);
    console.log("Encrypted:", encrypted);
    console.log("Decrypted:", decrypted);

    if (text === decrypted) {
        console.log("Test Passed!");
    } else {
        console.error("Test Failed! Decrypted text does not match original.");
        process.exit(1);
    }
} catch (e) {
    console.error("Test Error:", e);
    process.exit(1);
}
