import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('Ingress & Reverse Proxy 500MB Upload Capacity', () => {
  const rootDir = path.resolve(__dirname, '../../');

  test('K8s dev overlay ingress configures 500m proxy-body-size', async () => {
    const devOverlayPath = path.resolve(rootDir, 'k8s/overlays/dev/kustomization.yaml');
    expect(fs.existsSync(devOverlayPath)).toBe(true);
    const content = fs.readFileSync(devOverlayPath, 'utf8');
    expect(content).toMatch(/nginx\.ingress\.kubernetes\.io\/proxy-body-size:\s*["']500m["']/);
  });

  test('Reverse-proxy and CI Nginx configs configure client_max_body_size 500M', async () => {
    const nginxConfigs = [
      path.resolve(rootDir, 'certs/nginx.conf'),
      path.resolve(rootDir, 'certs/nginx.ci.conf'),
      path.resolve(rootDir, 'certs/nginx.ci.k8s.conf'),
      path.resolve(rootDir, 'k8s/base/files/nginx.conf'),
      path.resolve(rootDir, 'k8s/overlays/ci/files/nginx.conf'),
    ];

    for (const confPath of nginxConfigs) {
      expect(fs.existsSync(confPath)).toBe(true);
      const content = fs.readFileSync(confPath, 'utf8');
      expect(content).toMatch(
        /client_max_body_size\s+500M;/,
        `Missing client_max_body_size 500M in ${path.basename(confPath)}`
      );
    }
  });
});
