import { SecretsManagerClient, GetSecretValueCommand, ResourceNotFoundException } from '@aws-sdk/client-secrets-manager';
import { withAwsRecovery, getCredentialProvider } from './auth.js';

const REGION = 'us-east-1';

// Map environment names to their secret path segment
const ENV_MAP: Record<string, string> = {
    qa: 'qa',
    dev: 'dev',
    prod: 'production',
};

// Map app IDs to their secret name segment
// Defaults to the app ID itself if not listed here
const APP_SECRET_NAMES: Record<string, string> = {
    'pam-sms': 'pam',
    'pam-api': 'pamapi',
    'tad': 'tad',
    'rmx': 'rmx',
    'remora': 'pamadmin',
    'ag-admin': 'gatewayadmin',
    'agency-gateway-api': 'gatewayapi',
};

// Apps with a custom full-path template (env is substituted for {env})
// PSI uses /pam/psi/{env} (Spring Cloud AWS: prefix=/pam, name=psi, profile-separator=/)
const APP_SECRET_CUSTOM_PATHS: Record<string, string> = {
    'psi': '/pam/psi/{env}',
};

const smClients: Record<string, SecretsManagerClient> = {};

function getClient(env: 'qa' | 'dev' | 'prod', forceRefetch: boolean = false): SecretsManagerClient {
    if (smClients[env] && !forceRefetch) return smClients[env];
    smClients[env] = new SecretsManagerClient({
        region: REGION,
        credentials: getCredentialProvider(env, forceRefetch),
    });
    return smClients[env];
}

export function invalidateClient() {
    for (const key of Object.keys(smClients)) {
        delete smClients[key];
    }
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
    env: 'qa' | 'dev' | 'prod'
): Promise<SecretsResult> {
    const envSegment = ENV_MAP[env] ?? env;
    // Check for a custom full-path override first (e.g. PSI uses /pam/psi/{env})
    const customPath = APP_SECRET_CUSTOM_PATHS[appId];
    const secretId = customPath
        ? customPath.replace('{env}', envSegment)
        : `pam/${envSegment}/${APP_SECRET_NAMES[appId] ?? appId}`;

    return withAwsRecovery(
        async (forceRefetch) => {
            const client = getClient(env, forceRefetch);
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
        },
        () => {
            invalidateClient();
        }
    ).catch((err: any) => {
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
    });
}
