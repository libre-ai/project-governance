import hashlib, io, pathlib, tarfile, tempfile, unittest, zipfile, json, os, shutil
from unittest.mock import patch
SCRIPT = pathlib.Path(__file__).with_name('install-toolchains.sh')
class InstallerTests(unittest.TestCase):
 def setUp(self):
  code=SCRIPT.read_text().split("<<'PYTHON'\n",1)[1].rsplit('\nPYTHON',1)[0]
  self.code=code;self.ns={'__name__':'fixture'};exec(compile(code,str(SCRIPT),'exec'),self.ns)
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
  self.assertEqual(deny['version'],self.ns['CARGO_DENY_VERSION'])
  self.assertEqual(self.ns['validate_cargo_deny'](deny)['archiveSha256'],'98c56e6a408bfa5c3c60744b6015aaa6aa08f743fdeb88386d06fca035bb1786')
  for field,bad in [('archiveUrl',deny['platforms']['linux-x64']['archiveUrl'].replace('EmbarkStudios','attacker')),('executableRelativePath','../cargo-deny'),('executableSha256','0')]:
   altered=json.loads(json.dumps(deny));altered['platforms']['linux-x64'][field]=bad
   with self.assertRaises(ValueError):self.ns['validate_cargo_deny'](altered)
  altered=json.loads(json.dumps(deny));altered['version']='0.19.4'
  with self.assertRaises(ValueError):self.ns['validate_cargo_deny'](altered)
 def test_cargo_deny_installs_the_current_or_the_previous_version_and_no_other(self):
  def declaration(version):
   stem='cargo-deny-'+version+'-x86_64-unknown-linux-musl'
   return {'tool':'cargo-deny','version':version,'platforms':{'linux-x64':{'triple':'x86_64-unknown-linux-musl','archiveUrl':'https://github.com/EmbarkStudios/cargo-deny/releases/download/'+version+'/'+stem+'.tar.gz','archiveSha256':'a'*64,'executableRelativePath':stem+'/cargo-deny','executableSha256':'b'*64}}}
  # Every expectation derives from the two constants of the installer, so ending the tolerance
  # (CARGO_DENY_PREVIOUS_VERSION = None, which check-composed-toolchain.py asks for) is a one-line change.
  current=self.ns['CARGO_DENY_VERSION'];previous=self.ns['CARGO_DENY_PREVIOUS_VERSION']
  self.assertRegex(current,r'^\d+\.\d+\.\d+$')
  if previous is not None:
   self.assertRegex(previous,r'^\d+\.\d+\.\d+$');self.assertNotEqual(previous,current)
  installable=[current] if previous is None else [current,previous]
  # The accepted set is exactly these: a sample of refused versions cannot show that no other one is admitted.
  self.assertEqual(sorted(self.ns['CARGO_DENY_INSTALLABLE_VERSIONS']),sorted(installable))
  # ... and it is the set the validation reads: with another set in its place, that set alone is accepted.
  with patch.dict(self.ns,{'CARGO_DENY_INSTALLABLE_VERSIONS':('1.2.3',)}):
   self.assertEqual(self.ns['validate_cargo_deny'](declaration('1.2.3'))['version'],'1.2.3')
   for refused in installable:
    with self.assertRaisesRegex(ValueError,'^Unexpected cargo-deny version$'):self.ns['validate_cargo_deny'](declaration(refused))
  for version in installable:
   accepted=self.ns['validate_cargo_deny'](declaration(version))
   self.assertEqual(accepted['version'],version)
   self.assertEqual(accepted['executableRelativePath'],'cargo-deny-'+version+'-x86_64-unknown-linux-musl/cargo-deny')
  # Each of these is self-consistent (URL and member follow from its version): only the version refuses it.
  # A grid of versions around the accepted ones, and every prefix and extension of an accepted one.
  others={f'{a}.{b}.{c}' for a in range(2) for b in range(41) for c in range(21)}
  for version in installable:
   others|={version[:cut] for cut in range(1,len(version))}
   others|={version+tail for tail in ['0','.0','-rc1',' ']}|{head+version for head in ['0','v','1',' ']}
  others-=set(installable)
  self.assertGreater(len(others),1700)
  for other in sorted(others):
   with self.assertRaisesRegex(ValueError,'^Unexpected cargo-deny version$',msg=other):self.ns['validate_cargo_deny'](declaration(other))
  # A declaration of one accepted version carrying the archive of another is refused.
  for version in installable:
   for foreign in installable:
    if foreign==version:continue
    mixed=declaration(version);mixed['platforms']['linux-x64']['archiveUrl']=declaration(foreign)['platforms']['linux-x64']['archiveUrl']
    with self.assertRaisesRegex(ValueError,'^Unexpected cargo-deny archive URL$'):self.ns['validate_cargo_deny'](mixed)
 def test_cargo_deny_version_is_judged_once_by_membership_in_the_constant(self):
  # The shape of the judgement, read in the source: the declared version is bound once, compared once,
  # by `not in CARGO_DENY_INSTALLABLE_VERSIONS`, and the function names no version of its own.
  # What this cannot see: a comparison moved into a helper the function calls, the constant rebound
  # through globals() at run time, or an alias of `version` compared elsewhere under another name.
  import ast,re
  tree=ast.parse(self.code)
  functions=[node for node in ast.walk(tree) if isinstance(node,ast.FunctionDef) and node.name=='validate_cargo_deny']
  self.assertEqual(len(functions),1)
  body=functions[0]
  literals=[node.value for node in ast.walk(body) if isinstance(node,ast.Constant) and isinstance(node.value,str) and re.search(r'\d+\.\d+',node.value)]
  self.assertEqual(literals,[])
  bindings=[node for node in ast.walk(body) if isinstance(node,(ast.Assign,ast.AugAssign,ast.AnnAssign,ast.NamedExpr)) and any(isinstance(target,ast.Name) and target.id=='version' for target in ast.walk(node.targets[0] if isinstance(node,ast.Assign) else node.target))]
  self.assertEqual([ast.unparse(node) for node in bindings],["version = policy['version']"])
  def mentions(node):return any(isinstance(inner,ast.Name) and inner.id=='version' for inner in ast.walk(node))
  # A comparison that judges the version has it as an operand; the URL check only builds its expected text from it.
  def operand(node):return any(isinstance(side,ast.Name) and side.id=='version' for side in [node.left,*node.comparators])
  comparisons=[ast.unparse(node) for node in ast.walk(body) if isinstance(node,ast.Compare) and operand(node)]
  self.assertEqual(comparisons,['version not in CARGO_DENY_INSTALLABLE_VERSIONS'])
  # No method of the version is called (startswith, endswith, split) and it is not handed to a function that could judge it.
  self.assertEqual([ast.unparse(node) for node in ast.walk(body) if isinstance(node,ast.Attribute) and mentions(node.value)],[])
  self.assertEqual([ast.unparse(node) for node in ast.walk(body) if isinstance(node,ast.Call) and any(mentions(argument) for argument in node.args)],[])
  self.assertEqual([ast.unparse(node) for node in ast.walk(body) if isinstance(node,(ast.comprehension,ast.Lambda)) and mentions(node)],[])
 def test_activation_with_the_current_cargo_deny_version(self):
  # Same end-to-end path as the test below, with a declaration of the CURRENT version:
  # what a generation installs once manifest.json composes a project-governance that declares it.
  current=self.ns['CARGO_DENY_VERSION']
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d).resolve();z=root/'fixture.zip';t=root/'fixture.tar.xz';g=root/'fixture.tar.gz';o=root/'osv-scanner_linux_amd64';o.write_bytes(b'osv')
   with zipfile.ZipFile(z,'w') as out:out.writestr('bun-linux-x64/bun',b'bun')
   with tarfile.open(t,'w:xz') as out:
    entry=tarfile.TarInfo('node-v26.5.0-linux-x64/bin/node');entry.size=4;out.addfile(entry,io.BytesIO(b'node'))
   stem='cargo-deny-'+current+'-x86_64-unknown-linux-musl'
   with tarfile.open(g,'w:gz') as out:
    entry=tarfile.TarInfo(stem+'/cargo-deny');entry.size=4;out.addfile(entry,io.BytesIO(b'deny'))
   digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
   bp=root/'bun.json';np=root/'node.json';dp=root/'cargo-deny.json';op=root/'osv-scanner.json';gp=root/'path';ge=root/'env';gp.write_text('');ge.write_text('')
   bp.write_text(json.dumps({'revision':'1.4.0-canary.1+57f349f63','assets':{'linux-x64':{'sha256':digest(z)}},'durableRelease':{'linuxX64Asset':'https://github.com/libre-ai/project-governance/releases/download/toolchain-bun-1.4.0-canary.1-57f349f63/bun-linux-x64.zip'}}))
   np.write_text(json.dumps({'node':{'version':'26.5.0','platforms':{'linux-x64':{'archiveUrl':'https://nodejs.org/dist/v26.5.0/node-v26.5.0-linux-x64.tar.xz','archiveSha256':digest(t),'executableSha256':hashlib.sha256(b'node').hexdigest(),'executableRelativePath':'bin/node'}}}}))
   dp.write_text(json.dumps({'tool':'cargo-deny','version':current,'platforms':{'linux-x64':{'triple':'x86_64-unknown-linux-musl','archiveUrl':'https://github.com/EmbarkStudios/cargo-deny/releases/download/'+current+'/'+stem+'.tar.gz','archiveSha256':digest(g),'executableRelativePath':stem+'/cargo-deny','executableSha256':hashlib.sha256(b'deny').hexdigest()}}}))
   op.write_text(json.dumps({'tool':'osv-scanner','version':'2.7.1','platforms':{'linux-x64':{'binaryName':'osv-scanner_linux_amd64','binaryUrl':'https://github.com/google/osv-scanner/releases/download/v2.7.1/osv-scanner_linux_amd64','binarySha256':digest(o)}}}))
   def download(args,**kwargs):
    url=args[-1];shutil.copyfile(z if url.endswith('.zip') else g if url.endswith('.tar.gz') else o if url.endswith('_linux_amd64') else t,args[args.index('--output')+1])
   outputs={'bun':b'1.4.0-canary.1+57f349f63','node':b'v26.5.0','cargo-deny':('cargo-deny '+(self.ns['CARGO_DENY_PREVIOUS_VERSION'] or '9.9.9')).encode(),'osv-scanner':b'osv-scanner version: 2.7.1\nosv-scalibr version: 0.5.3\ncommit: fixture\n'}
   version=lambda args,**kwargs:outputs[pathlib.Path(args[0]).name]
   with patch.dict(os.environ,{'RUNNER_TEMP':str(root),'GITHUB_PATH':str(gp),'GITHUB_ENV':str(ge)}),patch('sys.argv',['script',str(bp),str(np),str(dp),str(op)]),patch('platform.system',return_value='Linux'),patch('platform.machine',return_value='x86_64'),patch('subprocess.run',side_effect=download),patch('subprocess.check_output',side_effect=version):
    # A binary reporting the previous version under a declaration of the current one is refused.
    with self.assertRaises(ValueError):self.ns['main']()
    self.assertEqual(gp.read_text(),'');self.assertEqual(ge.read_text(),'')
    outputs['cargo-deny']=('cargo-deny '+current).encode();self.ns['main']()
   self.assertIn('LIBRE_AI_CARGO_DENY='+str(pathlib.Path(gp.read_text().strip())/'cargo-deny')+'\n',ge.read_text())
   self.assertEqual((pathlib.Path(gp.read_text().strip())/'cargo-deny').read_bytes(),b'deny')
 def test_osv_scanner_policy_is_the_pinned_release(self):
  root=SCRIPT.parents[2]
  osv=json.loads((root/'toolchains/osv-scanner.json').read_text())
  asset=self.ns['validate_osv_scanner'](osv)
  self.assertEqual(asset['binarySha256'],'fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8')
  self.assertEqual(asset['binaryUrl'],'https://github.com/google/osv-scanner/releases/download/v2.7.1/osv-scanner_linux_amd64')
  for field,bad in [('binaryUrl',asset['binaryUrl'].replace('google','attacker')),('binaryUrl',asset['binaryUrl'].replace('v2.7.1','v2.7.0')),('binarySha256','0'),('binarySha256','A'*64),('binaryName','osv-scanner_linux_arm64')]:
   altered=json.loads(json.dumps(osv));altered['platforms']['linux-x64'][field]=bad
   with self.assertRaises(ValueError,msg=field+' '+bad):self.ns['validate_osv_scanner'](altered)
  altered=json.loads(json.dumps(osv));altered['version']='2.7.0'
  with self.assertRaises(ValueError):self.ns['validate_osv_scanner'](altered)
  with self.assertRaises(ValueError):self.ns['validate_osv_scanner']({})
 def test_osv_scanner_policy_pins_every_published_platform(self):
  root=SCRIPT.parents[2]
  osv=json.loads((root/'toolchains/osv-scanner.json').read_text())
  names={'darwin-arm64':'osv-scanner_darwin_arm64','darwin-x64':'osv-scanner_darwin_amd64','linux-arm64':'osv-scanner_linux_arm64','linux-x64':'osv-scanner_linux_amd64'}
  self.assertEqual(set(osv['platforms']),set(names))
  for key,name in names.items():
   row=osv['platforms'][key]
   self.assertEqual(row['binaryName'],name)
   self.assertEqual(row['binaryUrl'],'https://github.com/google/osv-scanner/releases/download/v2.7.1/'+name)
   self.assertRegex(row['binarySha256'],r'^[a-f0-9]{64}$')
  self.assertEqual(len({row['binarySha256'] for row in osv['platforms'].values()}),4)
 def test_gzip_archive_member_is_extracted(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);a=root/'cargo-deny.tar.gz'
   with tarfile.open(a,'w:gz') as t:
    f=tarfile.TarInfo('cargo-deny-9.9.9-x86_64-unknown-linux-musl/cargo-deny');f.size=4;t.addfile(f,io.BytesIO(b'deny'))
   self.ns['extract_binary'](a,'cargo-deny-9.9.9-x86_64-unknown-linux-musl/cargo-deny',root/'cargo-deny',False,'r:gz')
   self.assertEqual((root/'cargo-deny').read_bytes(),b'deny')
 def test_activation_waits_for_all_digests_and_versions(self):
  # The fixture declares the previous cargo-deny version while the installer names one, as a composed
  # ref that trails the tooling does; once the tolerance is ended (None) it declares the current one.
  declared=self.ns['CARGO_DENY_PREVIOUS_VERSION'] or self.ns['CARGO_DENY_VERSION']
  # A version the binary must NOT be accepted for: the installer's current one when the declaration is the previous.
  undeclared=self.ns['CARGO_DENY_VERSION'] if declared!=self.ns['CARGO_DENY_VERSION'] else '9.9.9'
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d).resolve();z=root/'fixture.zip';t=root/'fixture.tar.xz';g=root/'fixture.tar.gz';o=root/'osv-scanner_linux_amd64';o.write_bytes(b'osv')
   with zipfile.ZipFile(z,'w') as out:out.writestr('bun-linux-x64/bun',b'bun')
   with tarfile.open(t,'w:xz') as out:
    entry=tarfile.TarInfo('node-v26.5.0-linux-x64/bin/node');entry.size=4;out.addfile(entry,io.BytesIO(b'node'))
   member='cargo-deny-'+declared+'-x86_64-unknown-linux-musl/cargo-deny'
   with tarfile.open(g,'w:gz') as out:
    entry=tarfile.TarInfo(member);entry.size=4;out.addfile(entry,io.BytesIO(b'deny'))
   digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
   bp=root/'bun.json';np=root/'node.json';dp=root/'cargo-deny.json';op=root/'osv-scanner.json';gp=root/'path';ge=root/'env';gp.write_text('');ge.write_text('')
   bun={'revision':'1.4.0-canary.1+57f349f63','assets':{'linux-x64':{'sha256':digest(z)}},'durableRelease':{'linuxX64Asset':'https://github.com/libre-ai/project-governance/releases/download/toolchain-bun-1.4.0-canary.1-57f349f63/bun-linux-x64.zip'}}
   node={'node':{'version':'26.5.0','platforms':{'linux-x64':{'archiveUrl':'https://nodejs.org/dist/v26.5.0/node-v26.5.0-linux-x64.tar.xz','archiveSha256':digest(t),'executableSha256':'0'*64,'executableRelativePath':'bin/node'}}}}
   deny={'tool':'cargo-deny','version':declared,'platforms':{'linux-x64':{'triple':'x86_64-unknown-linux-musl','archiveUrl':'https://github.com/EmbarkStudios/cargo-deny/releases/download/'+declared+'/cargo-deny-'+declared+'-x86_64-unknown-linux-musl.tar.gz','archiveSha256':digest(g),'executableRelativePath':member,'executableSha256':hashlib.sha256(b'deny').hexdigest()}}}
   osv={'tool':'osv-scanner','version':'2.7.1','platforms':{'linux-x64':{'binaryName':'osv-scanner_linux_amd64','binaryUrl':'https://github.com/google/osv-scanner/releases/download/v2.7.1/osv-scanner_linux_amd64','binarySha256':'0'*64}}}
   bp.write_text(json.dumps(bun));np.write_text(json.dumps(node));dp.write_text(json.dumps(deny));op.write_text(json.dumps(osv))
   def download(args,**kwargs):
    url=args[-1];shutil.copyfile(z if url.endswith('.zip') else g if url.endswith('.tar.gz') else o if url.endswith('_linux_amd64') else t,args[args.index('--output')+1])
   env={'RUNNER_TEMP':str(root),'GITHUB_PATH':str(gp),'GITHUB_ENV':str(ge)}
   outputs={'bun':b'1.4.0-canary.1+57f349f63','node':b'v26.5.0','cargo-deny':('cargo-deny '+declared).encode(),'osv-scanner':b'osv-scanner version: 2.7.1\nosv-scalibr version: 0.5.3\ncommit: fixture\n'}
   version=lambda args,**kwargs:outputs[pathlib.Path(args[0]).name]
   with patch.dict(os.environ,env),patch('sys.argv',['script',str(bp),str(np),str(dp),str(op)]),patch('platform.system',return_value='Linux'),patch('platform.machine',return_value='x86_64'),patch('subprocess.run',side_effect=download),patch('subprocess.check_output',side_effect=version):
    with self.assertRaises(ValueError):self.ns['main']()
    self.assertEqual(gp.read_text(),'');self.assertEqual(ge.read_text(),'')
    node['node']['platforms']['linux-x64']['executableSha256']=hashlib.sha256(b'node').hexdigest();np.write_text(json.dumps(node))
    deny['platforms']['linux-x64']['executableSha256']='0'*64;dp.write_text(json.dumps(deny))
    with self.assertRaises(ValueError):self.ns['main']()
    self.assertEqual(gp.read_text(),'');self.assertEqual(ge.read_text(),'')
    deny['platforms']['linux-x64']['executableSha256']=hashlib.sha256(b'deny').hexdigest();dp.write_text(json.dumps(deny))
    with self.assertRaises(ValueError):self.ns['main']()
    self.assertEqual(gp.read_text(),'');self.assertEqual(ge.read_text(),'')
    osv['platforms']['linux-x64']['binarySha256']=digest(o);op.write_text(json.dumps(osv))
    outputs['osv-scanner']=b'osv-scanner version: 2.7.0\nosv-scalibr version: 0.5.3\n'
    with self.assertRaises(ValueError):self.ns['main']()
    self.assertEqual(gp.read_text(),'');self.assertEqual(ge.read_text(),'')
    outputs['osv-scanner']=b'osv-scanner version: 2.7.1\nosv-scalibr version: 0.5.3\ncommit: fixture\n'
    # The binary must report the DECLARED version, not another one the installer knows.
    outputs['cargo-deny']=('cargo-deny '+undeclared).encode()
    with self.assertRaises(ValueError):self.ns['main']()
    self.assertEqual(gp.read_text(),'');self.assertEqual(ge.read_text(),'')
    outputs['cargo-deny']=('cargo-deny '+declared).encode();self.ns['main']()
   self.assertIn('libre-ai-toolchains-',gp.read_text());self.assertIn('NOTEBOOK_QUALIFICATION_NODE=',ge.read_text())
   self.assertIn('LIBRE_AI_CARGO_DENY='+str(pathlib.Path(gp.read_text().strip())/'cargo-deny')+'\n',ge.read_text())
   self.assertIn('LIBRE_AI_OSV_SCANNER='+str(pathlib.Path(gp.read_text().strip())/'osv-scanner')+'\n',ge.read_text())
   self.assertEqual((pathlib.Path(gp.read_text().strip())/'osv-scanner').read_bytes(),b'osv')
   self.assertTrue(os.access(pathlib.Path(gp.read_text().strip())/'osv-scanner',os.X_OK))
if __name__=='__main__':unittest.main()
