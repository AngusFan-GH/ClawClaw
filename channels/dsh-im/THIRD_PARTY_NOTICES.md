# Third-party notices

This package incorporates and adapts the client presentation of
`@xmanrui/dsh-im` 4.20.2 and delegates its Host runtime to that package.

`@xmanrui/dsh-im` is distributed under the MIT License:

Copyright (c) 2026 xmanrui

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

QQ QR binding uses Tencent Connect's official
`@tencent-connect/qqbot-connector` 1.2.0 package as an external runtime
dependency. Its npm metadata declares `UNLICENSED`; redistribution is included
under the distributor's separately obtained authorization. QQ messaging uses
`@tencent-connect/qqbot-nodejs` 1.0.4, which is distributed under the MIT
License.

The WhatsApp channel uses `@whiskeysockets/baileys` 7.0.0-rc14 to implement
WhatsApp Web linked-device QR login and messaging. Baileys is distributed
under the MIT License. Its Signal protocol runtime includes GPL-3.0 licensed
components; corresponding source and license obligations must be preserved by
downstream distributors. This is an unofficial WhatsApp Web integration, so
users should use a dedicated bot number and expect protocol changes to require
connector updates.
