import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { withAwsRecovery, getCredentialProvider } from './auth.js';

export interface PsiPayloadFile {
    key: string;
    folder: string;
    filename: string;
    lastModified: string;
    size: number;
}

export async function listPsiPayloads(env: 'qa' | 'dev'): Promise<PsiPayloadFile[]> {
    return withAwsRecovery(
        async (forceRefetch) => {
            const s3 = new S3Client({
                region: 'us-east-1',
                credentials: getCredentialProvider(forceRefetch)
            });
            const prefix = `psi/last_updated/${env}/tmp/`;

            let isTruncated = true;
            let continuationToken: string | undefined = undefined;
            const allContents: any[] = [];

            while (isTruncated) {
                const command = new ListObjectsV2Command({
                    Bucket: 'adsales-appdev-config',
                    Prefix: prefix,
                    ContinuationToken: continuationToken,
                });

                const response: any = await s3.send(command as any);
                if (response.Contents) {
                    allContents.push(...response.Contents);
                }

                isTruncated = response.IsTruncated ?? false;
                continuationToken = response.NextContinuationToken;
            }

            if (allContents.length === 0) {
                return [];
            }

            const files: PsiPayloadFile[] = allContents
                .filter(obj => obj.Key && obj.Key !== prefix && obj.Size !== undefined && obj.Size > 0)
                .map(obj => {
                    const parts = obj.Key!.substring(prefix.length).split('/');
                    return {
                        key: obj.Key!,
                        folder: parts.length > 1 ? parts[parts.length - 2] : '',
                        filename: parts[parts.length - 1],
                        lastModified: obj.LastModified ? obj.LastModified.toISOString() : new Date().toISOString(),
                        size: obj.Size!
                    };
                })
                .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

            return files;
        },
        () => { /* No local client cache to clear */ }
    );
}

export async function getPsiPayloadContent(key: string): Promise<string> {
    return withAwsRecovery(
        async (forceRefetch) => {
            const s3 = new S3Client({
                region: 'us-east-1',
                credentials: getCredentialProvider(forceRefetch)
            });

            const command = new GetObjectCommand({
                Bucket: 'adsales-appdev-config',
                Key: key,
            });

            const response: any = await s3.send(command as any);

            if (!response.Body) {
                throw new Error('Empty file content');
            }

            const str = await response.Body.transformToString('utf-8');
            return str;
        },
        () => { /* No local client cache to clear */ }
    );
}
