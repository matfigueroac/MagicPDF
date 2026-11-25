import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', workers: 1, timeout: 45000,
  outputDir: 'work/test-results', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3002', viewport: {width:1440,height:1000}, launchOptions: { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } },
  webServer: {command:'node tests/start-server.cjs',url:'http://127.0.0.1:3002/api/info/__health',reuseExistingServer:false},
});
