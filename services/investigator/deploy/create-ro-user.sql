-- Run this by hand after loading the generated views, replacing both placeholders.
-- The grant is what keeps data safe: this user can only read the masked views, so it
-- can't reach the real tables, write anything or use a file (no FILE privilege).
CREATE USER IF NOT EXISTS 'aditum_investigator_ro'@'__HOST__' IDENTIFIED BY '__PASSWORD__' REQUIRE __TLS__;
GRANT SELECT ON aditum_ro.* TO 'aditum_investigator_ro'@'__HOST__';
