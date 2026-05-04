#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const cfg = JSON.parse(
  fs.readFileSync(path.join(root, 'branding.config.json'), 'utf8')
);

const { productName, companyEn, companyZh, supportEmail, copyrightYear } = cfg;

function replaceInFile(file, replacers) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [pattern, value] of replacers) {
    text = text.replace(pattern, value);
  }
  fs.writeFileSync(file, text);
}

// 1) electron-builder metadata
replaceInFile(path.join(root, 'electron-builder.yml'), [
  [/^productName:\s.*$/m, `productName: ${productName}`],
  [
    /^copyright:\s.*$/m,
    `copyright: Copyright © ${copyrightYear} ${companyEn} (${companyZh}). All rights reserved.`,
  ],
]);

// 2) EULA
replaceInFile(path.join(root, 'resources/legal/EULA.rtf'), [
  [
    /\\b .* End User License Agreement \(EULA\) \/ 最终用户许可协议\\b0\\par/,
    `\\b ${productName} End User License Agreement (EULA) / 最终用户许可协议\\b0\\par`,
  ],
  [
    /This End User License Agreement \("Agreement"\) is a legal agreement between you and .* \("Company"\) for the use of .* \(the "Software"\)\./,
    `This End User License Agreement ("Agreement") is a legal agreement between you and ${companyEn} ("Company") for the use of ${productName} (the "Software").`,
  ],
  [
    /本协议是您与.*（"公司"，英文名：.*）之间关于使用.*（"软件"）的法律协议。/,
    `本协议是您与${companyZh}（"公司"，英文名：${companyEn}）之间关于使用${productName}（"软件"）的法律协议。`,
  ],
  [/For commercial support or licensing inquiries: .*\\par/, `For commercial support or licensing inquiries: ${supportEmail}\\par`],
  [/商业支持或授权咨询：.*\\par/, `商业支持或授权咨询：${supportEmail}\\par`],
]);

console.log('Branding applied from branding.config.json');
