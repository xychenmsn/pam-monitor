import {
    SecretsManagerClient,
    GetSecretValueCommand,
    ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

const REGION = 'us-east-1';

// Map environment names to their secret path segment
const ENV_MAP: Record<string, string> = {
    qa: 'qa',
    dev: 'dev',
    production: 'production',
};

// Map app IDs to their secret name segment
// Defaults to the app ID itself if not listed here
const APP_SECRET_NAMES: Record<string, string> = {
    'pam-sms': 'pam',
    'pam-api': 'pamapi',
    'tad': 'tad',
    'rmx': 'rmx',
    'remora': 'pamadmin',
    'psi': 'psi',
};

let smClient: SecretsManagerClient | null = null;

function getClient(): SecretsManagerClient {
    if (smClient) return smClient;
    smClient = new SecretsManagerClient({
        region: REGION,
        credentials: fromNodeProviderChain(),
    });
    return smClient;
}

export function invalidateClient() {
    smClient = null;
}

export interface SecretEntry {
    key: string;
    value: string;
}

export interface SecretsResult {
    secretId: string;
    entries: SecretEntry[];
    error?: string;
}

/**
 * Fetch secrets for a given app from AWS Secrets Manager.
 * Secret ID format: pam/{env}/{appSecretName}
 */
export async function getAppSecrets(
    appId: string,
    env: 'qa' | 'dev'
): Promise<SecretsResult> {
    const envSegment = ENV_MAP[env] ?? env;
    const appSegment = APP_SECRET_NAMES[appId] ?? appId;
    const secretId = `pam/${envSegment}/${appSegment}`;

    const client = getClient();

    try {
        const command = new GetSecretValueCommand({ SecretId: secretId });
        const response = await client.send(command);

        const raw = response.SecretString;
        if (!raw) {
            return { secretId, entries: [], error: 'Secret has no string value' };
        }

        let parsed: Record<string, string>;
        try {
            parsed = JSON.parse(raw);
        } catch {
            // Not JSON — return as a single entry
            return {
                secretId,
                entries: [{ key: 'RAW_VALUE', value: raw }],
            };
        }

        const entries: SecretEntry[] = Object.entries(parsed)
            .map(([key, value]) => ({ key, value: String(value) }))
            .sort((a, b) => a.key.localeCompare(b.key));

        return { secretId, entries };
    } catch (err: any) {
        // Invalidate client on auth errors so next call retries
        const name = err.name || '';
        if (
            name === 'ExpiredTokenException' ||
            name === 'UnauthorizedException' ||
            name === 'InvalidClientTokenId' ||
            (err.message || '').includes('security token') ||
            (err.message || '').includes('expired')
        ) {
            invalidateClient();
            throw err; // Re-throw so the route layer can return 401
        }

        if (err instanceof ResourceNotFoundException) {
            return {
                secretId,
                entries: [],
                error: `Secret not found: ${secretId}`,
            };
        }

        return {
            secretId,
            entries: [],
            error: err.message || 'Unknown error fetching secret',
        };
    }
}
