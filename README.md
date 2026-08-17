# OMP Web

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

Local browser UI for the OMP coding agent. OMP Web uses the same local configuration and session files as the OMP runtime, so you can browse and resume conversations, run agent turns, configure models and resources, and inspect project files from a browser.

## Quick Start

OMP Web requires Node.js 22.19.0 or newer.

```bash
npx @agegr/omp-web@latest
```

The CLI opens a browser after the server is ready. If it does not, open [http://127.0.0.1:30142](http://127.0.0.1:30142). OMP Web listens only on `127.0.0.1` by default.

To install the `omp-web` command globally:

```bash
npm install -g @agegr/omp-web@latest
omp-web
```

## Configuration

| Option or environment variable | Purpose | Default |
| --- | --- | --- |
| `--port <port>`, `-p <port>`, or `PORT` | Server port | `30142` |
| `--hostname <host>`, `-H <host>`, or `OMP_WEB_HOSTNAME` | Bind hostname | `127.0.0.1` |
| `--no-open` or `OMP_WEB_NO_OPEN=1` | Do not open a browser automatically | Browser opens |
| `OMP_WEB_ALLOWED_HOSTS` | Additional exact proxy or custom hostnames, comma-separated | Unset |
| `OMP_WEB_PASSWORD` | Enable HTTP Basic Auth; the username is always `omp` | Authentication disabled |

## Development

```bash
npm install
npm run dev    # port 30142
```

Do not run `next build` during normal development.

## License

[MIT](./LICENSE)