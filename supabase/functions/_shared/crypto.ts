// supabase/functions/_shared/crypto.ts (REPLACE Existing Content)

import { crypto } from 'https://deno.land/std@0.177.0/crypto/mod.ts';
import { encode as hexEncode } from 'https://deno.land/std@0.177.0/encoding/hex.ts';
import { decode as base64Decode } from "https://deno.land/std@0.177.0/encoding/base64.ts";
import { encode as base64Encode } from "https://deno.land/std@0.177.0/encoding/base64.ts";

// Retrieve the key from environment variables (set as Supabase Secret)
const secretKeyHex = Deno.env.get('ENCRYPTION_KEY');
if (!secretKeyHex || secretKeyHex.length !== 64) {
  console.error('FATAL: ENCRYPTION_KEY environment variable is missing or invalid.');
  // Optionally throw error to prevent function start if needed in Deno context
}

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12; // bytes
const AUTH_TAG_LENGTH = 16; // bytes -> 128 bits for GCM

// Function to derive a CryptoKey from the hex secret
async function getKey(): Promise<CryptoKey> {
    if (!secretKeyHex) throw new Error("Encryption key not configured.");
    // deno-lint-ignore no-undef Assuming TextEncoder is available globally in Deno
    const keyBytes = new Uint8Array(secretKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    return await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: ALGORITHM },
        false, // not exportable
        ['encrypt', 'decrypt']
    );
}

// --- UPDATED Deno Encryption Function ---
// Outputs format: iv_hex.authTag_hex.encrypted_base64
export async function encrypt(plainText: string): Promise<string> {
    if (!secretKeyHex) throw new Error("Encryption key not configured.");

    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    // deno-lint-ignore no-undef Assuming TextEncoder is available
    const encodedText = new TextEncoder().encode(plainText);

    const cipherBuffer = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv: iv, tagLength: AUTH_TAG_LENGTH * 8 }, // Specify tag length in bits
        key,
        encodedText
    );

    // AES-GCM encrypt result includes ciphertext + auth tag appended
    const cipherBytes = new Uint8Array(cipherBuffer);
    const ciphertext = cipherBytes.slice(0, cipherBytes.length - AUTH_TAG_LENGTH);
    const authTag = cipherBytes.slice(cipherBytes.length - AUTH_TAG_LENGTH);

    // Combine IV (hex) + AuthTag (hex) + Ciphertext (base64)
    const ivHex = new TextDecoder().decode(hexEncode(iv)); // Uint8Array to hex string
    const authTagHex = new TextDecoder().decode(hexEncode(authTag)); // Uint8Array to hex string
    // deno-lint-ignore no-undef Assuming TextDecoder is available
    const encryptedBase64 = base64Encode(ciphertext); // Use base64 for ciphertext part

    return `${ivHex}.${authTagHex}.${encryptedBase64}`;
}

// --- UPDATED Deno Decryption Function ---
// Expects format: iv_hex.authTag_hex.encrypted_base64
export async function decrypt(cipherText: string): Promise<string> {
    if (!secretKeyHex) throw new Error("Encryption key not configured.");

    try {
        const key = await getKey();
        const parts = cipherText.split('.');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted data format.');
        }
        const [ivHex, authTagHex, encryptedBase64] = parts;

        // deno-lint-ignore no-undef Assuming TextEncoder is available
        const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        const authTag = new Uint8Array(authTagHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        const ciphertext = base64Decode(encryptedBase64); // Decode base64 ciphertext

        if (iv.length !== IV_LENGTH) throw new Error('Invalid IV length');
        if (authTag.length !== AUTH_TAG_LENGTH) throw new Error('Invalid authTag length');

        // Combine ciphertext and auth tag for decryption function
        const cipherBuffer = new Uint8Array(ciphertext.length + authTag.length);
        cipherBuffer.set(ciphertext, 0);
        cipherBuffer.set(authTag, ciphertext.length);

        const decryptedBuffer = await crypto.subtle.decrypt(
            { name: ALGORITHM, iv: iv, tagLength: AUTH_TAG_LENGTH * 8 }, // Specify tag length
            key,
            cipherBuffer
        );

        // deno-lint-ignore no-undef Assuming TextDecoder is available
        return new TextDecoder().decode(decryptedBuffer);

    } catch (error: unknown) {
        console.error('Decryption failed:', error);
        if (error instanceof Error && error.message.toLowerCase().includes("tag mismatch")) {
             throw new Error('Decryption failed: Authentication tag mismatch. Data may be corrupt or key incorrect.');
        }
        throw new Error('Failed to decrypt data. Incorrect key or corrupted data.');
    }
}