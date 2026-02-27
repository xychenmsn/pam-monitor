import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import fs from 'fs';
import path from 'path';

/**
 * Checks if an error is a retryable AWS authentication/credential error
 */
export function isAuthError(error: any): boolean {
    if (!error) return false;
    const errorCode = error.name || error.Code || error.errorCode || error.__type || '';
    const errorMessage = error.message || error.Message || error.errorMessage || '';

    const isAuth = (
        errorCode === 'ExpiredTokenException' ||
        errorCode === 'UnauthorizedException' ||
        errorCode === 'InvalidClientTokenId' ||
        errorCode === 'SignatureDoesNotMatch' ||
        errorCode.includes('ExpiredToken') ||
        errorMessage.includes('security token') ||
        errorMessage.includes('credentials') ||
        errorMessage.includes('unauthorized') ||
        errorMessage.includes('expired')
    );

    if (isAuth) {
        console.log(`[AUTH] Detected authentication error: code="${errorCode}", message="${errorMessage.substring(0, 100)}..."`);
    }

    return isAuth;
}

/**
 * Force clear AWS environment variables that might be caching old credentials
 */
export function clearAwsEnvVars() {
    if (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SESSION_TOKEN || process.env.AWS_SECURITY_TOKEN) {
        console.log('[AUTH] Clearing stale AWS credential environment variables...');
        delete process.env.AWS_ACCESS_KEY_ID;
        delete process.env.AWS_SECRET_ACCESS_KEY;
        delete process.env.AWS_SESSION_TOKEN;
        delete process.env.AWS_SECURITY_TOKEN;
    }
}

/**
 * Diagnostic helper to log the state of ~/.aws/credentials
 */
export function logCredentialStats() {
    try {
        const credPath = path.join(process.env.HOME || '', '.aws/credentials');
        if (fs.existsSync(credPath)) {
            const stats = fs.statSync(credPath);
            console.log(`[AUTH] ~/.aws/credentials last modified: ${stats.mtime.toISOString()}`);
        } else {
            console.warn('[AUTH] ~/.aws/credentials file not found');
        }
    } catch (e) {
        console.warn('[AUTH] Could not stat ~/.aws/credentials');
    }
}

/**
 * Creates a credential provider that can bypass the SDK's internal cache
 */
export function getCredentialProvider(forceRefetch: boolean = false) {
    // We pass ignoreCache: true when we know we just had an auth failure
    // and want to ensure we read the new file from disk.
    return fromNodeProviderChain({
        // @ts-ignore - The type definition might not include this but the implementation (fromIni) does
        ignoreCache: forceRefetch
    });
}

/**
 * Higher-order function to wrap AWS operations with automatic recovery logic
 * @param operation A function that performs an AWS operation using a fresh or cached client
 * @param onRetry A callback to invalidate cached clients and reset state
 */
export async function withAwsRecovery<T>(
    operation: (forceRefetch: boolean) => Promise<T>,
    onRetry: () => void
): Promise<T> {
    try {
        // First attempt: use normal/cached state
        return await operation(false);
    } catch (error: any) {
        if (isAuthError(error)) {
            console.log('⚠️ AWS credentials expired or invalid. Starting auto-recovery...');

            logCredentialStats();
            clearAwsEnvVars();

            // Allow the caller to clear their cached clients
            onRetry();

            console.log('[AUTH] Retrying operation with fresh credentials and ignoreCache: true...');
            try {
                // Second attempt: force a refetch of credentials from disk
                return await operation(true);
            } catch (retryError: any) {
                console.error('[AUTH] ❌ Recovery attempt failed:', retryError.name || retryError.message);
                throw retryError;
            }
        }
        throw error;
    }
}
