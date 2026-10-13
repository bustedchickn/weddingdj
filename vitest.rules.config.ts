import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/firestore.rules.test.ts','tests/requests.firestore.test.ts',...(process.env.FIREBASE_AUTH_EMULATOR_HOST?['tests/auth.firestore.test.ts']:[])],hookTimeout:30000,testTimeout:60000,fileParallelism:false,reporters:['default','json'],outputFile:{json:'test-results/firestore-rules.json'}}});
