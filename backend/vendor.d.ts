declare module 'qrcode-terminal/vendor/QRCode/index.js' {
  class QRCode {
    constructor(version: number, level: number);
    addData(data: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
  }
  export = QRCode;
}
declare module 'qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js' {
  const levels: { L: number; M: number; Q: number; H: number };
  export = levels;
}
