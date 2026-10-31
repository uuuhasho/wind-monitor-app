---
name: deploy-gcp-clean
description: Use when preparing or deploying this project's Cloud Run service on Windows, preserving an ASCII staging path and excluding local secrets.
---

# Deploy GCP Clean

Use `deploy/deploy_cloud_run.py` as the only Cloud Run deployment entrypoint. Source files live in `backend/`; the Dockerfile lives in `deploy/`. Locate the project root from the script path, not the current working directory.

## Preparation

1. Run isolated checks: `python -m unittest discover -s tests -v` and `node tests/test_gas_archive.js`.
2. Review the actual diff and previous Cloud Run revision, GAS Web App version and Hosting release for rollback.
3. Stop scheduled triggers before a version transition so an older worker cannot publish outside the new lock protocol.
4. Stage with `python deploy/deploy_cloud_run.py`. This uses `C:\Users\hilla\Desktop\newlngship_clean`; staging outside the workspace requires approval in Codex.
5. Verify only app.py, main.py, requirements.txt, src Python modules, Dockerfile and ignore files are present. Never copy config.json, env.json, service_account.json, .env, local archives or OCR samples. Cloud credentials come from Secret Manager or environment variables.

## Authorized deployment

Only after explicit authorization run `python deploy/deploy_cloud_run.py --deploy`. The legacy PowerShell helper in this skill forwards to that script; it is build-only unless `-Deploy` is supplied.

Preserve service `forecast-api-test`, region `asia-southeast1` and `FIREBASE_RTDB_PREFIX=/test`. The /test namespace is actively used by the APP.

Do not automatically remove Artifact Registry images after deployment. Retain prior revisions for rollback; remote cleanup requires separate authorization.

GAS changes require both an authorized `clasp push` and updating the existing Web App deployment version from `gas/`. Scheduled triggers use HEAD, while external calls use the deployed version. Do not create a replacement GAS project.
