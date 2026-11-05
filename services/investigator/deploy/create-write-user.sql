-- Run this by hand, replacing the placeholders. These GRANTs are all the writer can do, and it refuses
-- a user with anything else: only SELECT, INSERT and UPDATE, only on this database. There is no
-- DELETE on purpose.
CREATE USER IF NOT EXISTS 'aditum_writer'@'__PI_IP__' IDENTIFIED BY '__PASSWORD__' REQUIRE SSL;

-- Every table of the database, including the ones added later:
GRANT SELECT, INSERT, UPDATE ON __DATABASE__.* TO 'aditum_writer'@'__PI_IP__';

-- Or only the tables it may touch, one line each:
-- GRANT SELECT, UPDATE ON __DATABASE__.__TABLE__ TO 'aditum_writer'@'__PI_IP__';
-- GRANT SELECT, INSERT, UPDATE ON __DATABASE__.__TABLE__ TO 'aditum_writer'@'__PI_IP__';
