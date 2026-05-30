import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './test',
    testMatch: /.*\.test\.ts/,
    fullyParallel: false,
    workers: 1,
    reporter: 'list',
    use: {
        headless: true
    }
});
