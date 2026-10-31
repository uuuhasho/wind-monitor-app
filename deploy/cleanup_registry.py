import json
import subprocess
import sys

def run_cmd(cmd):
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=True)
    if result.returncode != 0:
        return None
    return result.stdout.strip()

def cleanup():
    project = "newlngship"
    repositories = [
        {"location": "asia-southeast1", "name": "cloud-run-source-deploy"},
        {"location": "asia-east1", "name": "cloud-run-source-deploy"}
    ]

    print("=== Google Artifact Registry Automatic 500MB Cleanup ===")

    for repo in repositories:
        loc = repo["location"]
        repo_name = repo["name"]
        print(f"\nScanning Repository: {repo_name} in {loc}...")

        # Get list of packages
        packages_json = run_cmd(f'gcloud artifacts packages list --repository={repo_name} --location={loc} --project={project} --format="json"')
        if not packages_json:
            print(f"No packages found in {repo_name} ({loc}).")
            continue

        packages = json.loads(packages_json)
        for pkg in packages:
            # pkg example: {"name": "projects/newlngship/.../packages/forecast-api-test"}
            pkg_name = pkg["name"].split("/packages/")[-1]
            print(f"\nChecking package: {pkg_name}...")

            # Check if this package has an active Cloud Run service
            active_img = run_cmd(f'gcloud run services describe {pkg_name} --project={project} --region={loc} --format="value(spec.template.spec.containers[0].image)"')
            
            active_sha = None
            if active_img:
                print(f"Active Cloud Run service '{pkg_name}' found. Active image: {active_img}")
                if "@sha256:" in active_img:
                    active_sha = active_img.split("@sha256:")[-1].strip()
            else:
                print(f"No active Cloud Run service '{pkg_name}' running in {loc}.")

            # List all versions for this package
            versions_json = run_cmd(f'gcloud artifacts versions list --repository={repo_name} --location={loc} --package={pkg_name} --project={project} --format="json"')
            if not versions_json:
                print(f"No versions found for package {pkg_name}.")
                continue

            versions = json.loads(versions_json)
            # Sort by createTime (oldest first)
            versions.sort(key=lambda x: x.get("createTime", ""))

            # If there is no active Cloud Run service, we can delete all versions (or keep the latest one as fallback)
            # Let's keep the latest version if there's no active Cloud Run service, just in case,
            # but delete everything else.
            keep_sha = None
            if active_sha:
                keep_sha = f"sha256:{active_sha}"
            elif versions:
                # Keep the newest one if none is active
                newest = versions[-1]
                newest_name = newest["name"]
                keep_sha = newest_name.split("/versions/")[-1]
                print(f"No active service; keeping the newest version as fallback: {keep_sha}")

            deleted_count = 0
            for v in versions:
                v_name = v["name"]
                sha = v_name.split("/versions/")[-1]

                if sha == keep_sha:
                    print(f"  [KEEP] {sha} (Created: {v.get('createTime')})")
                    continue

                print(f"  [DELETE] {sha} (Created: {v.get('createTime')})")
                del_cmd = f'gcloud artifacts versions delete {sha} --repository={repo_name} --location={loc} --package={pkg_name} --project={project} --quiet'
                res = run_cmd(del_cmd)
                if res is not None:
                    deleted_count += 1
                else:
                    print(f"    Failed to delete {sha}")

            print(f"Finished {pkg_name}. Deleted {deleted_count} versions.")

    print("\n=== Cleanup Process Completed ===")

if __name__ == "__main__":
    cleanup()
