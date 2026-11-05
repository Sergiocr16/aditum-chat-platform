import { describe, expect, it } from 'vitest';
import { grantsProblem } from './dbCheck.js';

const usage = "GRANT USAGE ON *.* TO `ro`@`%`";
const select = "GRANT SELECT ON `aditum`.* TO `ro`@`%`";

describe('grantsProblem', () => {
  it('accepts exactly a read-only user on the database', () => {
    expect(grantsProblem([usage, select], 'aditum')).toBeNull();
  });
  it.each([
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
