#!/bin/sh
set -eu
: "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY to the Supabase service role key}"
export SUPABASE_SERVICE_ROLE_KEY
export OCR_BATCH="${OCR_BATCH:-6}"
exec python3 "$(dirname "$0")/ocr.py"
