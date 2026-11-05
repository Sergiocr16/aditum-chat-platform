-- Run this by hand, replacing the placeholders. The user can read the whole database, personal data
-- included, but can't write anything or use a file (no FILE privilege).
CREATE USER IF NOT EXISTS 'aditum_investigator_ro'@'__HOST__' IDENTIFIED BY '__PASSWORD__' REQUIRE __TLS__;
GRANT SELECT ON __DATABASE__.* TO 'aditum_investigator_ro'@'__HOST__';
