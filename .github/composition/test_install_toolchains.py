import hashlib, io, pathlib, tarfile, tempfile, unittest, zipfile, json, os, shutil
from unittest.mock import patch
SCRIPT = pathlib.Path(__file__).with_name('install-toolchains.sh')
class InstallerTests(unittest.TestCase):
 def setUp(self):
  code=SCRIPT.read_text().split("<<'PYTHON'\n",1)[1].rsplit('\nPYTHON',1)[0]
  self.ns={'__name__':'fixture'};exec(compile(code,str(SCRIPT),'exec'),self.ns)
 def test_digest_refusal(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'x';p.write_bytes(b'fixture')
   with self.assertRaises(ValueError):self.ns['verify_digest'](p,'0'*64)
   self.ns['verify_digest'](p,hashlib.sha256(b'fixture').hexdigest())
 def test_archives_require_exact_regular_binary(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);a=root/'node.tar.xz'
   with tarfile.open(a,'w:xz') as t:
    f=tarfile.TarInfo('node-v26.5.0-linux-x64/bin/node');f.size=2;t.addfile(f,io.BytesIO(b'ok'))
   self.ns['extract_binary'](a,'node-v26.5.0-linux-x64/bin/node',root/'node',False)
   self.assertEqual((root/'node').read_bytes(),b'ok')
   with zipfile.ZipFile(root/'bad.zip','w') as z:z.writestr('../escape',b'x');z.writestr('bun-linux-x64/bun',b'ok')
   with self.assertRaises(ValueError):self.ns['extract_binary'](root/'bad.zip','bun-linux-x64/bun',root/'bun',True)
 def test_only_rehosted_bun_url_is_accepted(self):
  root=SCRIPT.parents[2]
  bun=json.loads((root/'toolchains/bun.json').read_text())
  node=json.loads((root/'toolchains/notebook-qualification.json').read_text())
  target='https://github.com/libre-ai/project-governance/releases/download/toolchain-bun-1.4.0-canary.1-57f349f63/bun-linux-x64.zip'
  bun['durableRelease']['linuxX64Asset']=target
  self.assertEqual(self.ns['validate_policies'](bun,node)[0],target)
  for bad in [target.replace('/project-governance/','/governance/'),target.replace('github.com/','github.com.invalid/')]:
   bun['durableRelease']['linuxX64Asset']=bad
   with self.assertRaises(ValueError):self.ns['validate_policies'](bun,node)
 def test_wrong_policy(self):
  with self.assertRaises(ValueError):self.ns['validate_policies']({}, {})
  with self.assertRaises(ValueError):self.ns['validate_cargo_deny']({})
 def test_cargo_deny_policy_is_the_pinned_release(self):
  root=SCRIPT.parents[2]
  deny=json.loads((root/'toolchains/cargo-deny.json').read_text())
  self.assertEqual(self.ns['validate_cargo_deny'](deny)['archiveSha256'],'5ea64ae09959b5fe1072d898f95caaa89b374678ba6728d5e9ed1366745479b0')
  for field,bad in [('archiveUrl',deny['platforms']['linux-x64']['archiveUrl'].replace('EmbarkStudios','attacker')),('executableRelativePath','../cargo-deny'),('executableSha256','0')]:
   altered=json.loads(json.dumps(deny));altered['platforms']['linux-x64'][field]=bad
   with self.assertRaises(ValueError):self.ns['validate_cargo_deny'](altered)
  altered=json.loads(json.dumps(deny));altered['version']='0.19.4'
  with self.assertRaises(ValueError):self.ns['validate_cargo_deny'](altered)
 def test_gzip_archive_member_is_extracted(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);a=root/'cargo-deny.tar.gz'
   with tarfile.open(a,'w:gz') as t:
    f=tarfile.TarInfo('cargo-deny-0.19.5-x86_64-unknown-linux-musl/cargo-deny');f.size=4;t.addfile(f,io.BytesIO(b'deny'))
   self.ns['extract_binary'](a,'cargo-deny-0.19.5-x86_64-unknown-linux-musl/cargo-deny',root/'cargo-deny',False,'r:gz')
   self.assertEqual((root/'cargo-deny').read_bytes(),b'deny')
 def test_activation_waits_for_all_digests_and_versions(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d).resolve();z=root/'fixture.zip';t=root/'fixture.tar.xz';g=root/'fixture.tar.gz'
   with zipfile.ZipFile(z,'w') as out:out.writestr('bun-linux-x64/bun',b'bun')
   with tarfile.open(t,'w:xz') as out:
    entry=tarfile.TarInfo('node-v26.5.0-linux-x64/bin/node');entry.size=4;out.addfile(entry,io.BytesIO(b'node'))
   member='cargo-deny-0.19.5-x86_64-unknown-linux-musl/cargo-deny'
   with tarfile.open(g,'w:gz') as out:
    entry=tarfile.TarInfo(member);entry.size=4;out.addfile(entry,io.BytesIO(b'deny'))
   digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
   bp=root/'bun.json';np=root/'node.json';dp=root/'cargo-deny.json';gp=root/'path';ge=root/'env';gp.write_text('');ge.write_text('')
   bun={'revision':'1.4.0-canary.1+57f349f63','assets':{'linux-x64':{'sha256':digest(z)}},'durableRelease':{'linuxX64Asset':'https://github.com/libre-ai/project-governance/releases/download/toolchain-bun-1.4.0-canary.1-57f349f63/bun-linux-x64.zip'}}
   node={'node':{'version':'26.5.0','platforms':{'linux-x64':{'archiveUrl':'https://nodejs.org/dist/v26.5.0/node-v26.5.0-linux-x64.tar.xz','archiveSha256':digest(t),'executableSha256':'0'*64,'executableRelativePath':'bin/node'}}}}
   deny={'tool':'cargo-deny','version':'0.19.5','platforms':{'linux-x64':{'triple':'x86_64-unknown-linux-musl','archiveUrl':'https://github.com/EmbarkStudios/cargo-deny/releases/download/0.19.5/cargo-deny-0.19.5-x86_64-unknown-linux-musl.tar.gz','archiveSha256':digest(g),'executableRelativePath':member,'executableSha256':hashlib.sha256(b'deny').hexdigest()}}}
   bp.write_text(json.dumps(bun));np.write_text(json.dumps(node));dp.write_text(json.dumps(deny))
   def download(args,**kwargs):
    url=args[-1];shutil.copyfile(z if url.endswith('.zip') else g if url.endswith('.tar.gz') else t,args[args.index('--output')+1])
   env={'RUNNER_TEMP':str(root),'GITHUB_PATH':str(gp),'GITHUB_ENV':str(ge)}
   versions=[b'1.4.0-canary.1+57f349f63',b'v26.5.0',b'cargo-deny 0.19.5']
   with patch.dict(os.environ,env),patch('sys.argv',['script',str(bp),str(np),str(dp)]),patch('platform.system',return_value='Linux'),patch('platform.machine',return_value='x86_64'),patch('subprocess.run',side_effect=download),patch('subprocess.check_output',side_effect=versions*2):
    with self.assertRaises(ValueError):self.ns['main']()
    self.assertEqual(gp.read_text(),'');self.assertEqual(ge.read_text(),'')
    node['node']['platforms']['linux-x64']['executableSha256']=hashlib.sha256(b'node').hexdigest();np.write_text(json.dumps(node))
    deny['platforms']['linux-x64']['executableSha256']='0'*64;dp.write_text(json.dumps(deny))
    with self.assertRaises(ValueError):self.ns['main']()
    self.assertEqual(gp.read_text(),'');self.assertEqual(ge.read_text(),'')
    deny['platforms']['linux-x64']['executableSha256']=hashlib.sha256(b'deny').hexdigest();dp.write_text(json.dumps(deny));self.ns['main']()
   self.assertIn('libre-ai-toolchains-',gp.read_text());self.assertIn('NOTEBOOK_QUALIFICATION_NODE=',ge.read_text())
   self.assertIn('LIBRE_AI_CARGO_DENY='+str(pathlib.Path(gp.read_text().strip())/'cargo-deny')+'\n',ge.read_text())
if __name__=='__main__':unittest.main()
