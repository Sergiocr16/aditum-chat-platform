-- Run this by hand, replacing the placeholders. List only the tables it may touch: those GRANTs are
-- all it can do, and the writer refuses a user with anything broader. There is no DELETE on purpose.
CREATE USER IF NOT EXISTS 'aditum_writer'@'__PI_IP__' IDENTIFIED BY '__PASSWORD__' REQUIRE SSL;
GRANT SELECT, UPDATE ON __DATABASE__.__TABLE__ TO 'aditum_writer'@'__PI_IP__';
-- Only for tables where adding rows makes sense:
-- GRANT SELECT, INSERT, UPDATE ON __DATABASE__.__TABLE__ TO 'aditum_writer'@'__PI_IP__';
