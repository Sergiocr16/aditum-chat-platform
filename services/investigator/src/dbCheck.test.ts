import { describe, expect, it } from 'vitest';
import { grantsProblem } from './dbCheck.js';

const usage = "GRANT USAGE ON *.* TO `ro`@`%`";
const select = "GRANT SELECT ON `aditum`.* TO `ro`@`%`";

describe('grantsProblem', () => {
  it('accepts exactly a read-only user on the database', () => {
    expect(grantsProblem([usage, select], 'aditum')).toBeNull();
  });
  it('accepts a read-only user that can also see view definitions', () => {
    expect(grantsProblem([usage, 'GRANT SELECT, SHOW VIEW ON `aditum`.* TO `ro`@`%`'], 'aditum')).toBeNull();
  });
  it.each([
    ['writing along with SHOW VIEW', 'GRANT SELECT, SHOW VIEW, UPDATE ON `aditum`.* TO `ro`@`%`'],
    ['SHOW VIEW on another database', 'GRANT SELECT, SHOW VIEW ON `other`.* TO `ro`@`%`'],
    ['all privileges', 'GRANT ALL PRIVILEGES ON *.* TO `root`@`%`'],
    ['reading another database', 'GRANT SELECT ON `other`.* TO `ro`@`%`'],
    ['reading everything', 'GRANT SELECT ON *.* TO `ro`@`%`'],
    ['writing to the database', 'GRANT SELECT, UPDATE ON `aditum`.* TO `ro`@`%`'],
    ['a role', 'GRANT `admin_role`@`%` TO `ro`@`%`'],
    ['a single real table', 'GRANT SELECT ON `aditum`.`person` TO `ro`@`%`'],
  ])('refuses %s', (_, grant) => {
    expect(grantsProblem([usage, select, grant], 'aditum')).toMatch(/más permisos/);
  });
  it('refuses a user that cannot read the database', () => {
    expect(grantsProblem([usage], 'aditum')).toMatch(/no tiene SELECT/);
  });
});
