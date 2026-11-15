-- Station PIN login (name card + 4-digit PIN on shared station computers) was removed from the app.
-- Its table is no longer read or written. It was empty when this was written.
DROP TABLE IF EXISTS "station_pin";
