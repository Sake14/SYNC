# Сторонние зависимости

Список runtime-зависимостей сформирован из package-lock.json SYNC.
Далее перечислены также вложенные версии. Полные тексты лицензий и NOTICE
сохраняются в npm-пакетах; эта таблица их не заменяет. Перед распространением
сборки сохраняйте условия и уведомления используемых библиотек.

Прямые зависимости включают MIT (React, Next.js, Express, Socket.IO, Zod,
Zustand, Tailwind CSS, nanoid, qrcode), Apache-2.0 (class-variance-authority)
и ISC (lucide-react), BSD-2-Clause (dotenv). Инструменты разработки и их лицензии
также записаны в lock-файле; Playwright и TypeScript используют Apache-2.0.

При изменении зависимостей обновляйте перечень.

В таблицу входят optional binaries всех платформ; это не состав конкретного образа.
Sharp использует Apache-2.0; платформенные libvips-компоненты имеют LGPL-3.0-or-later
и составные выражения лицензий. caniuse-lite содержит данные CC-BY-4.0.
Node.js, Caddy и базовая ОС образов также содержат собственные уведомления.
Пакеты с устаревшим полем licenses перечислены по установленным package.json.

| Путь в lock-файле | Версия | Лицензия из npm metadata |
| --- | --- | --- |
| node_modules/@borewit/text-codec | 0.2.2 | MIT |
| node_modules/@img/colour | 1.1.0 | MIT |
| node_modules/@img/sharp-darwin-arm64 | 0.35.5 | Apache-2.0 |
| node_modules/@img/sharp-darwin-x64 | 0.35.5 | Apache-2.0 |
| node_modules/@img/sharp-freebsd-wasm32 | 0.35.5 | Apache-2.0 |
| node_modules/@img/sharp-libvips-darwin-arm64 | 1.3.4 | LGPL-3.0-or-later |
| node_modules/@img/sharp-libvips-darwin-x64 | 1.3.4 | LGPL-3.0-or-later |
| node_modules/@img/sharp-libvips-linux-arm | 1.3.4 | LGPL-3.0-or-later |
| node_modules/@img/sharp-libvips-linux-arm64 | 1.3.4 | LGPL-3.0-or-later |
| node_modules/@img/sharp-libvips-linux-ppc64 | 1.3.4 | LGPL-3.0-or-later |
| node_modules/@img/sharp-libvips-linux-riscv64 | 1.3.4 | LGPL-3.0-or-later |
| node_modules/@img/sharp-libvips-linux-s390x | 1.3.4 | LGPL-3.0-or-later |
| node_modules/@img/sharp-libvips-linux-x64 | 1.3.4 | LGPL-3.0-or-later |
| node_modules/@img/sharp-libvips-linuxmusl-arm64 | 1.3.4 | LGPL-3.0-or-later |
| node_modules/@img/sharp-libvips-linuxmusl-x64 | 1.3.4 | LGPL-3.0-or-later |
| node_modules/@img/sharp-linux-arm | 0.35.5 | Apache-2.0 |
| node_modules/@img/sharp-linux-arm64 | 0.35.5 | Apache-2.0 |
| node_modules/@img/sharp-linux-ppc64 | 0.35.5 | Apache-2.0 |
| node_modules/@img/sharp-linux-riscv64 | 0.35.5 | Apache-2.0 |
| node_modules/@img/sharp-linux-s390x | 0.35.5 | Apache-2.0 |
| node_modules/@img/sharp-linux-x64 | 0.35.5 | Apache-2.0 |
| node_modules/@img/sharp-linuxmusl-arm64 | 0.35.5 | Apache-2.0 |
| node_modules/@img/sharp-linuxmusl-x64 | 0.35.5 | Apache-2.0 |
| node_modules/@img/sharp-wasm32 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT |
| node_modules/@img/sharp-wasm32/node_modules/@emnapi/runtime | 1.11.3 | MIT |
| node_modules/@img/sharp-webcontainers-wasm32 | 0.35.5 | Apache-2.0 |
| node_modules/@img/sharp-win32-arm64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later |
| node_modules/@img/sharp-win32-ia32 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later |
| node_modules/@img/sharp-win32-x64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later |
| node_modules/@next/env | 16.4.0 | MIT |
| node_modules/@next/swc-darwin-arm64 | 16.4.0 | MIT |
| node_modules/@next/swc-darwin-x64 | 16.4.0 | MIT |
| node_modules/@next/swc-linux-arm64-gnu | 16.4.0 | MIT |
| node_modules/@next/swc-linux-arm64-musl | 16.4.0 | MIT |
| node_modules/@next/swc-linux-x64-gnu | 16.4.0 | MIT |
| node_modules/@next/swc-linux-x64-musl | 16.4.0 | MIT |
| node_modules/@next/swc-win32-arm64-msvc | 16.4.0 | MIT |
| node_modules/@next/swc-win32-x64-msvc | 16.4.0 | MIT |
| node_modules/@playwright/test | 1.64.0 | Apache-2.0 |
| node_modules/@radix-ui/react-compose-refs | 1.1.5 | MIT |
| node_modules/@radix-ui/react-slot | 1.4.0 | MIT |
| node_modules/@socket.io/component-emitter | 3.1.2 | MIT |
| node_modules/@swc/helpers | 0.5.23 | Apache-2.0 |
| node_modules/@tokenizer/inflate | 0.4.1 | MIT |
| node_modules/@tokenizer/token | 0.3.0 | MIT |
| node_modules/@types/cors | 2.8.19 | MIT |
| node_modules/@types/node | 22.20.5 | MIT |
| node_modules/@types/react | 19.3.0 | MIT |
| node_modules/@types/ws | 8.18.2 | MIT |
| node_modules/accepts | 2.0.0 | MIT |
| node_modules/ansi-regex | 5.0.1 | MIT |
| node_modules/ansi-styles | 4.3.0 | MIT |
| node_modules/append-field | 1.0.0 | MIT |
| node_modules/baseline-browser-mapping | 2.11.28 | Apache-2.0 |
| node_modules/body-parser | 2.3.0 | MIT |
| node_modules/busboy | 1.6.0 | MIT |
| node_modules/bytes | 3.1.2 | MIT |
| node_modules/call-bind-apply-helpers | 1.0.2 | MIT |
| node_modules/call-bound | 1.0.4 | MIT |
| node_modules/camelcase | 5.3.1 | MIT |
| node_modules/caniuse-lite | 1.0.30001815 | CC-BY-4.0 |
| node_modules/class-variance-authority | 0.7.1 | Apache-2.0 |
| node_modules/client-only | 0.0.1 | MIT |
| node_modules/clsx | 2.1.1 | MIT |
| node_modules/color-convert | 2.0.1 | MIT |
| node_modules/color-name | 1.1.4 | MIT |
| node_modules/content-disposition | 2.0.1 | MIT |
| node_modules/content-type | 2.1.0 | MIT |
| node_modules/cookie | 0.7.2 | MIT |
| node_modules/cookie-signature | 1.2.2 | MIT |
| node_modules/cors | 2.8.6 | MIT |
| node_modules/csstype | 3.2.3 | MIT |
| node_modules/debug | 4.4.3 | MIT |
| node_modules/decamelize | 1.2.0 | MIT |
| node_modules/depd | 2.0.0 | MIT |
| node_modules/detect-libc | 2.1.2 | Apache-2.0 |
| node_modules/dijkstrajs | 1.0.3 | MIT |
| node_modules/dotenv | 17.4.2 | BSD-2-Clause |
| node_modules/dunder-proto | 1.0.1 | MIT |
| node_modules/ee-first | 1.1.1 | MIT |
| node_modules/encodeurl | 2.0.0 | MIT |
| node_modules/engine.io | 6.6.11 | MIT |
| node_modules/engine.io-client | 6.6.7 | MIT |
| node_modules/engine.io-parser | 5.2.3 | MIT |
| node_modules/engine.io/node_modules/accepts | 1.3.8 | MIT |
| node_modules/engine.io/node_modules/mime-db | 1.52.0 | MIT |
| node_modules/engine.io/node_modules/mime-types | 2.1.35 | MIT |
| node_modules/engine.io/node_modules/negotiator | 0.6.3 | MIT |
| node_modules/es-define-property | 1.0.1 | MIT |
| node_modules/es-errors | 1.3.0 | MIT |
| node_modules/es-object-atoms | 1.1.2 | MIT |
| node_modules/escape-html | 1.0.3 | MIT |
| node_modules/etag | 1.8.1 | MIT |
| node_modules/express | 5.3.0 | MIT |
| node_modules/file-type | 22.1.1 | MIT |
| node_modules/finalhandler | 2.1.1 | MIT |
| node_modules/forwarded | 0.2.0 | MIT |
| node_modules/fresh | 2.0.0 | MIT |
| node_modules/function-bind | 1.1.2 | MIT |
| node_modules/get-caller-file | 2.0.5 | ISC |
| node_modules/get-intrinsic | 1.3.0 | MIT |
| node_modules/get-proto | 1.0.1 | MIT |
| node_modules/gopd | 1.2.0 | MIT |
| node_modules/has-symbols | 1.1.0 | MIT |
| node_modules/hasown | 2.0.4 | MIT |
| node_modules/http-errors | 2.0.1 | MIT |
| node_modules/iconv-lite | 0.7.3 | MIT |
| node_modules/ieee754 | 1.2.1 | BSD-3-Clause |
| node_modules/inherits | 2.0.4 | ISC |
| node_modules/ipaddr.js | 1.9.1 | MIT |
| node_modules/is-fullwidth-code-point | 3.0.0 | MIT |
| node_modules/is-promise | 4.0.0 | MIT |
| node_modules/lucide-react | 0.577.0 | ISC |
| node_modules/math-intrinsics | 1.1.0 | MIT |
| node_modules/media-typer | 1.1.1 | MIT |
| node_modules/merge-descriptors | 2.0.0 | MIT |
| node_modules/mime-db | 1.54.0 | MIT |
| node_modules/mime-types | 3.0.2 | MIT |
| node_modules/ms | 2.1.3 | MIT |
| node_modules/multer | 2.4.0 | MIT |
| node_modules/multer/node_modules/media-typer | 0.3.0 | MIT |
| node_modules/multer/node_modules/mime-db | 1.52.0 | MIT |
| node_modules/multer/node_modules/mime-types | 2.1.35 | MIT |
| node_modules/multer/node_modules/type-is | 1.6.18 | MIT |
| node_modules/music-metadata | 12.1.0 | MIT |
| node_modules/music-metadata/node_modules/content-type | 3.1.1 | MIT |
| node_modules/music-metadata/node_modules/media-typer | 2.0.0 | MIT |
| node_modules/nanoid | 3.3.20 | MIT |
| node_modules/negotiator | 1.1.0 | MIT |
| node_modules/next | 16.4.0 | MIT |
| node_modules/next/node_modules/postcss | 8.5.23 | MIT |
| node_modules/object-assign | 4.1.1 | MIT |
| node_modules/object-inspect | 1.13.4 | MIT |
| node_modules/on-finished | 2.4.1 | MIT |
| node_modules/once | 1.4.0 | ISC |
| node_modules/p-try | 2.2.0 | MIT |
| node_modules/parseurl | 1.3.3 | MIT |
| node_modules/path-exists | 4.0.0 | MIT |
| node_modules/path-to-regexp | 8.4.2 | MIT |
| node_modules/picocolors | 1.1.1 | ISC |
| node_modules/playwright | 1.64.0 | Apache-2.0 |
| node_modules/playwright-core | 1.64.0 | Apache-2.0 |
| node_modules/pngjs | 5.0.0 | MIT |
| node_modules/proxy-addr | 2.0.8 | MIT |
| node_modules/qrcode | 1.5.4 | MIT |
| node_modules/qrcode/node_modules/cliui | 6.0.0 | ISC |
| node_modules/qrcode/node_modules/find-up | 4.1.0 | MIT |
| node_modules/qrcode/node_modules/locate-path | 5.0.0 | MIT |
| node_modules/qrcode/node_modules/p-limit | 2.3.0 | MIT |
| node_modules/qrcode/node_modules/p-locate | 4.1.0 | MIT |
| node_modules/qrcode/node_modules/wrap-ansi | 6.2.0 | MIT |
| node_modules/qrcode/node_modules/y18n | 4.0.3 | ISC |
| node_modules/qrcode/node_modules/yargs | 15.4.1 | MIT |
| node_modules/qrcode/node_modules/yargs-parser | 18.1.3 | ISC |
| node_modules/qs | 6.16.0 | BSD-3-Clause |
| node_modules/range-parser | 1.3.0 | MIT |
| node_modules/raw-body | 3.0.2 | MIT |
| node_modules/react | 19.3.0 | MIT |
| node_modules/react-dom | 19.3.0 | MIT |
| node_modules/require-directory | 2.1.1 | MIT |
| node_modules/require-main-filename | 2.0.0 | ISC |
| node_modules/router | 2.2.0 | MIT |
| node_modules/safer-buffer | 2.1.2 | MIT |
| node_modules/scheduler | 0.28.0 | MIT |
| node_modules/send | 1.2.1 | MIT |
| node_modules/serve-static | 2.2.1 | MIT |
| node_modules/set-blocking | 2.0.0 | ISC |
| node_modules/setprototypeof | 1.2.0 | ISC |
| node_modules/sharp | 0.35.5 | Apache-2.0 |
| node_modules/sharp/node_modules/semver | 7.8.5 | ISC |
| node_modules/side-channel | 1.1.1 | MIT |
| node_modules/side-channel-list | 1.0.1 | MIT |
| node_modules/side-channel-map | 1.0.1 | MIT |
| node_modules/side-channel-weakmap | 1.0.2 | MIT |
| node_modules/socket.io | 4.8.4 | MIT |
| node_modules/socket.io-adapter | 2.5.8 | MIT |
| node_modules/socket.io-client | 4.8.4 | MIT |
| node_modules/socket.io-parser | 4.2.7 | MIT |
| node_modules/socket.io/node_modules/accepts | 1.3.8 | MIT |
| node_modules/socket.io/node_modules/mime-db | 1.52.0 | MIT |
| node_modules/socket.io/node_modules/mime-types | 2.1.35 | MIT |
| node_modules/socket.io/node_modules/negotiator | 0.6.3 | MIT |
| node_modules/source-map-js | 1.2.2 | BSD-3-Clause |
| node_modules/statuses | 2.0.2 | MIT |
| node_modules/streamsearch | 1.1.0 | MIT |
| node_modules/string-width | 4.2.3 | MIT |
| node_modules/string-width/node_modules/emoji-regex | 8.0.0 | MIT |
| node_modules/strip-ansi | 6.0.1 | MIT |
| node_modules/strtok3 | 10.3.5 | MIT |
| node_modules/styled-jsx | 5.1.6 | MIT |
| node_modules/tailwind-merge | 3.7.0 | MIT |
| node_modules/toidentifier | 1.0.1 | MIT |
| node_modules/token-types | 6.1.2 | MIT |
| node_modules/tslib | 2.8.1 | 0BSD |
| node_modules/type-is | 2.1.0 | MIT |
| node_modules/uint8array-extras | 1.6.0 | MIT |
| node_modules/undici-types | 6.21.0 | MIT |
| node_modules/unpipe | 1.0.0 | MIT |
| node_modules/vary | 1.1.2 | MIT |
| node_modules/which-module | 2.0.1 | ISC |
| node_modules/win-guid | 0.2.1 | MIT |
| node_modules/wrappy | 1.0.2 | ISC |
| node_modules/ws | 8.21.3 | MIT |
| node_modules/xmlhttprequest-ssl | 2.1.2 | MIT |
| node_modules/zod | 4.6.5 | MIT |
| node_modules/zustand | 5.0.15 | MIT |
