# HDDT v1.2.1-r12 — Docker production conversion report

## Base

- Input source: HDDT v1.2.1 release revision r11.
- Output app version remains `1.2.1`.
- Output source/deployment revision: `r12`.

## Docker-specific changes

1. Added `Dockerfile` multi-stage build on Node 22 Debian slim.
2. Added `.dockerignore`.
3. Added Portainer Stack compose and environment template.
4. Added VM preparation/build, backup, restore and update scripts.
5. Added Docker-aware server startup:
   - configurable bind host;
   - fixed container port;
   - no browser spawn;
   - persistent `HDDT_APP_DATA_DIR` and `HDDT_DATA_ROOT`;
   - stale `runtime.json` / `instance.lock` cleanup across container PID namespaces.
6. Extended Origin validation with exact `HDDT_ALLOWED_ORIGINS` allow-list while retaining loopback acceptance.
7. Portable/non-Docker defaults remain loopback-only and unchanged unless deployment environment variables are set.

## Verification performed in packaging environment

- TypeScript/TSX syntax parse/transpile: **81 files, 0 errors**.
- `scripts/*.mjs` syntax: **7 files, 0 errors**.
- `deploy/*.sh`: **4 files, 0 errors** with `bash -n`.
- Docker/Portainer YAML: **3 compose/stack files parsed successfully** with YAML parser.
- ZIP integrity: verified after packaging.

## Not executed here

The packaging environment has no Docker daemon connected to VM300 and cannot log in to `10.10.2.45`. Therefore the following are explicitly production acceptance steps, not pre-claimed PASS items:

- actual `docker build` on VM300;
- actual Portainer deployment;
- LAN Origin acceptance at `http://10.10.2.45:8088`;
- live GDT login/query;
- live TVAN PDF/CAPTCHA flows.

Run the supplied `docs/DOCKER_PORTAINER_VM300_v1.2.1-r12.md` procedure on VM300.
