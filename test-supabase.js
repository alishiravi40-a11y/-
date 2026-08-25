import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function test() {
  console.log("Testing Supabase...");
  const { data, error } = await supabase.from('credit_files').select('*').limit(1);
  console.log("Select result:", data, error);
}
test();
