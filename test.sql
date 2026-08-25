DO $$
BEGIN
  SET LOCAL session_replication_role = 'replica';
END;
$$;
