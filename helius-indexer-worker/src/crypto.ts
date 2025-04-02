// src/crypto.ts
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-gcm'; // Matching algorithm
const IV_LENGTH = 12; // GCM standard IV length
const AUTH_TAG_LENGTH = 16; // GCM standard auth tag length

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
    console.error('FATAL: ENCRYPTION_KEY environment variable is missing or invalid (must be 64 hex chars for 32 bytes).');
    process.exit(1); // Exit if key is invalid
}

// Key is expected to be Hex encoded
const key = Buffer.from(ENCRYPTION_KEY, 'hex');

export function encrypt(plainText: string): string {
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

        let encrypted = cipher.update(plainText, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        // Get the authentication tag (GCM specific)
        const authTag = cipher.getAuthTag();

        // Prepend IV and AuthTag (as hex for consistency) to the encrypted data (Base64)
        // Format: iv_hex.authTag_hex.encrypted_base64
        return `${iv.toString('hex')}.${authTag.toString('hex')}.${encrypted}`;

    } catch (error) {
        console.error('Encryption failed:', error);
        throw new Error('Failed to encrypt data.');
    }
}

export function decrypt(cipherText: string): string {
    try {
        // Extract parts: iv_hex.authTag_hex.encrypted_base64
        const parts = cipherText.split('.');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted data format.');
        }
        const [ivHex, authTagHex, encryptedBase64] = parts;

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const encrypted = encryptedBase64; // Already Base64

        if (iv.length !== IV_LENGTH) throw new Error('Invalid IV length');
        if (authTag.length !== AUTH_TAG_LENGTH) throw new Error('Invalid authTag length');


        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        // Set the authentication tag *before* decryption
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error: any) {
        console.error('Decryption failed:', error);
         // Avoid leaking specific crypto errors
        if (error.message?.toLowerCase().includes('unsupported state') || error.message?.toLowerCase().includes('auth tag')) {
             throw new Error('Decryption failed: Authentication tag mismatch. Data may be corrupt or key incorrect.');
        }
        throw new Error('Failed to decrypt data.');
    }
}