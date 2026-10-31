import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which('node')


@unittest.skipUnless(os.name == 'nt' and NODE, 'Windows and Node required')
class HostingDeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        deploy = self.root / 'deploy'
        deploy.mkdir()
        for name in ('deploy_hosting.ps1', 'build_hosting.py', 'verify_hosting_stage.js'):
            shutil.copy2(ROOT / 'deploy' / name, deploy / name)
        frontend = self.root / 'frontend'
        (frontend / 'presentation').mkdir(parents=True)
        (frontend / 'index.html').write_text('<img src="pwa.png">', encoding='utf-8')
        (frontend / 'pwa.png').write_bytes(b'icon')
        (frontend / 'presentation' / 'notification_option_C.mp3').write_bytes(b'audio')
        shutil.copy2(ROOT / 'firebase.json', self.root / 'firebase.json')
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        (self.bin / 'firebase.cmd').write_text('@"' + NODE + '" "' + str(self.root / 'fake.js') + '" %*\r\n@exit /b %errorlevel%\r\n')
        (self.root / 'fake.js').write_text('''const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2); const config = JSON.parse(fs.readFileSync(args[args.indexOf('--config') + 1]));
const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(args[args.indexOf('--config') + 1]), 'manifest.json')));
fs.writeFileSync(process.env.MARKER, JSON.stringify({args, config, manifest, files: manifest.files.map(f => fs.readFileSync(path.join(config.hosting.public, f.path)).length)}));
process.exit(Number(process.env.FAKE_EXIT || 0));''', encoding='utf-8')
        self.env = os.environ.copy()
        self.env['PATH'] = str(self.bin) + os.pathsep + str(Path(sys.executable).parent) + os.pathsep + self.env['PATH']
        self.env['MARKER'] = str(self.root / 'called.json')

    def run_wrapper(self, deploy=False):
        command = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(self.root / 'deploy' / 'deploy_hosting.ps1')]
        if deploy:
            command.append('-Deploy')
        return subprocess.run(command, env=self.env, text=True, capture_output=True)

    def assert_clean(self):
        self.assertEqual(list((self.root / 'runtime').glob('hosting-deploy-*')), [])

    def test_build_only_never_invokes_firebase(self):
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(Path(self.env['MARKER']).exists())
        self.assertFalse((self.root / 'runtime').exists())

    def test_success_verifies_complete_manifest_and_config(self):
        result = self.run_wrapper(True)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(Path(self.env['MARKER']).read_text())
        self.assertEqual(len(data['manifest']['files']), 5)
        self.assertEqual(len(data['files']), 5)
        self.assertEqual(data['args'][:5], ['deploy', '--only', 'hosting', '--project', 'newlngship'])
        original = json.loads((self.root / 'firebase.json').read_text())
        self.assertEqual(data['config']['hosting']['headers'], original['hosting']['headers'])
        self.assertEqual(data['config']['hosting']['rewrites'], original['hosting']['rewrites'])
        self.assert_clean()

    def test_preflight_failure_prevents_deploy_and_cleans(self):
        (self.bin / 'node.cmd').write_text('@exit /b 9\r\n')
        result = self.run_wrapper(True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Hosting stage verification failed', result.stderr)
        self.assertFalse(Path(self.env['MARKER']).exists())
        self.assert_clean()

    def test_firebase_failure_propagates_and_cleans(self):
        self.env['FAKE_EXIT'] = '23'
        result = self.run_wrapper(True)
        self.assertEqual(result.returncode, 23, result.stderr)
        self.assertTrue(Path(self.env['MARKER']).exists())
        self.assert_clean()

    def test_node_detects_missing_and_changed_files(self):
        site = self.root / 'site'
        site.mkdir()
        (site / 'one.txt').write_text('changed')
        manifest = self.root / 'manifest.json'
        manifest.write_text(json.dumps({'files': [{'path': 'one.txt', 'sha256': 'BAD'}, {'path': 'missing.txt', 'sha256': 'BAD'}]}))
        result = subprocess.run([NODE, str(ROOT / 'deploy' / 'verify_hosting_stage.js'), str(site), str(manifest)], capture_output=True)
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
