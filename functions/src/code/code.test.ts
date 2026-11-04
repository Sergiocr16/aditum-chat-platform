import { describe, expect, it } from 'vitest';
import { isIndexablePath } from './allowlist';
import { audienceForContactRole, audiencesOf, buildAudienceMap } from './audience';
import { chunkSource } from './chunker';
import { findSecrets } from './secretScan';

describe('isIndexablePath', () => {
  it.each([
    'src/main/java/com/lighthouse/aditum/service/ChargeService.java',
    'src/main/java/com/lighthouse/aditum/web/rest/HouseResource.java',
    'src/main/webapp/app/entities/house/house.controller.js',
    'src/main/webapp/app/entities/house/house.html',
    'src/main/webapp/i18n/es/global.json',
  ])('allows %s', (path) => expect(isIndexablePath(path)).toBe(true));

  it.each([
    'src/main/java/com/lighthouse/aditum/config/SecurityConfiguration.java',
    'src/main/java/com/lighthouse/aditum/security/jwt/TokenProvider.java',
    'src/main/java/com/lighthouse/aditum/service/mapper/HouseMapper.java',
    'src/main/resources/config/application-prod.yml',
    'src/test/java/com/lighthouse/aditum/service/ChargeServiceTest.java',
    'src/main/webapp/app/services/customjs/viewer.min.js',
    'src/main/webapp/bower_components/angular/angular.js',
    'src/main/webapp/i18n/en/global.json',
    '.env',
    'docs/notes.md',
  ])('denies %s', (path) => expect(isIndexablePath(path)).toBe(false));
});

describe('findSecrets', () => {
  it.each([
    ['private key', '-----BEGIN RSA PRIVATE KEY-----'],
    ['aws key', 'String k = "AKIAIOSFODNN7EXAMPLE";'],
    ['url with password', 'jdbc:mysql://root:hunter22@db.example.com/aditum'],
    ['hardcoded key', 'private static final String SECRET_KEY = "aB3dE6gH9jK2mN5p";'],
    ['unknown token format', 'var t = "q7Zp2Lx9Vb4Ty8Rk1Wn6Hd3Fs0Jg5Mc7QaXe2Ui";'],
  ])('flags %s', (_name, text) => expect(findSecrets(text).length).toBeGreaterThan(0));

  it.each([
    ['ui label', '"password": "Contraseña",'],
    ['binding', 'password: "{{vm.password}}"'],
    ['random id alphabet', 'var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";'],
    ['template path', 'templateUrl: "app/entities/house/house-dialog.controller.detail.html"'],
    ['plain code', 'public void cancel(Reservation r) { repository.delete(r); }'],
  ])('ignores %s', (_name, text) => expect(findSecrets(text)).toEqual([]));

  it('reports rule names, never the secret itself', () => {
    const hits = findSecrets('String k = "AKIAIOSFODNN7EXAMPLE";');
    expect(hits.join(' ')).not.toContain('AKIA');
  });
});

describe('chunkSource', () => {
  const method = (i: number) =>
    [`    public void method${i}() {`, ...Array.from({ length: 12 }, (_, n) => `        doWork(${n}, "value ${i}"); // step`), '    }'].join('\n');
  const java = ['public class ChargeService {', ...Array.from({ length: 20 }, (_, i) => method(i)), '}'].join('\n');

  it('keeps exact lines and numbering', () => {
    const lines = java.split('\n');
    for (const chunk of chunkSource('a/ChargeService.java', java)) {
      expect(chunk.text).toBe(lines.slice(chunk.startLine - 1, chunk.endLine).join('\n'));
    }
  });

  it('cuts where a method ends', () => {
    const chunks = chunkSource('a/ChargeService.java', java);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text.trimEnd().endsWith('}')).toBe(true);
    expect(chunks[0].symbol).toBeTruthy();
  });

  it('is not misled by braces inside strings and comments', () => {
    const tricky = ['class A {', '  String s = "}}}"; // }}}', '  /* } */', '  void m() {', '  }', '}'].join('\n');
    expect(chunkSource('A.java', tricky).map((c) => c.text).join('\n')).toBe(tricky);
  });

  it('never exceeds the size cap, even without boundaries', () => {
    const html = Array.from({ length: 400 }, (_, i) => `<div class="row">line ${i}</div>`).join('\n');
    for (const chunk of chunkSource('a.html', html)) expect(chunk.text.length).toBeLessThanOrEqual(3000);
  });

  it('skips minified files and unknown types', () => {
    expect(chunkSource('a.js', `var a=${'1,'.repeat(2000)}`)).toEqual([]);
    expect(chunkSource('a.png', 'binary')).toEqual([]);
  });
});

