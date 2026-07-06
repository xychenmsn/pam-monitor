import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
export function getCredentialProvider(env: 'qa' | 'dev' | 'prod', forceRefetch: boolean = false) {
    const profile = env === 'prod' ? 'prod' : 'nonprod';

    // We check if the profile exists in ~/.aws/credentials. If not, fallback to 'saml'.
    let selectedProfile = profile;
    try {
        const credPath = path.join(process.env.HOME || '', '.aws/credentials');
        if (fs.existsSync(credPath)) {
            const content = fs.readFileSync(credPath, 'utf-8');
            const hasProfile = content.includes(`[${profile}]`);
            if (!hasProfile) {
                console.warn(`[AUTH] Profile [${profile}] not found in ~/.aws/credentials, falling back to [saml]`);
                selectedProfile = 'saml';
            }
        }
    } catch (e) {
        console.warn('[AUTH] Error checking credentials file, falling back to default/saml profile', e);
        selectedProfile = 'saml';
    }

    return fromNodeProviderChain({
        profile: selectedProfile,
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

/**
 * Triggers the local AWS login script/alias
 */
export async function triggerAwsLogin(env: 'qa' | 'dev' | 'prod'): Promise<boolean> {
    const isProd = env === 'prod';
    const primaryCmd = isProd ? 'awslogin_prod' : 'awslogin_nonprod';
    const secondaryCmd = isProd ? 'awslogin_nonprod' : 'awslogin_prod';
    
    const shell = process.env.SHELL || '/bin/zsh';
    let primarySuccess = false;

    console.log(`[AUTH] [1/2] Triggering primary AWS login via "${primaryCmd}"...`);
    try {
        const { stdout, stderr } = await execAsync(`${shell} -i -c "${primaryCmd}"`, {
            env: { ...process.env, TERM: 'xterm' },
            timeout: 60000
        });
        if (stdout) console.log(`[AUTH] ${primaryCmd} stdout:`, stdout);
        if (stderr) console.warn(`[AUTH] ${primaryCmd} stderr:`, stderr);
        primarySuccess = true;
        console.log(`[AUTH] Primary AWS login via "${primaryCmd}" completed.`);
    } catch (e: any) {
        console.warn(`[AUTH] Primary AWS login via "${primaryCmd}" notice: ${e.message}`);
        // Fallback for nonprod/dev
        if (!isProd) {
            try {
                console.log('[AUTH] Falling back to generic "awslogin" for primary...');
                await execAsync(`${shell} -i -c "awslogin"`, {
                    env: { ...process.env, TERM: 'xterm' },
                    timeout: 60000
                });
                primarySuccess = true;
            } catch (fallbackError: any) {
                console.warn(`[AUTH] Primary fallback awslogin notice: ${fallbackError.message}`);
            }
        }
    }

    console.log(`[AUTH] [2/2] Triggering secondary AWS login via "${secondaryCmd}"...`);
    try {
        const { stdout, stderr } = await execAsync(`${shell} -i -c "${secondaryCmd}"`, {
            env: { ...process.env, TERM: 'xterm' },
            timeout: 60000
        });
        if (stdout) console.log(`[AUTH] ${secondaryCmd} stdout:`, stdout);
        if (stderr) console.warn(`[AUTH] ${secondaryCmd} stderr:`, stderr);
        console.log(`[AUTH] Secondary AWS login via "${secondaryCmd}" completed.`);
    } catch (e: any) {
        console.warn(`[AUTH] Secondary AWS login via "${secondaryCmd}" notice: ${e.message}`);
        // Fallback for nonprod/dev
        if (isProd) { // secondary is nonprod
            try {
                console.log('[AUTH] Falling back to generic "awslogin" for secondary...');
                await execAsync(`${shell} -i -c "awslogin"`, {
                    env: { ...process.env, TERM: 'xterm' },
                    timeout: 60000
                });
            } catch (fallbackError: any) {
                console.warn(`[AUTH] Secondary fallback awslogin notice: ${fallbackError.message}`);
            }
        }
    }

    return primarySuccess;
}
