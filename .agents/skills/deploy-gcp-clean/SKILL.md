---
name: deploy-gcp-clean
description: Use when preparing or deploying this project's Cloud Run service on Windows, preserving an ASCII staging path and excluding local secrets.
---

# Deploy GCP Clean

Use `deploy/deploy_cloud_run.py` as the only Cloud Run deployment entrypoint. Source files live in `backend/`; the Dockerfile lives in `deploy/`. Locate the project root from the script path, not the current working directory.

## Preparation

1. Run isolated checks: `python -m unittest discover -s tests -v` and `node tests/test_gas_archive.js`.
2. Read `deploy/README.md` and the maintenance handoff linked by `.agents/AGENTS.md`. Review the actual diff, current Cloud Run traffic and tags, GAS Web App version and Hosting release. Recheck remote state instead of treating handoff versions as current.
3. Before a namespace or lock-protocol cutover, obtain explicit approval to stop schedules and isolate old write entrypoints; verify in-flight work has ended. A zero-traffic deployment alone does not stop writers. If approval excludes a required operation, stop and report it rather than widening scope.
4. Stage with `python deploy/deploy_cloud_run.py`. This uses `C:\Users\hilla\Desktop\newlngship_clean`; staging outside the workspace requires approval in Codex.
5. Verify only app.py, main.py, requirements.txt, src Python modules, Dockerfile and ignore files are present. Never copy config.json, env.json, service_account.json, .env, local archives or OCR samples. Cloud credentials come from Secret Manager or environment variables.

## Authorized deployment

Only after explicit authorization run `python deploy/deploy_cloud_run.py --deploy`. The legacy PowerShell helper in this skill forwards to that script; it is build-only unless `-Deploy` is supplied.

Preserve service `forecast-api-test`, region `asia-southeast1` and `FIREBASE_RTDB_PREFIX=/formal`. The authorized namespace cutover completed on 2026-11-08; `/test` is retained legacy data, not a disposable sandbox or a fallback write target.

Default deployment creates `MAINTENANCE_MODE=true`, `--no-traffic` and the `codex-preflight` tag. The tagged URL is public even without default traffic. Verify the new revision settings and maintenance responses before separately authorized traffic switching.

Only with explicit maintenance-exit deployment approval use `python deploy/deploy_cloud_run.py --deploy --resume`. This creates `MAINTENANCE_MODE=false` at zero traffic without adding a tag. Verify the exact revision settings, then switch traffic only within the user's authorization. Check the production URL after switching; an existing preflight tag can still point to the maintenance revision. Restore GAS and Cloud Run in an approved order; schedule restoration requires its own approval. Do not force forecasts, archives or POB events as deployment probes.

Before building, check Registry usage and estimated growth against `.agents/AGENTS.md`, including the migration-only temporary capacity exception while acceptance is pending. Do not automatically remove images after deployment. Retain required rollback images; remote cleanup requires approval of exact digests.

GAS changes require both an authorized `clasp push` and updating the existing Web App deployment version from `gas/`. Scheduled triggers use HEAD, while external calls use the deployed version. Do not create a replacement GAS project.
