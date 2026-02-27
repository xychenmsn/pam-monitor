import { fromIni } from '@aws-sdk/credential-providers';
try {
    const provider = fromIni({ ignoreCache: true });
    console.log("ignoreCache is accepted");
} catch (e) {
    console.log("Error:", e);
}