describe('findSecrets on labels and prefixes', () => {
  it.each(['"password": "Contraseña:",', 'String API_KEY_PREFIX = "ak_live_";'])('ignores %s', (line) => {
    expect(findSecrets(line)).toEqual([]);
  });

  it('still flags a credential that merely starts like a prefix', () => {
    expect(findSecrets('apiKey = "ak_live_9fK2mZ7qP1xL"')).toContain('credential_assignment');
  });
});

describe('audience', () => {
  const app = 'src/main/webapp/app/entities';
  const state = (name: string, roles: string, template: string, part: string) => `
    .state('${name}', {
      data: { authorities: [${roles}] },
      views: { 'content@': { templateUrl: 'app/entities/${template}' } },
      resolve: { t: function (p) { p.addPart('${part}'); } }
    })`;
  const map = buildAudienceMap([
    {
      path: `${app}/issuing/issuing.state.js`,
      text: state('issuing-detail', "'ROLE_ACCOUNTANT'", 'issuing/issuing-detail.html', 'issuing'),
    },
    {
      path: `${app}/mixed/mixed.state.js`,
      text:
        state('mixed-admin', "'ROLE_MANAGER'", 'mixed/admin.html', 'mixed') +
        state('mixed-home', "'ROLE_USER', 'ROLE_MANAGER'", 'mixed/home.html', 'mixed') +
        state('mixed-root', "'ROLE_ADMIN'", 'mixed/root.html', 'mixed'),
    },
    { path: `${app}/audits/audits.state.js`, text: state('audits', "'ROLE_ADMIN'", 'audits/audits.html', 'audits') },
    { path: 'src/main/webapp/app/account/reset.state.js', text: state('reset', '', 'x.html', 'reset') },
    { path: 'src/main/webapp/app/app.state.js', text: ".state('app', { views: {}, resolve: { t: p.addPart('navBar') } })" },
  ]);
  const of = (path: string, text = '') => audiencesOf(path, text, map);

  it('keeps an accountant-only screen away from administrators', () => {
    expect(of(`${app}/issuing/issuing-detail.html`)).toEqual(['accountant']);
    expect(of(`${app}/issuing/issuing-detail.controller.js`)).toEqual(['accountant']);
    expect(of('src/main/webapp/i18n/es/issuing.json')).toEqual(['accountant']);
  });

  it('lets staff see what residents see', () => {
    expect(of(`${app}/mixed/home.html`)).toEqual(['manager', 'accountant']);
  });

  it('gives an unnamed file only what its whole directory shares', () => {
    expect(of(`${app}/mixed/unnamed.service.js`)).toEqual(['manager']);
  });

  it('hides what only roles outside the chat can reach', () => {
    expect(of(`${app}/audits/audits.html`)).toEqual([]);
    expect(of(`${app}/audits/audits.controller.js`)).toEqual([]);
    expect(of(`${app}/audits/helper.service.js`)).toEqual([]);
  });

  it('treats public pages and shared chrome as visible to both', () => {
    expect(of('src/main/webapp/app/entities/x.html')).toEqual(['manager', 'accountant']);
    expect(of('src/main/webapp/i18n/es/navBar.json')).toEqual(['manager', 'accountant']);
    expect(of('src/main/webapp/app/components/x/x.service.js')).toEqual(['manager', 'accountant']);
  });

  it('reads the access rule of a Java resource from the file', () => {
    const java = 'src/main/java/com/lighthouse/aditum/web/rest/XResource.java';
    expect(of(java, 'class X {}')).toEqual(['manager', 'accountant']);
    expect(of(java, '@Secured(AuthoritiesConstants.ADMIN)\nvoid a() {}')).toEqual([]);
    expect(of(java, '@Secured({AuthoritiesConstants.MANAGER, AuthoritiesConstants.ADMIN})')).toEqual(['manager']);
  });

  it('gives no code to a contact role the host does not send', () => {
    expect(audienceForContactRole('Administrador')).toBe('manager');
    expect(audienceForContactRole('Contador')).toBe('accountant');
    expect(audienceForContactRole('residente')).toBeNull();
    expect(audienceForContactRole(undefined)).toBeNull();
  });
});
