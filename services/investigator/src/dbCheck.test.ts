import { describe, expect, it } from 'vitest';
import { grantsProblem } from './dbCheck.js';

const usage = "GRANT USAGE ON *.* TO `ro`@`%`";
const select = "GRANT SELECT ON `aditum_ro`.* TO `ro`@`%`";

describe('grantsProblem', () => {
  it('accepts exactly a read-only user on the views', () => {
    expect(grantsProblem([usage, select], 'aditum_ro')).toBeNull();
  });
  it.each([
    ['all privileges', 'GRANT ALL PRIVILEGES ON *.* TO `root`@`%`'],
    ['reading the real tables', 'GRANT SELECT ON `aditum`.* TO `ro`@`%`'],
    ['reading everything', 'GRANT SELECT ON *.* TO `ro`@`%`'],
    ['writing to the views', 'GRANT SELECT, UPDATE ON `aditum_ro`.* TO `ro`@`%`'],
    ['a role', 'GRANT `admin_role`@`%` TO `ro`@`%`'],
    ['a single real table', 'GRANT SELECT ON `aditum`.`person` TO `ro`@`%`'],
  ])('refuses %s', (_, grant) => {
    expect(grantsProblem([usage, select, grant], 'aditum_ro')).toMatch(/más permisos/);
  });
  it('refuses a user that cannot read the views', () => {
    expect(grantsProblem([usage], 'aditum_ro')).toMatch(/no tiene SELECT/);
  });
});
