import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

async function test() {
    process.env.AWS_ACCESS_KEY_ID = 'FAKE_KEY_1';
    process.env.AWS_SECRET_ACCESS_KEY = 'FAKE_SECRET_1';
    process.env.AWS_SESSION_TOKEN = 'FAKE_SESSION_1';

    const provider1 = fromNodeProviderChain();
    try {
        const creds1 = await provider1();
        console.log("Creds 1:", creds1.accessKeyId);
    } catch (e) {
        console.log("Error 1", e);
    }

    console.log("Deleting env vars");
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SESSION_TOKEN;

    const provider2 = fromNodeProviderChain();
    try {
        const creds2 = await provider2();
        console.log("Creds 2:", creds2.accessKeyId);
    } catch (e) {
        console.log("Error 2", e);
    }
}
test();
